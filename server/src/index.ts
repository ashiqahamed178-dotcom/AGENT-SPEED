
import express from "express";
import cors from "cors";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const app = express();
app.use(cors());
app.use(express.json());

const dataFile = join(
  process.cwd(),
  "data",
  process.env.NODE_ENV === "test" ? "payments.test.json" : "payments.json"
);

type Payment = {
  id: string;
  agentName: string;
  recipient: string;
  amount: number;
  reason: string;
  status: "approved" | "rejected";
  explanation: string;
  createdAt: string;
};

function loadPayments(): Payment[] {
  try {
    return JSON.parse(readFileSync(dataFile, "utf8")) as Payment[];
  } catch {
    return [];
  }
}

let payments: Payment[] = loadPayments();

function savePayments() {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(payments, null, 2), "utf8");
}

const PaymentSchema = z.object({
  agentName: z.string().trim().min(1).max(60),
  recipient: z.string().trim().min(1).max(100),
  amount: z.number().positive().max(1_000_000),
  reason: z.string().trim().min(1).max(300)
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "AgentSpend" });
});

app.get("/api/payments", (_req, res) => {
  res.json(payments);
});

app.post("/api/payments", (req, res) => {
  const parsed = PaymentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid payment details",
      details: parsed.error.flatten()
    });
  }

  const input = parsed.data;
  const approved = input.amount <= 100;

  const payment: Payment = {
    id: randomUUID(),
    ...input,
    status: approved ? "approved" : "rejected",
    explanation: approved
      ? "The request is within the demo limit of 100 USDC."
      : "The request exceeds the demo limit of 100 USDC.",
    createdAt: new Date().toISOString()
  };

  payments.unshift(payment);
  savePayments();

  return res.status(201).json(payment);
});

const port = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV !== "test") {
  app.listen(port, () => {
    console.log(`AgentSpend API running at http://localhost:${port}`);
  });
}

export default app;