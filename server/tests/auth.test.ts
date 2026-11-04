import request from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "../src/db";
import app from "../src/index";
import { createUser } from "./helpers";

const password = "correct-horse-battery";

describe("AgentSpend authentication", () => {
  it("registers a user and starts a session", async () => {
    const agent = request.agent(app);

    const registered = await agent
      .post("/api/auth/register")
      .send({ email: "NEW.User@Example.com", name: "New User", password });

    expect(registered.status).toBe(201);
    expect(registered.body.email).toBe("new.user@example.com");
    expect(registered.body.role).toBe("user");
    expect(registered.body.password_hash).toBeUndefined();

    const cookie = String(registered.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");

    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.name).toBe("New User");
  });

  it("does not store the plain password", async () => {
    const user = await createUser("Hash Check");

    const result = await db.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = $1",
      [user.email]
    );

    expect(result.rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(result.rows[0]?.password_hash).not.toContain(password);
  });

  it("rejects a duplicate email and a short password", async () => {
    const user = await createUser("Duplicate");

    const duplicate = await request(app)
      .post("/api/auth/register")
      .send({ email: user.email, name: "Copy", password });
    expect(duplicate.status).toBe(409);

    const weak = await request(app)
      .post("/api/auth/register")
      .send({ email: "weak@example.com", name: "Weak", password: "short" });
    expect(weak.status).toBe(400);
  });

  it("logs in with the right password only", async () => {
    const user = await createUser("Login User");

    const wrong = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrong-password-here" });
    expect(wrong.status).toBe(401);

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);

    const agent = request.agent(app);
    const right = await agent.post("/api/auth/login").send({ email: user.email, password });
    expect(right.status).toBe(200);
    expect(right.body.password_hash).toBeUndefined();
    expect((await agent.get("/api/auth/me")).status).toBe(200);
  });

  it("ends the session on logout", async () => {
    const user = await createUser("Logout User");

    expect((await user.post("/api/auth/logout")).status).toBe(204);
    expect((await user.get("/api/auth/me")).status).toBe(401);
  });

  it("rejects a forged session cookie", async () => {
    const response = await request(app)
      .get("/api/auth/me")
      .set("Cookie", "agentspend_session=not-a-real-token");

    expect(response.status).toBe(401);
  });
});
