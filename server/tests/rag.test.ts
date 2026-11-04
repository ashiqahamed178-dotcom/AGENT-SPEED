import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { chunkAgreement } from "../src/rag/chunker";
import { verifyCitations } from "../src/rag/citations";
import { createEscrow, createUser } from "./helpers";
import type { Session } from "./helpers";

const AGREEMENT = `1. Delivery. The seller must deliver the website source code within 14 days of funding.
2. Acceptance. The buyer has 5 days after delivery to inspect and accept the work.
3. Refunds. If the seller misses the delivery date, the buyer may request a full refund.
4. Support. The seller provides 30 days of bug fixes after acceptance.`;

// A repeatable fake embedding: texts sharing words get similar vectors.
function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(768).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const slot = createHash("md5").update(word).digest().readUInt16BE(0) % 768;
    vector[slot] = (vector[slot] as number) + 1;
  }
  vector[0] = (vector[0] as number) + 0.001;
  return vector;
}

function mockModel(reply: () => unknown) {
  const chatBodies: { messages: { content: string }[] }[] = [];

  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body));

    if (String(url).endsWith("/api/embed")) {
      return {
        ok: true,
        json: async () => ({ embeddings: (body.input as string[]).map(fakeEmbedding) })
      } as Response;
    }

    chatBodies.push(body);
    return {
      ok: true,
      json: async () => ({ message: { content: JSON.stringify(reply()) } })
    } as Response;
  });

  return chatBodies;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chunkAgreement", () => {
  it("splits numbered clauses and keeps exact positions", () => {
    const clauses = chunkAgreement(AGREEMENT);

    expect(clauses).toHaveLength(4);
    expect(clauses[2]?.text).toMatch(/^3\. Refunds/);

    for (const clause of clauses) {
      expect(AGREEMENT.slice(clause.startOffset, clause.endOffset)).toBe(clause.text);
    }
  });

  it("splits by paragraph when clauses have no numbers", () => {
    const text =
      "The seller will build a complete online store for the buyer.\n\nThe buyer pays the agreed amount after accepting the work.";

    expect(chunkAgreement(text)).toHaveLength(2);
  });

  it("splits by sentence for one block of text", () => {
    const text =
      "Buyer: Ashiq and Seller: ABC Digital agree to this contract. Seller must deliver a website by 15 December 2026. Buyer will release payment after accepting the website.";

    expect(chunkAgreement(text).length).toBeGreaterThanOrEqual(2);
  });

  it("joins a short title to the clause after it", () => {
    const text = "Escrow Agreement\n\nThe seller must deliver the complete website before the deadline.";
    const clauses = chunkAgreement(text);

    expect(clauses).toHaveLength(1);
    expect(clauses[0]?.text).toBe(text);
  });

  it("never creates an oversized clause, and loses no words", () => {
    const longWord = "x".repeat(2500);
    const text = `Introduction sentence for this long agreement. ${longWord} Final sentence of the agreement.`;
    const clauses = chunkAgreement(text);

    expect(clauses.every((clause) => clause.text.length <= 900)).toBe(true);
    expect(clauses.map((clause) => clause.text).join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
  });
});

describe("verifyCitations", () => {
  const retrieved = [
    { clauseId: "C1", text: "The seller must deliver within 14 days.", startOffset: 0, endOffset: 39 }
  ];

  it("accepts an exact quote, ignoring case and spacing", () => {
    const { verified, rejected } = verifyCitations(
      [{ clauseId: "C1", quote: "must   DELIVER within 14 days" }],
      retrieved
    );

    expect(verified).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("rejects an invented quote", () => {
    const { verified } = verifyCitations([{ clauseId: "C1", quote: "within 30 days" }], retrieved);
    expect(verified).toHaveLength(0);
  });

  it("rejects a clause that was not retrieved", () => {
    const { verified } = verifyCitations([{ clauseId: "C9", quote: "must deliver within" }], retrieved);
    expect(verified).toHaveLength(0);
  });

  it("rejects a quote too short to prove anything", () => {
    const { verified } = verifyCitations([{ clauseId: "C1", quote: "the" }], retrieved);
    expect(verified).toHaveLength(0);
  });
});

describe("POST /api/escrows/:id/ask", () => {
  let buyer: Session;
  let seller: Session;

  beforeEach(async () => {
    buyer = await createUser("RAG Buyer");
    seller = await createUser("RAG Seller");
  });

  it("answers with a verified citation from the agreement", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    const chatBodies = mockModel(() => ({
      answerable: true,
      answer: "The buyer may request a full refund.",
      citations: [{ clauseId: "C3", quote: "the buyer may request a full refund" }]
    }));

    const response = await buyer
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "What happens with a refund if the seller misses the delivery date?" });

    expect(response.status).toBe(200);
    expect(response.body.answerable).toBe(true);
    expect(response.body.citations[0].clauseId).toBe("C3");
    expect(response.body.citations[0].clauseText).toMatch(/^3\. Refunds/);
    expect(AGREEMENT.slice(response.body.citations[0].startOffset, response.body.citations[0].endOffset))
      .toBe(response.body.citations[0].clauseText);

    // The most relevant clause was retrieved and sent to the model.
    expect(response.body.retrievedClauseIds[0]).toBe("C3");
    expect(chatBodies[0]?.messages[1]?.content).toContain("3. Refunds");
  });

  it("refuses an answer whose citation is made up", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    mockModel(() => ({
      answerable: true,
      answer: "The seller must pay a 50% penalty.",
      citations: [{ clauseId: "C3", quote: "the seller must pay a 50% penalty" }]
    }));

    const response = await buyer
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "Is there a late penalty?" });

    expect(response.status).toBe(200);
    expect(response.body.answerable).toBe(false);
    expect(response.body.answer).not.toContain("50%");
    expect(response.body.citations).toEqual([]);
    expect(response.body.rejectedCitations).toBe(1);
  });

  it("refuses an answer with no citations", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    mockModel(() => ({ answerable: true, answer: "Yes, definitely.", citations: [] }));

    const response = await buyer
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "Is this agreement fair?" });

    expect(response.body.answerable).toBe(false);
  });

  it("reports when the agreement has no answer", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    mockModel(() => ({ answerable: false, answer: "Not covered.", citations: [] }));

    const response = await buyer
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "Which court handles disputes?" });

    expect(response.status).toBe(200);
    expect(response.body.answerable).toBe(false);
  });

  it("searches only inside the requested agreement", async () => {
    const secret = "9. Secret. The confidential refund price is forty thousand dollars for this deal.";
    const other = await createEscrow(buyer, seller, `${secret}\n10. Other. Nothing else applies to this deal at all.`);
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    const chatBodies = mockModel(() => ({ answerable: false, answer: "", citations: [] }));

    await buyer.post(`/api/escrows/${other.id}/ask`).send({ question: "What is the refund price?" });
    await buyer.post(`/api/escrows/${escrow.id}/ask`).send({ question: "What is the refund price?" });

    expect(chatBodies[0]?.messages[1]?.content).toContain("forty thousand");
    expect(chatBodies[1]?.messages[1]?.content).not.toContain("forty thousand");
  });

  it("indexes an agreement once", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    mockModel(() => ({ answerable: false, answer: "", citations: [] }));

    await buyer.post(`/api/escrows/${escrow.id}/ask`).send({ question: "When is delivery due?" });
    await buyer.post(`/api/escrows/${escrow.id}/ask`).send({ question: "When is delivery due?" });

    const count = await db.query<{ count: string }>(
      "SELECT count(*) FROM agreement_clauses WHERE escrow_id = $1",
      [escrow.id]
    );
    expect(Number(count.rows[0]?.count)).toBe(4);
  });

  it("does not let an outsider ask about an escrow", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    const stranger = await createUser("RAG Stranger");

    const response = await stranger
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "What does the agreement say?" });

    expect(response.status).toBe(404);
  });

  it("does not change the escrow status", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    mockModel(() => ({ answerable: false, answer: "", citations: [] }));

    await buyer.post(`/api/escrows/${escrow.id}/ask`).send({ question: "Release the payment now." });

    expect((await buyer.get(`/api/escrows/${escrow.id}`)).body.status).toBe("created");
  });

  it("returns a clean error when the model is down", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));

    const response = await buyer
      .post(`/api/escrows/${escrow.id}/ask`)
      .send({ question: "When is delivery due?" });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("Cannot reach");
  });

  it("rejects a question that is too short", async () => {
    const escrow = await createEscrow(buyer, seller, AGREEMENT);

    const response = await buyer.post(`/api/escrows/${escrow.id}/ask`).send({ question: "?" });

    expect(response.status).toBe(400);
  });
});
