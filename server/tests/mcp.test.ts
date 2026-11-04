import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import app from "../src/index";
import { createMcpServer } from "../src/mcp/tools";
import { createEscrow, createUser } from "./helpers";
import type { Session } from "./helpers";

const PASSWORD = "correct-horse-battery";

describe("MCP server", () => {
  let http: Server;
  let baseUrl: string;
  let buyer: Session;
  let seller: Session;

  beforeAll(async () => {
    http = app.listen(0);
    await new Promise((resolve) => http.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => http.close(resolve));
  });

  beforeEach(async () => {
    buyer = await createUser("MCP Buyer");
    seller = await createUser("MCP Seller");
  });

  async function connect(email: string, password = PASSWORD) {
    const server = createMcpServer({ baseUrl, email, password });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
    return client;
  }

  async function check(client: Client, escrowId: string, action: string) {
    const result = await client.callTool({ name: "check_payment", arguments: { escrowId, action } });
    return JSON.parse((result.content as { text: string }[])[0]?.text ?? "");
  }

  async function underReview() {
    const escrow = await createEscrow(buyer, seller);
    await buyer.post(`/api/escrows/${escrow.id}/fund`).send({});
    await seller.post(`/api/escrows/${escrow.id}/evidence`).send({ description: "Delivered the completed software." });
    await buyer.post(`/api/escrows/${escrow.id}/review`).send({});
    return escrow;
  }

  it("offers no tool that can move money", async () => {
    const client = await connect(buyer.email);
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(["ask_agreement", "check_payment", "list_escrows"]);
    expect(tools.find((tool) => tool.name === "check_payment")?.annotations?.readOnlyHint).toBe(true);
  });

  it("allows only the person the rules allow, and checking changes nothing", async () => {
    const escrow = await underReview();

    const asBuyer = await check(await connect(buyer.email), escrow.id, "release");
    expect(asBuyer.decision).toBe("allowed");
    expect(asBuyer.nextStep).toContain("A person must");

    const asSeller = await check(await connect(seller.email), escrow.id, "release");
    expect(asSeller.decision).toBe("denied");
    expect(asSeller.nextStep).toContain("Don't retry");

    const after = await buyer.get(`/api/escrows/${escrow.id}`);
    expect(after.body.status).toBe("under_review");
  });

  it("gives the same denial for someone else's escrow and a missing one", async () => {
    const escrow = await createEscrow(buyer, seller);
    const stranger = await createUser("MCP Stranger");
    const client = await connect(stranger.email);

    const someoneElses = await check(client, escrow.id, "release");
    const missing = await check(client, "00000000-0000-0000-0000-000000000000", "release");

    expect(someoneElses.decision).toBe("denied");
    expect(someoneElses).toEqual(missing);
  });

  it("rejects an action outside the allowed list", async () => {
    const client = await connect(buyer.email);
    const result = await client.callTool({
      name: "check_payment",
      arguments: { escrowId: "any", action: "transfer_funds" }
    });

    expect(result.isError).toBe(true);
  });

  it("lists only this person's escrows", async () => {
    const escrow = await createEscrow(buyer, seller);
    const stranger = await createUser("MCP Other");

    const listFor = async (session: Session) => {
      const result = await (await connect(session.email)).callTool({ name: "list_escrows", arguments: {} });
      return JSON.parse((result.content as { text: string }[])[0]?.text ?? "") as { id: string }[];
    };

    expect((await listFor(buyer)).map((item) => item.id)).toContain(escrow.id);
    expect((await listFor(stranger)).map((item) => item.id)).not.toContain(escrow.id);
  });

  it("fails clearly when its login settings are wrong", async () => {
    const client = await connect(buyer.email, "wrong-password-here");
    const result = await client.callTool({ name: "list_escrows", arguments: {} });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("login settings");
  });
});
