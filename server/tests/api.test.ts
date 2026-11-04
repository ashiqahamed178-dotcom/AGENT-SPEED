import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { createUser } from "./helpers";
import type { Session } from "./helpers";

describe("AgentSpend API", () => {
  let user: Session;

  beforeAll(async () => {
    user = await createUser("Payment User");
  });

  it("returns a healthy status without logging in", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.app).toBe("AgentSpend");
  });

  it("requires a login to use payments", async () => {
    const response = await request(app).get("/api/payments");

    expect(response.status).toBe(401);
  });

  it("approves a payment within the demo limit", async () => {
    const response = await user.post("/api/payments").send({
      agentName: "Test Agent",
      recipient: "Demo Store",
      amount: 50,
      reason: "Test purchase"
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved");
    expect(response.body.amount).toBe(50);
  });

  it("rejects a payment above the demo limit", async () => {
    const response = await user.post("/api/payments").send({
      agentName: "Test Agent",
      recipient: "Demo Store",
      amount: 150,
      reason: "Over-limit purchase"
    });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("rejected");
  });

  it("rejects invalid payment details", async () => {
    const response = await user.post("/api/payments").send({
      agentName: "",
      recipient: "Demo Store",
      amount: -10,
      reason: "Invalid test"
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid payment details");
  });

  it("only shows users their own payments", async () => {
    const other = await createUser("Other User");

    const created = await user.post("/api/payments").send({
      agentName: "Test Agent",
      recipient: "Private Store",
      amount: 10,
      reason: "Private purchase"
    });
    expect(created.status).toBe(201);

    const list = await other.get("/api/payments");

    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it("returns a clean error for malformed JSON", async () => {
    const response = await user
      .post("/api/payments")
      .set("Content-Type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request.");
  });
});
