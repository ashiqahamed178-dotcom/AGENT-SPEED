import cookieParser from "cookie-parser";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { join } from "node:path";
import { z } from "zod";
import agentRouter from "./agent/routes";
import { analyzeAgreement, sendAnalysisError } from "./aiAnalysis";
import authRouter, { requireAuth } from "./auth";
import type { User } from "./auth";
import { config } from "./config";
import { db } from "./db";
import escrowRouter from "./escrow";
import { activeModel } from "./llm";

const app = express();

// In production the app runs behind one hosting proxy. Rate limiting needs
// this to see the real visitor address.
if (config.isProduction) {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// AI calls are slow and can cost money, so they have a stricter limit.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skip: (req) => config.isTest || !/\/(analyze|analyze-agreement|ask)$/.test(req.path),
  message: { error: "Too many AI requests. Please try again later." }
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "AgentSpend", ai: activeModel() });
});

app.use("/api/auth", authRouter);
app.use("/api/escrows/:id/agent-runs", requireAuth, agentRouter);
app.use("/api/escrows", requireAuth, aiLimiter, escrowRouter);

type PaymentRow = {
  id: string;
  agent_name: string;
  recipient: string;
  amount: string;
  reason: string;
  status: "approved" | "rejected";
  explanation: string;
  created_at: Date;
};

function toPayment(row: PaymentRow) {
  return {
    id: row.id,
    agentName: row.agent_name,
    recipient: row.recipient,
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    explanation: row.explanation,
    createdAt: row.created_at
  };
}

const PaymentSchema = z.object({
  agentName: z.string().trim().min(1).max(60),
  recipient: z.string().trim().min(1).max(100),
  amount: z.number().positive().max(1_000_000).multipleOf(0.01),
  reason: z.string().trim().min(1).max(300)
});

const AgreementSchema = z.object({
  agreementText: z.string().trim().min(30).max(15000)
});

app.get("/api/payments", requireAuth, async (req, res) => {
  const user = req.user as User;
  const result = await db.query<PaymentRow>(
    "SELECT * FROM payment_requests WHERE user_id = $1 ORDER BY created_at DESC",
    [user.id]
  );
  res.json(result.rows.map(toPayment));
});

app.post("/api/payments", requireAuth, async (req, res) => {
  const user = req.user as User;
  const parsed = PaymentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payment details",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;
  const approved = input.amount <= 100;

  const result = await db.query<PaymentRow>(
    `INSERT INTO payment_requests
       (user_id, agent_name, recipient, amount, reason, status, explanation)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      user.id,
      input.agentName,
      input.recipient,
      input.amount,
      input.reason,
      approved ? "approved" : "rejected",
      approved
        ? "The request is within the demo limit of 100 USDC."
        : "The request exceeds the demo limit of 100 USDC."
    ]
  );

  return res.status(201).json(toPayment(result.rows[0] as PaymentRow));
});

// Local AI agreement analysis. This endpoint never moves funds.
app.post("/api/ai/analyze-agreement", requireAuth, aiLimiter, async (req, res) => {
  const parsed = AgreementSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Please provide agreementText containing 30 to 15000 characters.",
      details: parsed.error.flatten()
    });
  }

  const result = await analyzeAgreement(parsed.data.agreementText);

  if (!result.ok) return sendAnalysisError(res, result);

  return res.json({
    success: true,
    model: result.model,
    analysis: result.analysis,
    disclaimer:
      "AI-generated analysis only. Verify all terms and evidence. This endpoint does not authorize or execute payments."
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

// In production one server provides both the API and the website. Using one
// address means the session cookie works without any cross-site setup.
const clientDist = join(process.cwd(), "..", "client", "dist");

if (config.isProduction) {
  app.use(express.static(clientDist));
  app.use((_req, res) => {
    res.sendFile(join(clientDist, "index.html"));
  });
}

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(error);

  // Errors from Express itself, such as a malformed JSON body.
  const status = (error as { status?: number }).status;

  if (typeof status === "number" && status >= 400 && status < 500) {
    return res.status(status).json({ error: "Invalid request." });
  }

  console.error("Unhandled error:", error);
  return res.status(500).json({ error: "Something went wrong." });
});

if (!config.isTest) {
  app.listen(config.port, () => {
    console.log(`AgentSpend API running at http://localhost:${config.port}`);
  });
}

export default app;
