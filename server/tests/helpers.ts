import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect } from "vitest";
import { db } from "../src/db";
import app from "../src/index";

export type Session = ReturnType<typeof request.agent> & { email: string; name: string };

export async function createUser(name: string): Promise<Session> {
  // Unique across test files, because CI runs them all on one real database.
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${randomUUID()}@example.com`;
  const agent = request.agent(app);

  const response = await agent
    .post("/api/auth/register")
    .send({ email, name, password: "correct-horse-battery" });

  expect(response.status).toBe(201);

  return Object.assign(agent, { email, name });
}

export async function createArbiter(name = "Test Arbiter"): Promise<Session> {
  const session = await createUser(name);
  await db.query("UPDATE users SET role = 'arbiter' WHERE email = $1", [session.email]);
  return session;
}

export async function createEscrow(
  buyer: Session,
  seller: Session,
  agreementText = "Seller must deliver the completed software project within seven days."
) {
  const response = await buyer.post("/api/escrows").send({
    sellerEmail: seller.email,
    amount: 250,
    currency: "USDC",
    agreementText
  });

  expect(response.status).toBe(201);
  return response.body;
}
