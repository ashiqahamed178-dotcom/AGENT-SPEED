import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { analyzeTransaction, sendAnalysisError } from "./aiAnalysis";
import type { User } from "./auth";
import { db } from "./db";
import type { Queryable } from "./db";
import {
  availableActions,
  checkTransition,
  rolesFor
} from "./escrowMachine";
import type { EscrowAction, EscrowStatus } from "./escrowMachine";
import { LlmUnavailableError } from "./llm";
import { answerQuestion } from "./rag/agreementRag";

const router = Router();

export type EscrowRow = {
  id: string;
  buyer_id: string;
  buyer_name: string;
  seller_id: string;
  seller_name: string;
  amount: string;
  currency: string;
  agreement_text: string;
  status: EscrowStatus;
  created_at: Date;
  updated_at: Date;
};

const ESCROW_SELECT = `
  SELECT e.id, e.buyer_id, buyer.name AS buyer_name,
         e.seller_id, seller.name AS seller_name,
         e.amount, e.currency, e.agreement_text, e.status,
         e.created_at, e.updated_at
  FROM escrows e
  JOIN users buyer ON buyer.id = e.buyer_id
  JOIN users seller ON seller.id = e.seller_id
`;

const IdSchema = z.uuid();

export function rolesOf(user: User, row: EscrowRow) {
  return rolesFor(user, { buyerId: row.buyer_id, sellerId: row.seller_id });
}

// Arbiters only see an escrow that is, or was, in a dispute.
export async function canView(user: User, row: EscrowRow, database: Queryable = db) {
  const roles = rolesOf(user, row);

  if (roles.includes("buyer") || roles.includes("seller")) return true;
  if (!roles.includes("arbiter")) return false;
  if (row.status === "disputed") return true;

  const dispute = await database.query(
    "SELECT 1 FROM escrow_events WHERE escrow_id = $1 AND action = 'dispute_raised' LIMIT 1",
    [row.id]
  );
  return dispute.rows.length > 0;
}

export async function loadEscrow(id: string, database: Queryable = db, lock = false) {
  if (!IdSchema.safeParse(id).success) return undefined;

  const result = await database.query<EscrowRow>(
    `${ESCROW_SELECT} WHERE e.id = $1 ${lock ? "FOR UPDATE OF e" : ""}`,
    [id]
  );
  return result.rows[0];
}

export async function toResponse(row: EscrowRow, user: User, database: Queryable = db) {
  const evidence = await database.query<{
    id: string;
    submitted_by_name: string;
    description: string;
    reference_url: string | null;
    created_at: Date;
  }>(
    `SELECT ev.id, u.name AS submitted_by_name, ev.description, ev.reference_url, ev.created_at
     FROM escrow_evidence ev
     JOIN users u ON u.id = ev.submitted_by
     WHERE ev.escrow_id = $1
     ORDER BY ev.created_at`,
    [row.id]
  );

  const events = await database.query<{
    id: string;
    action: string;
    actor_name: string;
    note: string;
    created_at: Date;
  }>(
    `SELECT ev.id, ev.action, u.name AS actor_name, ev.note, ev.created_at
     FROM escrow_events ev
     JOIN users u ON u.id = ev.actor_id
     WHERE ev.escrow_id = $1
     ORDER BY ev.created_at`,
    [row.id]
  );

  const roles = rolesOf(user, row);

  return {
    id: row.id,
    buyer: { id: row.buyer_id, name: row.buyer_name },
    seller: { id: row.seller_id, name: row.seller_name },
    amount: Number(row.amount),
    currency: row.currency,
    agreementText: row.agreement_text,
    status: row.status,
    yourRoles: roles,
    availableActions: availableActions(row.status, roles),
    evidence: evidence.rows.map((item) => ({
      id: item.id,
      submittedBy: item.submitted_by_name,
      description: item.description,
      referenceUrl: item.reference_url ?? undefined,
      createdAt: item.created_at
    })),
    events: events.rows.map((item) => ({
      id: item.id,
      action: item.action,
      actor: item.actor_name,
      note: item.note,
      createdAt: item.created_at
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function addEvent(
  database: Queryable,
  escrowId: string,
  action: string,
  actorId: string,
  note: string
) {
  return database.query(
    "INSERT INTO escrow_events (escrow_id, action, actor_id, note) VALUES ($1, $2, $3, $4)",
    [escrowId, action, actorId, note]
  );
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export const NOT_FOUND = "Escrow transaction not found.";

// Every status change goes through here, whether a person calls the route
// directly or approves an AI proposal. The row stays locked until the transaction
// ends, so two requests can't both act on the same status.
export async function executeAction(
  user: User,
  id: string,
  action: EscrowAction,
  note: string,
  tx: Queryable,
  options: {
    sideEffect?: (tx: Queryable, escrow: EscrowRow) => Promise<unknown>;
  } = {}
) {
  const row = await loadEscrow(id, tx, true);

  // A stranger gets the same answer as for a missing escrow, so they can't
  // tell that it exists.
  if (!row || !(await canView(user, row, tx))) {
    throw new HttpError(404, NOT_FOUND);
  }

  const transition = checkTransition(action, row.status, rolesOf(user, row));

  if (!transition.ok) {
    throw new HttpError(transition.reason === "forbidden" ? 403 : 409, transition.message);
  }

  await options.sideEffect?.(tx, row);
  await tx.query(
    "UPDATE escrows SET status = $1, updated_at = now() WHERE id = $2",
    [transition.to, row.id]
  );
  await addEvent(tx, row.id, transition.event, user.id, note);

  const updated = await loadEscrow(row.id, tx);
  return toResponse(updated as EscrowRow, user, tx);
}

async function applyAction(
  req: Request,
  res: Response,
  action: EscrowAction,
  note: string,
  sideEffect?: (tx: Queryable, escrow: EscrowRow) => Promise<unknown>
) {
  try {
    const body = await db.transaction((tx) =>
      executeAction(req.user as User, String(req.params.id), action, note, tx, { sideEffect })
    );

    return res.json(body);
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    throw error;
  }
}

const CreateEscrowSchema = z.object({
  sellerEmail: z.string().trim().toLowerCase().pipe(z.email()),
  amount: z.number().positive().max(1_000_000).multipleOf(0.01),
  currency: z.enum(["USDC", "USD", "EUR"]),
  agreementText: z.string().trim().max(15000).optional().default("")
});

const EvidenceSchema = z.object({
  description: z.string().trim().min(10).max(2000),
  referenceUrl: z.url({ protocol: /^https?$/ }).optional()
});

const NoteSchema = z.object({
  note: z.string().trim().max(500).optional().default("")
});

const DisputeSchema = z.object({
  reason: z.string().trim().min(10).max(1000)
});

// List the escrows this user can see.
router.get("/", async (req, res) => {
  const user = req.user as User;

  const result = await db.query<EscrowRow>(
    `${ESCROW_SELECT}
     WHERE e.buyer_id = $1 OR e.seller_id = $1
        OR ($2 = 'arbiter' AND EXISTS (
          SELECT 1 FROM escrow_events ev
          WHERE ev.escrow_id = e.id AND ev.action = 'dispute_raised'
        ))
     ORDER BY e.created_at DESC`,
    [user.id, user.role]
  );

  const escrows = await Promise.all(result.rows.map((row) => toResponse(row, user)));
  return res.json(escrows);
});

// The logged-in user is always the buyer. The seller must have an account.
router.post("/", async (req, res) => {
  const user = req.user as User;
  const parsed = CreateEscrowSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid escrow details.",
      details: parsed.error.flatten()
    });
  }

  const { sellerEmail, amount, currency, agreementText } = parsed.data;

  const seller = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE email = $1",
    [sellerEmail]
  );
  const sellerId = seller.rows[0]?.id;

  if (!sellerId) {
    return res.status(400).json({ error: "The seller must have an AgentSpend account." });
  }

  if (sellerId === user.id) {
    return res.status(400).json({ error: "You cannot create an escrow with yourself." });
  }

  const body = await db.transaction(async (tx) => {
    const created = await tx.query<{ id: string }>(
      `INSERT INTO escrows (buyer_id, seller_id, amount, currency, agreement_text, status)
       VALUES ($1, $2, $3, $4, $5, 'created')
       RETURNING id`,
      [user.id, sellerId, amount, currency, agreementText]
    );
    const id = created.rows[0]!.id;

    await addEvent(tx, id, "created", user.id, "Escrow transaction created. No funds have been transferred.");

    const row = await loadEscrow(id, tx);
    return toResponse(row as EscrowRow, user, tx);
  });

  return res.status(201).json(body);
});

// AI analysis is advisory. It never changes the escrow status.
router.post("/:id/analyze", async (req, res) => {
  const user = req.user as User;
  const row = await loadEscrow(String(req.params.id));

  if (!row || !(await canView(user, row))) {
    return res.status(404).json({ error: NOT_FOUND });
  }

  if (row.agreement_text.trim().length < 30) {
    return res.status(400).json({
      error: "This escrow does not contain enough agreement text for AI analysis."
    });
  }

  const escrow = await toResponse(row, user);

  const result = await analyzeTransaction({
      transactionId: escrow.id,
      buyer: escrow.buyer.name,
      seller: escrow.seller.name,
      amount: escrow.amount,
      currency: escrow.currency,
      currentStatus: escrow.status,
      agreementText: escrow.agreementText,
      evidence: escrow.evidence.map((item) => ({
        submittedBy: item.submittedBy,
        description: item.description,
        referenceUrl: item.referenceUrl ?? "Not provided",
        submittedAt: item.createdAt
      }))
    });

  if (!result.ok) return sendAnalysisError(res, result);

  return res.json({
    success: true,
    transactionId: escrow.id,
    model: result.model,
    analyzedAt: new Date().toISOString(),
    transactionContext: {
      statusAtAnalysis: escrow.status,
      evidenceCount: escrow.evidence.length
    },
    analysis: result.analysis,
    disclaimer:
      "AI-generated advisory analysis only. Submitted evidence and URLs have not necessarily been independently verified. This endpoint does not change escrow status or authorize or execute payments."
  });
});

const QuestionSchema = z.object({
  question: z.string().trim().min(5).max(500)
});

// Answers a question from this agreement only, with checked citations.
router.post("/:id/ask", async (req, res) => {
  const user = req.user as User;
  const row = await loadEscrow(String(req.params.id));

  if (!row || !(await canView(user, row))) {
    return res.status(404).json({ error: NOT_FOUND });
  }

  const parsed = QuestionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Please ask a question of 5 to 500 characters." });
  }

  if (row.agreement_text.trim().length < 30) {
    return res.status(400).json({
      error: "This escrow does not contain enough agreement text to answer questions."
    });
  }

  try {
    const answer = await answerQuestion(row.id, row.agreement_text, parsed.data.question);
    return res.json({
      success: true,
      question: parsed.data.question,
      ...answer,
      disclaimer: "AI-generated answer. Check the cited clauses. This does not authorize or execute payments."
    });
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      return res.status(502).json({ error: error.message });
    }
    throw error;
  }
});

router.get("/:id", async (req, res) => {
  const user = req.user as User;
  const row = await loadEscrow(String(req.params.id));

  if (!row || !(await canView(user, row))) {
    return res.status(404).json({ error: NOT_FOUND });
  }

  return res.json(await toResponse(row, user));
});

router.post("/:id/fund", async (req, res) => {
  return applyAction(req, res, "fund", "Demo funding recorded. No real funds were transferred.");
});

router.post("/:id/evidence", async (req, res) => {
  const parsed = EvidenceSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid delivery evidence.",
      details: parsed.error.flatten()
    });
  }

  return applyAction(
    req,
    res,
    "submit_evidence",
    "Delivery evidence submitted for buyer review.",
    (tx, escrow) =>
      tx.query(
        `INSERT INTO escrow_evidence (escrow_id, submitted_by, description, reference_url)
         VALUES ($1, $2, $3, $4)`,
        [escrow.id, (req.user as User).id, parsed.data.description, parsed.data.referenceUrl ?? null]
      )
  );
});

router.post("/:id/review", async (req, res) => {
  const parsed = NoteSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review details." });
  }

  return applyAction(req, res, "start_review", parsed.data.note || "Delivery submitted for review.");
});

router.post("/:id/dispute", async (req, res) => {
  const parsed = DisputeSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid dispute details.",
      details: parsed.error.flatten()
    });
  }

  return applyAction(req, res, "dispute", parsed.data.reason);
});

router.post("/:id/release", async (req, res) => {
  const parsed = NoteSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid release details." });
  }

  return applyAction(
    req,
    res,
    "release",
    parsed.data.note || "Demo release recorded. No real funds were transferred."
  );
});

router.post("/:id/refund", async (req, res) => {
  const parsed = NoteSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid refund details." });
  }

  return applyAction(
    req,
    res,
    "refund",
    parsed.data.note || "Demo refund recorded. No real funds were transferred."
  );
});

export default router;
