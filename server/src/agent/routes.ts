import { Router } from "express";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import type { User } from "../auth";
import { config } from "../config";
import { db } from "../db";
import type { Queryable } from "../db";
import { canView, executeAction, HttpError, loadEscrow, NOT_FOUND, rolesOf, toResponse } from "../escrow";
import { availableActions } from "../escrowMachine";
import type { EscrowAction } from "../escrowMachine";
import { LlmUnavailableError } from "../llm";
import { runEscrowAgent } from "./escrowAgent";

const router = Router({ mergeParams: true });

type RunStatus = "running" | "pending_approval" | "no_action" | "approved" | "declined" | "failed";

type RunRow = {
  id: string;
  escrow_id: string;
  requested_by: string;
  status: RunStatus;
  escrow_status_at_start: string;
  proposed_action: EscrowAction | "none" | null;
  reasoning: string | null;
  risks: string[] | null;
  citations: unknown[] | null;
  rejected_citations: number;
  blocked_by: string | null;
  trace: unknown[] | null;
  error: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Date;
};

function toRun(row: RunRow) {
  return {
    id: row.id,
    escrowId: row.escrow_id,
    status: row.status,
    escrowStatusAtStart: row.escrow_status_at_start,
    proposedAction: row.proposed_action,
    reasoning: row.reasoning,
    risks: row.risks ?? [],
    citations: row.citations ?? [],
    rejectedCitations: row.rejected_citations,
    blockedBy: row.blocked_by,
    trace: row.trace ?? [],
    error: row.error,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    disclaimer:
      "AI proposal only. Nothing happens unless the person allowed to take this action approves it."
  };
}

async function loadVisibleEscrow(req: Request) {
  const row = await loadEscrow(String(req.params.id));

  if (!row || !(await canView(req.user as User, row))) {
    throw new HttpError(404, NOT_FOUND);
  }

  return row;
}

async function loadRun(req: Request, database: Queryable = db, lock = false) {
  const result = await database.query<RunRow>(
    `SELECT * FROM agent_runs WHERE id::text = $1 AND escrow_id::text = $2 ${lock ? "FOR UPDATE" : ""}`,
    [String(req.params.runId), String(req.params.id)]
  );
  const run = result.rows[0];

  if (!run) throw new HttpError(404, "Agent run not found.");

  return run;
}

function handled(work: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await work(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  };
}

const startLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { error: "Too many agent runs. Please try again later." }
});

// Starts a run and answers at once, because a run can take minutes and web
// requests shouldn't stay open that long. The client checks back for the result.
router.post(
  "/",
  startLimiter,
  handled(async (req, res) => {
    const user = req.user as User;
    const row = await loadVisibleEscrow(req);

    if (row.agreement_text.trim().length < 30) {
      throw new HttpError(400, "This escrow does not contain enough agreement text for a review.");
    }

    const created = await db.query<RunRow>(
      `INSERT INTO agent_runs (escrow_id, requested_by, status, escrow_status_at_start)
       VALUES ($1, $2, 'running', $3)
       RETURNING *`,
      [row.id, user.id, row.status]
    );
    const run = created.rows[0] as RunRow;

    const escrow = await toResponse(row, user);

    void runEscrowAgent({
      escrowId: row.id,
      status: row.status,
      amount: escrow.amount,
      currency: escrow.currency,
      buyer: escrow.buyer.name,
      seller: escrow.seller.name,
      agreementText: row.agreement_text,
      requesterRoles: rolesOf(user, row),
      allowedActions: availableActions(row.status, rolesOf(user, row)),
      evidence: escrow.evidence.map((item) => ({
        submittedBy: item.submittedBy,
        description: item.description,
        referenceUrl: item.referenceUrl
      })),
      events: escrow.events.map((item) => ({
        action: item.action,
        actor: item.actor,
        note: item.note
      }))
    })
      .then((result) =>
        db.query(
          `UPDATE agent_runs
           SET status = $2, proposed_action = $3, reasoning = $4, risks = $5,
               citations = $6, rejected_citations = $7, blocked_by = $8, trace = $9
           WHERE id = $1`,
          [
            run.id,
            result.proposedAction === "none" ? "no_action" : "pending_approval",
            result.proposedAction,
            result.reasoning,
            JSON.stringify(result.risks),
            JSON.stringify(result.citations),
            result.rejectedCitations,
            result.blockedBy,
            JSON.stringify(result.trace)
          ]
        )
      )
      .catch(async (error: unknown) => {
        if (!(error instanceof LlmUnavailableError)) {
          console.error("Agent run error:", error);
        }
        await db
          .query("UPDATE agent_runs SET status = 'failed', error = $2 WHERE id = $1", [
            run.id,
            error instanceof LlmUnavailableError
              ? error.message
              : "The review could not be completed."
          ])
          .catch((updateError: unknown) => console.error("Agent run update error:", updateError));
      });

    return res.status(202).json(toRun(run));
  })
);

router.get(
  "/",
  handled(async (req, res) => {
    const row = await loadVisibleEscrow(req);
    const runs = await db.query<RunRow>(
      "SELECT * FROM agent_runs WHERE escrow_id = $1 ORDER BY created_at DESC",
      [row.id]
    );
    return res.json(runs.rows.map(toRun));
  })
);

router.get(
  "/:runId",
  handled(async (req, res) => {
    await loadVisibleEscrow(req);
    return res.json(toRun(await loadRun(req)));
  })
);

// Carries out the proposal for the person approving it. Their rights are checked
// again now, against the current status, using the same rules as a manual action.
router.post(
  "/:runId/approve",
  handled(async (req, res) => {
    const user = req.user as User;
    await loadVisibleEscrow(req);
    const before = await loadRun(req);

    if (before.status !== "pending_approval") {
      throw new HttpError(409, `This run can't be approved because its status is '${before.status}'.`);
    }

    const action = before.proposed_action as EscrowAction;

    const body = await db.transaction(async (tx) => {
      const run = await loadRun(req, tx, true);

      if (run.status !== "pending_approval") {
        throw new HttpError(409, `This run can't be approved because its status is '${run.status}'.`);
      }

      return executeAction(
        user,
        String(req.params.id),
        action,
        `Approved by a person from AI proposal ${run.id}. ${run.reasoning ?? ""}`.slice(0, 1000),
        tx,
        {
          sideEffect: async (innerTx, escrow) => {
            // The facts may have changed since the agent looked at them.
            if (escrow.status !== run.escrow_status_at_start) {
              throw new HttpError(
                409,
                "The escrow changed after this proposal was made. Please start a new review."
              );
            }

            await innerTx.query(
              "UPDATE agent_runs SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1",
              [run.id, user.id]
            );
          }
        }
      );
    });

    return res.json(body);
  })
);

router.post(
  "/:runId/decline",
  handled(async (req, res) => {
    const user = req.user as User;
    const escrow = await loadVisibleEscrow(req);
    const run = await loadRun(req);

    // Only a person who could have approved it can decline it.
    const action = run.proposed_action as EscrowAction;
    if (
      run.status === "pending_approval" &&
      !availableActions(escrow.status, rolesOf(user, escrow)).includes(action)
    ) {
      throw new HttpError(403, "Only the person who can take this action can decline it.");
    }

    const updated = await db.query<RunRow>(
      `UPDATE agent_runs SET status = 'declined', decided_by = $2, decided_at = now()
       WHERE id = $1 AND status = 'pending_approval'
       RETURNING *`,
      [run.id, user.id]
    );

    if (!updated.rows[0]) {
      throw new HttpError(409, `This run can't be declined because its status is '${run.status}'.`);
    }

    return res.json(toRun(updated.rows[0]));
  })
);

export default router;
