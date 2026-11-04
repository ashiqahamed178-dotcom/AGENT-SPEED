import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import app from "../src/index";
import { createArbiter, createEscrow, createUser } from "./helpers";
import type { Session } from "./helpers";

const evidenceBody = {
  description: "Completed the software project and delivered the source code and documentation.",
  referenceUrl: "https://github.com/example/project"
};

describe("AgentSpend Escrow Engine", () => {
  let buyer: Session;
  let seller: Session;

  beforeEach(async () => {
    buyer = await createUser("Test Buyer");
    seller = await createUser("Test Seller");
  });

  async function reachUnderReview(id: string) {
    expect((await buyer.post(`/api/escrows/${id}/fund`)).status).toBe(200);
    expect((await seller.post(`/api/escrows/${id}/evidence`).send(evidenceBody)).status).toBe(200);
    expect((await buyer.post(`/api/escrows/${id}/review`)).status).toBe(200);
  }

  async function reachDisputed(id: string) {
    expect((await buyer.post(`/api/escrows/${id}/fund`)).status).toBe(200);
    const dispute = await buyer
      .post(`/api/escrows/${id}/dispute`)
      .send({ reason: "The seller failed to deliver the agreed software project." });
    expect(dispute.status).toBe(200);
    expect(dispute.body.status).toBe("disputed");
  }

  it("completes the successful escrow lifecycle", async () => {
    const escrow = await createEscrow(buyer, seller);

    expect(escrow.status).toBe("created");
    expect(escrow.buyer.name).toBe("Test Buyer");
    expect(escrow.seller.name).toBe("Test Seller");
    expect(escrow.yourRoles).toEqual(["buyer"]);
    expect(escrow.availableActions).toEqual(["fund"]);

    await reachUnderReview(escrow.id);

    const released = await buyer.post(`/api/escrows/${escrow.id}/release`);

    expect(released.status).toBe(200);
    expect(released.body.status).toBe("released");
    expect(released.body.evidence).toHaveLength(1);
    expect(released.body.events.map((event: { action: string }) => event.action)).toEqual([
      "created",
      "funded_simulated",
      "evidence_submitted",
      "review_started",
      "release_simulated"
    ]);
    expect(released.body.events[4].actor).toBe("Test Buyer");
  });

  it("gives the agreement the same fingerprint the smart contract uses", async () => {
    const escrow = await createEscrow(buyer, seller, "hello");

    // The published keccak256 value of the text "hello".
    expect(escrow.agreementHash).toBe(
      "0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8"
    );
  });

  it("requires a login", async () => {
    const response = await request(app).get("/api/escrows");
    expect(response.status).toBe(401);
  });

  it("does not let the seller release payment to themselves", async () => {
    const escrow = await createEscrow(buyer, seller);
    await reachUnderReview(escrow.id);

    const response = await seller.post(`/api/escrows/${escrow.id}/release`);

    expect(response.status).toBe(403);
    expect((await buyer.get(`/api/escrows/${escrow.id}`)).body.status).toBe("under_review");
  });

  it("does not let the buyer submit the seller's evidence or take a refund", async () => {
    const escrow = await createEscrow(buyer, seller);
    await buyer.post(`/api/escrows/${escrow.id}/fund`);

    const evidence = await buyer.post(`/api/escrows/${escrow.id}/evidence`).send(evidenceBody);
    expect(evidence.status).toBe(403);

    await seller.post(`/api/escrows/${escrow.id}/evidence`).send(evidenceBody);
    await buyer.post(`/api/escrows/${escrow.id}/review`);

    const refund = await buyer.post(`/api/escrows/${escrow.id}/refund`);
    expect(refund.status).toBe(403);
  });

  it("lets the seller voluntarily refund during review", async () => {
    const escrow = await createEscrow(buyer, seller);
    await reachUnderReview(escrow.id);

    const refund = await seller.post(`/api/escrows/${escrow.id}/refund`);

    expect(refund.status).toBe(200);
    expect(refund.body.status).toBe("refunded");
  });

  it("hides an escrow from anyone outside it", async () => {
    const escrow = await createEscrow(buyer, seller);
    const stranger = await createUser("Stranger");

    expect((await stranger.get(`/api/escrows/${escrow.id}`)).status).toBe(404);
    expect((await stranger.post(`/api/escrows/${escrow.id}/fund`)).status).toBe(404);
    expect((await stranger.post(`/api/escrows/${escrow.id}/analyze`)).status).toBe(404);
    expect((await stranger.get("/api/escrows")).body).toEqual([]);
  });

  it("ignores identity fields sent by the client", async () => {
    const response = await buyer.post("/api/escrows").send({
      sellerEmail: seller.email,
      amount: 10,
      currency: "USDC",
      buyer: "Someone Else",
      actor: "Someone Else"
    });

    expect(response.status).toBe(201);
    expect(response.body.buyer.name).toBe("Test Buyer");
    expect(response.body.events[0].actor).toBe("Test Buyer");
  });

  it("requires a registered seller who is not the buyer", async () => {
    const unknown = await buyer.post("/api/escrows").send({
      sellerEmail: "nobody@example.com",
      amount: 10,
      currency: "USDC"
    });
    expect(unknown.status).toBe(400);

    const self = await buyer.post("/api/escrows").send({
      sellerEmail: buyer.email,
      amount: 10,
      currency: "USDC"
    });
    expect(self.status).toBe(400);
  });

  it("prevents duplicate funding, including at the same moment", async () => {
    const escrow = await createEscrow(buyer, seller);

    const results = await Promise.all([
      buyer.post(`/api/escrows/${escrow.id}/fund`),
      buyer.post(`/api/escrows/${escrow.id}/fund`),
      buyer.post(`/api/escrows/${escrow.id}/fund`)
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 409, 409]);

    const final = await buyer.get(`/api/escrows/${escrow.id}`);
    expect(final.body.events).toHaveLength(2);
  });

  it("prevents invalid lifecycle transitions", async () => {
    const escrow = await createEscrow(buyer, seller);

    const release = await buyer.post(`/api/escrows/${escrow.id}/release`);
    expect(release.status).toBe(409);

    const evidence = await seller.post(`/api/escrows/${escrow.id}/evidence`).send(evidenceBody);
    expect(evidence.status).toBe(409);
  });

  it("makes a released escrow final", async () => {
    const escrow = await createEscrow(buyer, seller);
    await reachUnderReview(escrow.id);
    await buyer.post(`/api/escrows/${escrow.id}/release`);

    const refund = await seller.post(`/api/escrows/${escrow.id}/refund`);
    expect(refund.status).toBe(409);

    const dispute = await buyer
      .post(`/api/escrows/${escrow.id}/dispute`)
      .send({ reason: "Trying to dispute after the release." });
    expect(dispute.status).toBe(409);
  });

  describe("disputes", () => {
    it("does not let either party decide their own dispute", async () => {
      const escrow = await createEscrow(buyer, seller);
      await reachDisputed(escrow.id);

      expect((await buyer.post(`/api/escrows/${escrow.id}/refund`)).status).toBe(403);
      expect((await seller.post(`/api/escrows/${escrow.id}/release`)).status).toBe(403);
    });

    it("lets a neutral arbiter refund a dispute", async () => {
      const arbiter = await createArbiter();
      const escrow = await createEscrow(buyer, seller);
      await reachDisputed(escrow.id);

      const refund = await arbiter
        .post(`/api/escrows/${escrow.id}/refund`)
        .send({ note: "Refund approved after reviewing the dispute." });

      expect(refund.status).toBe(200);
      expect(refund.body.status).toBe("refunded");
      expect(refund.body.events.at(-1).actor).toBe("Test Arbiter");
    });

    it("lets a neutral arbiter release a dispute", async () => {
      const arbiter = await createArbiter();
      const escrow = await createEscrow(buyer, seller);
      await reachDisputed(escrow.id);

      const release = await arbiter.post(`/api/escrows/${escrow.id}/release`);

      expect(release.status).toBe(200);
      expect(release.body.status).toBe("released");
    });

    it("does not let an arbiter decide a dispute they are part of", async () => {
      const arbiterBuyer = await createArbiter("Arbiter Buyer");
      const escrow = await createEscrow(arbiterBuyer, seller);

      await arbiterBuyer.post(`/api/escrows/${escrow.id}/fund`);
      await arbiterBuyer
        .post(`/api/escrows/${escrow.id}/dispute`)
        .send({ reason: "Trying to win my own dispute as an arbiter." });

      const refund = await arbiterBuyer.post(`/api/escrows/${escrow.id}/refund`);
      expect(refund.status).toBe(403);
    });

    it("hides escrows from arbiters unless there is a dispute", async () => {
      const arbiter = await createArbiter();
      const escrow = await createEscrow(buyer, seller);

      expect((await arbiter.get(`/api/escrows/${escrow.id}`)).status).toBe(404);
      expect((await arbiter.post(`/api/escrows/${escrow.id}/fund`)).status).toBe(404);

      await reachDisputed(escrow.id);

      const visible = await arbiter.get(`/api/escrows/${escrow.id}`);
      expect(visible.status).toBe(200);
      expect(visible.body.availableActions).toEqual(["release", "refund"]);

      const list = await arbiter.get("/api/escrows");
      expect(list.body.map((item: { id: string }) => item.id)).toContain(escrow.id);
    });
  });

  it("protects the audit trail in the database", async () => {
    const escrow = await createEscrow(buyer, seller);

    await expect(
      db.query("DELETE FROM escrow_events WHERE escrow_id = $1", [escrow.id])
    ).rejects.toThrow(/append-only/);

    await expect(
      db.query("UPDATE escrow_events SET note = 'edited' WHERE escrow_id = $1", [escrow.id])
    ).rejects.toThrow(/append-only/);
  });

  it("rejects invalid escrow creation details", async () => {
    const response = await buyer.post("/api/escrows").send({
      sellerEmail: "not-an-email",
      amount: -100,
      currency: "USDC"
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid escrow details.");
  });

  it("rejects evidence links that are not web addresses", async () => {
    const escrow = await createEscrow(buyer, seller);
    await buyer.post(`/api/escrows/${escrow.id}/fund`);

    const response = await seller.post(`/api/escrows/${escrow.id}/evidence`).send({
      description: "Delivered everything that was agreed.",
      referenceUrl: "javascript:alert(1)"
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown transaction", async () => {
    const malformed = await buyer.get("/api/escrows/unknown-transaction-id");
    expect(malformed.status).toBe(404);

    const missing = await buyer.get("/api/escrows/00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
  });
});
