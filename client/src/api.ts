export type User = {
  id: string;
  email: string;
  name: string;
  role: "user" | "arbiter";
};

export type EscrowAction =
  | "fund"
  | "submit_evidence"
  | "start_review"
  | "dispute"
  | "release"
  | "refund";

export type Citation = {
  clauseId: string;
  quote: string;
  clauseText: string;
};

export type Escrow = {
  id: string;
  buyer: { id: string; name: string };
  seller: { id: string; name: string };
  amount: number;
  currency: string;
  agreementText: string;
  agreementHash: string;
  status: string;
  yourRoles: string[];
  availableActions: EscrowAction[];
  evidence: {
    id: string;
    submittedBy: string;
    description: string;
    referenceUrl?: string;
    createdAt: string;
  }[];
  events: {
    id: string;
    action: string;
    actor: string;
    note: string;
    createdAt: string;
  }[];
  createdAt: string;
};

export type AgentRun = {
  id: string;
  status: "running" | "pending_approval" | "no_action" | "approved" | "declined" | "failed";
  proposedAction: "release" | "refund" | "dispute" | "none" | null;
  reasoning: string | null;
  risks: string[];
  citations: Citation[];
  blockedBy: string | null;
  trace: { step: string; detail: string }[];
  error: string | null;
  createdAt: string;
};

export type AskResult = {
  answerable: boolean;
  answer: string;
  citations: Citation[];
  rejectedCitations: number;
  model: string;
};

export type AiInfo = { provider: string; model: string; embeddingModel: string };

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let result: { error?: string } = {};

  try {
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("The server sent an unexpected response.");
  }

  if (!response.ok) {
    throw new Error(result.error ?? "Something went wrong.");
  }

  return result as T;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export const STATUS_LABELS: Record<string, string> = {
  created: "Awaiting funding",
  funded: "Funded",
  delivered: "Delivered",
  under_review: "Under review",
  disputed: "In dispute",
  released: "Released",
  refunded: "Refunded",
};

export function formatAmount(amount: number, currency: string) {
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;
}
