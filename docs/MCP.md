# MCP server

The MCP server lets an AI app, such as Claude Desktop or Cursor, check escrows in AgentSpend.
It logs in to the normal API as one person, so all the same permission rules apply.

**No tool can move money.** A person still has to take the action in AgentSpend.

| Tool | What it does |
|---|---|
| `check_payment` | Says whether this person may release, refund or dispute right now, and why. A denial tells the AI to stop and ask a person, not retry |
| `list_escrows` | Lists the escrows this person can see |
| `ask_agreement` | Answers a question from the agreement, with checked quotes |

## Why it's built this way

- **Identity comes from settings, not the AI.** The AI can't claim to be someone else, because no
  tool takes a user as input.
- **It uses the API, not the database.** It can't skip a permission rule, because it goes through
  the same routes as the website.
- **A denial gives no extra information.** Someone else's escrow and a missing one get the same answer.

## Try it

Start the API first, and create a test account you don't mind storing in a settings file.
Then add this to your AI app's MCP settings, changing the path and the login:

```json
{
  "mcpServers": {
    "agentspend": {
      "command": "npx",
      "args": ["tsx", "C:/path/to/AgentSpend/server/src/mcp/server.ts"],
      "env": {
        "AGENTSPEND_API_URL": "http://localhost:4000",
        "AGENTSPEND_EMAIL": "buyer@example.test",
        "AGENTSPEND_PASSWORD": "your-test-password"
      }
    }
  }
}
```

Then ask the AI: "Can I release payment on my AgentSpend escrow?"

## Limits

It runs on your own computer and uses a password in a settings file, so it suits one local
person. A shared version would need remote access with proper per-user authorization, such as OAuth.
