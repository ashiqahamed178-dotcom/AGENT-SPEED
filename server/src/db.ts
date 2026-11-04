import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { config } from "./config";

type Rows<T> = { rows: T[] };

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Rows<T>>;
}

interface Database extends Queryable {
  exec(sql: string): Promise<void>;
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
}

function postgresDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 5 });

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work({
          async query<T>(sql: string, params: unknown[] = []) {
            const queryResult = await client.query(sql, params);
            return { rows: queryResult.rows as T[] };
          }
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

async function embeddedDatabase(): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  let dataDir: string | undefined;

  // Tests use a fresh in-memory database, so they can never touch real data.
  if (!config.isTest) {
    dataDir = join(process.cwd(), "data", "pglite");
    mkdirSync(dataDir, { recursive: true });
  }

  const engine = new PGlite({ dataDir, extensions: { vector } });

  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await engine.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql) {
      await engine.exec(sql);
    },
    async transaction<R>(work: (tx: Queryable) => Promise<R>) {
      const result = await engine.transaction((tx) =>
        work({
          async query<T>(sql: string, params: unknown[] = []) {
            const queryResult = await tx.query<T>(sql, params);
            return { rows: queryResult.rows };
          }
        })
      );
      return result as R;
    }
  };
}

const migrations: { id: string; sql: string }[] = [
  {
    id: "001_foundation",
    sql: `
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        name text NOT NULL,
        password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'arbiter')),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE escrows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        buyer_id uuid NOT NULL REFERENCES users (id),
        seller_id uuid NOT NULL REFERENCES users (id),
        amount numeric(18, 2) NOT NULL CHECK (amount > 0),
        currency text NOT NULL,
        agreement_text text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN (
          'created', 'funded', 'delivered', 'under_review',
          'released', 'refunded', 'disputed'
        )),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (buyer_id <> seller_id)
      );
      CREATE INDEX escrows_buyer_idx ON escrows (buyer_id);
      CREATE INDEX escrows_seller_idx ON escrows (seller_id);
      CREATE INDEX escrows_status_idx ON escrows (status);

      CREATE TABLE escrow_evidence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        escrow_id uuid NOT NULL REFERENCES escrows (id),
        submitted_by uuid NOT NULL REFERENCES users (id),
        description text NOT NULL,
        reference_url text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX escrow_evidence_escrow_idx ON escrow_evidence (escrow_id);

      CREATE TABLE escrow_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        escrow_id uuid NOT NULL REFERENCES escrows (id),
        action text NOT NULL,
        actor_id uuid NOT NULL REFERENCES users (id),
        note text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX escrow_events_escrow_idx ON escrow_events (escrow_id, created_at);

      -- The audit trail is append-only, enforced by the database itself.
      CREATE FUNCTION reject_event_change() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'escrow_events is append-only';
      END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER escrow_events_append_only
        BEFORE UPDATE OR DELETE ON escrow_events
        FOR EACH ROW EXECUTE FUNCTION reject_event_change();

      CREATE TABLE payment_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users (id),
        agent_name text NOT NULL,
        recipient text NOT NULL,
        amount numeric(18, 2) NOT NULL CHECK (amount > 0),
        reason text NOT NULL,
        status text NOT NULL CHECK (status IN ('approved', 'rejected')),
        explanation text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX payment_requests_user_idx ON payment_requests (user_id, created_at);
    `
  },
  {
    // One agreement has few clauses, so searching them directly is fast and
    // exact. The escrow_id index is what matters, and it also keeps each search
    // inside a single agreement.
    id: "002_agreement_clauses",
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE agreement_clauses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        escrow_id uuid NOT NULL REFERENCES escrows (id),
        position integer NOT NULL,
        text text NOT NULL,
        start_offset integer NOT NULL,
        end_offset integer NOT NULL,
        embedding vector(${config.llm.embeddingDimensions}) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (escrow_id, position)
      );
    `
  },
  {
    id: "003_agent_runs",
    sql: `
      CREATE TABLE agent_runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        escrow_id uuid NOT NULL REFERENCES escrows (id),
        requested_by uuid NOT NULL REFERENCES users (id),
        status text NOT NULL CHECK (status IN (
          'running', 'pending_approval', 'no_action',
          'approved', 'declined', 'failed'
        )),
        escrow_status_at_start text NOT NULL,
        proposed_action text CHECK (proposed_action IN ('release', 'refund', 'dispute', 'none')),
        reasoning text,
        risks jsonb,
        citations jsonb,
        rejected_citations integer NOT NULL DEFAULT 0,
        blocked_by text,
        trace jsonb,
        error text,
        decided_by uuid REFERENCES users (id),
        decided_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX agent_runs_escrow_idx ON agent_runs (escrow_id, created_at);
    `
  }
];

async function migrate(database: Database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const applied = await database.query<{ id: string }>("SELECT id FROM schema_migrations");
  const appliedIds = new Set(applied.rows.map((row) => row.id));

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;

    // The schema change and its record succeed or fail together.
    await database.exec(`
      BEGIN;
      ${migration.sql}
      INSERT INTO schema_migrations (id) VALUES ('${migration.id}');
      COMMIT;
    `);
  }
}

let ready: Promise<Database> | undefined;

function getDatabase(): Promise<Database> {
  ready ??= (async () => {
    const database = config.databaseUrl
      ? postgresDatabase(config.databaseUrl)
      : await embeddedDatabase();
    await migrate(database);
    return database;
  })();

  return ready;
}

export const db: Queryable & {
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
} = {
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
    return (await getDatabase()).query<T>(sql, params);
  },
  async transaction<T>(work: (tx: Queryable) => Promise<T>) {
    return (await getDatabase()).transaction(work);
  }
};
