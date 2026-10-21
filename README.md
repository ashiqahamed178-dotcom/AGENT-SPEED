# AgentSpend

**A policy-based spending control dashboard for AI agents.**

AgentSpend is a full-stack prototype that demonstrates how autonomous AI agents can submit payment requests while a backend policy engine validates requests and enforces spending limits.

## Features

- Submit payment requests with agent, recipient, amount, and reason.
- Approve requests within a configurable demo spending limit.
- Reject requests exceeding the limit.
- Validate input using Zod.
- View payment history and spending summaries in a React dashboard.
- Persist payment history locally in JSON.
- Automated API tests using Vitest and Supertest.

## Architecture

```text
React + Vite Dashboard
          |
          | HTTP / JSON
          v
Express + TypeScript API
          |
          v
Zod Request Validation
          |
          v
Spending Policy Engine
     /           \
 Approved       Rejected
     \           /
          v
   JSON Persistence
```

## Tech Stack

- Frontend: React, TypeScript, Vite
- Backend: Node.js, Express, TypeScript
- Validation: Zod
- Testing: Vitest, Supertest
- Storage: Local JSON file

## Run Locally

### Start the backend

```bash
cd server
npm install
npm run dev
```

The API runs at `http://localhost:4000`.

Health endpoint: `http://localhost:4000/api/health`

### Start the frontend

Open a second terminal from the project root:

```bash
cd client
npm install
npm run dev
```

Open the local URL printed by Vite.

### Run automated tests

```bash
cd server
npm test
```

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Check API health |
| GET | `/api/payments` | Retrieve payment history |
| POST | `/api/payments` | Submit a payment request |

### Example payment request

```json
{
  "agentName": "Research Agent",
  "recipient": "Demo Store",
  "amount": 50,
  "reason": "Purchase research credits"
}
```

The API returns the payment details, approval status, explanation, unique ID, and timestamp.

## Spending Policy

The current demonstration policy approves requests up to 100 demo USDC and rejects requests above that limit.

## Security and Limitations

- No real funds are transferred.
- Demo USDC amounts are illustrative.
- Payment decisions use deterministic backend rules.
- JSON storage is for local development, not production financial workloads.
- Production use would require authentication, authorization, durable database storage, audit logging, rate limiting, and additional security controls.

## Roadmap

- Configurable per-agent spending limits.
- More detailed policy-decision records.
- Optional AI-generated explanations without allowing AI to override authorization rules.
- A smart-contract policy prototype with automated tests.
- Continuous integration with GitHub Actions.

## Project Status

Portfolio prototype in active development.