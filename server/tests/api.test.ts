
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/index";

describe("AgentSpend API", () => {
  beforeEach(async () => {
    // Requests are tested against the in-memory app.
  });

  it("returns a healthy status", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.app).toBe("AgentSpend");
  });

  it("approves a payment within the demo limit", async () => {
    const response = await request(app)
      .post("/api/payments")
      .send({
        agentName: "Test Agent",
        recipient: "Demo Store",
        amount: 50,
        reason: "Test purchase",
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("approved");
    expect(response.body.amount).toBe(50);
  });

  it("rejects a payment above the demo limit", async () => {
    const response = await request(app)
      .post("/api/payments")
      .send({
        agentName: "Test Agent",
        recipient: "Demo Store",
        amount: 150,
        reason: "Over-limit purchase",
      });

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("rejected");
  });

  it("rejects invalid payment details", async () => {
    const response = await request(app)
      .post("/api/payments")
      .send({
        agentName: "",
        recipient: "Demo Store",
        amount: -10,
        reason: "Invalid test",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid payment details");
  });
});
