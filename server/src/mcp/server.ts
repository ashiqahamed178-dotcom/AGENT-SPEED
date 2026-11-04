// Starts the AgentSpend MCP server for an AI app on this computer.
// stdout carries the protocol, so messages for people must go to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools";

const { AGENTSPEND_API_URL, AGENTSPEND_EMAIL, AGENTSPEND_PASSWORD } = process.env;

if (!AGENTSPEND_EMAIL || !AGENTSPEND_PASSWORD) {
  console.error("Set AGENTSPEND_EMAIL and AGENTSPEND_PASSWORD. AGENTSPEND_API_URL is optional.");
  process.exit(1);
}

const server = createMcpServer({
  baseUrl: (AGENTSPEND_API_URL ?? "http://localhost:4000").replace(/\/+$/, ""),
  email: AGENTSPEND_EMAIL,
  password: AGENTSPEND_PASSWORD
});

server
  .connect(new StdioServerTransport())
  .then(() => console.error("AgentSpend MCP server is ready."))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
