import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEscrow, createUser } from "./helpers";
import type { Session } from "./helpers";

const agreement =
  "The seller must deliver an AI automation dashboard with source code within seven days. Payment is released after buyer review.";

const validAnalysis = {
  summary: "AI automation dashboard delivery",
  buyer: "Ashiq",
  seller: "Demo AI Seller",
  amount: 250,
  currency: "USDC",
  deadline: "7 days",
  deliverables: ["AI automation dashboard", "Source code"],
  paymentConditions: ["Release after buyer review"],
  risks: ["Delivery delay"],
  missingInformation: ["Detailed acceptance criteria"],
  recommendation: "review",
  reasoning: "The buyer must verify the submitted deliverables."
};

function mockOllama(content: string) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content } })
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentSpend AI Escrow Analysis", () => {
  let buyer: Session;
  let seller: Session;

  beforeEach(async () => {
    buyer = await createUser("Ashiq");
    seller = await createUser("Demo AI Seller");
  });

  it("analyzes an escrow without changing its status", async () => {
    const escrow = await createEscrow(buyer, seller, agreement);

    mockOllama(JSON.stringify(validAnalysis));

    const response = await buyer.post(`/api/escrows/${escrow.id}/analyze`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.transactionId).toBe(escrow.id);
    expect(response.body.model).toBe("llama3.2:3b");
    expect(response.body.analysis.recommendation).toBe("review");
    expect(response.body.analysis.amount).toBe("250");
    expect(response.body.transactionContext.evidenceCount).toBe(0);

    const transaction = await buyer.get(`/api/escrows/${escrow.id}`);
    expect(transaction.body.status).toBe("created");
  });

  it("changes a release recommendation made too early to review", async () => {
    const escrow = await createEscrow(buyer, seller, agreement);

    mockOllama(JSON.stringify({ ...validAnalysis, recommendation: "release" }));

    const response = await seller.post(`/api/escrows/${escrow.id}/analyze`);
    expect(response.status).toBe(200);
    expect(response.body.analysis.recommendation).toBe("review");
    expect(response.body.safetyRuleApplied).toBe(true);

    const transaction = await seller.get(`/api/escrows/${escrow.id}`);
    expect(transaction.body.status).toBe("created");
  });

  it("allows a release recommendation during review, but moves no money", async () => {
    const escrow = await createEscrow(buyer, seller, agreement);
    await buyer.post(`/api/escrows/${escrow.id}/fund`);
    await seller.post(`/api/escrows/${escrow.id}/evidence`).send({
      description: "Delivered the dashboard and the source code to the buyer."
    });
    await buyer.post(`/api/escrows/${escrow.id}/review`);

    mockOllama(JSON.stringify({ ...validAnalysis, recommendation: "release" }));

    const response = await buyer.post(`/api/escrows/${escrow.id}/analyze`);
    expect(response.body.analysis.recommendation).toBe("release");
    expect(response.body.safetyRuleApplied).toBe(false);

    const transaction = await buyer.get(`/api/escrows/${escrow.id}`);
    expect(transaction.body.status).toBe("under_review");
  });

  it("returns 404 for an unknown escrow", async () => {
    const response = await buyer.post("/api/escrows/unknown-transaction/analyze");
    expect(response.status).toBe(404);
  });

  it("rejects an escrow without sufficient agreement text", async () => {
    const escrow = await createEscrow(buyer, seller, "Short agreement");

    const analysis = await buyer.post(`/api/escrows/${escrow.id}/analyze`);
    expect(analysis.status).toBe(400);
  });

  it("handles invalid AI JSON safely", async () => {
    const escrow = await createEscrow(buyer, seller, agreement);

    mockOllama("This is not valid JSON");

    const response = await buyer.post(`/api/escrows/${escrow.id}/analyze`);

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("invalid JSON");
  });

  it("rejects AI responses with an invalid structure", async () => {
    const escrow = await createEscrow(buyer, seller, agreement);

    mockOllama(JSON.stringify({ summary: "Incomplete analysis", recommendation: "release" }));

    const response = await buyer.post(`/api/escrows/${escrow.id}/analyze`);

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("expected format");
  });
});
