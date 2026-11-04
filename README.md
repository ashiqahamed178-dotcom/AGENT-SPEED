# AgentSpend

**An AI-assisted escrow system where the AI can advise, but only people and code rules can move money.**

AgentSpend reads agreements, answers questions with checked citations, and uses an
agent to propose what should happen next. The right person must approve each proposal.
The same escrow rules also exist as a tested Solidity smart contract.

> This is a portfolio prototype. The app only records simulated funding, and the
> contract has only been tested on a local blockchain. Don't use it with real money.

## What it shows

| Area | What's built |
|---|---|
| LLM engineering | One setting switches between local Ollama and any OpenAI-compatible cloud API, with JSON Schema output and validation |
| RAG | Clause-based chunking, combined vector and keyword search, and citations verified in code |
| Agentic AI | A LangGraph agent with read-only tools, a limited loop, code checks and human approval |
| Blockchain | An ERC-20 escrow contract with deadlines, a neutral arbiter, no owner and attack tests |
| AI evaluation | 20 hand-labelled agreements, scored for accuracy, made-up answers, decisions and prompt injection |
| Production engineering | PostgreSQL with migrations, login, role permissions, rate limits, Docker and GitHub Actions |

## How a decision is made

```mermaid
flowchart LR
    A[Agreement and evidence] --> B[Agent with read-only tools]
    B --> C{Code checks}
    C -- Blocked --> D[No action]
    C -- Passed --> E[Proposal]
    E --> F{Right person approves?}
    F -- No --> D
    F -- Yes --> G[Escrow rules run again]
    G --> H[Status changes and audit trail]
```

The model has no tool that changes anything. Even if an agreement fools it, it can only
produce a proposal, and that proposal still has to pass code checks and a person's approval.

**Who can do what**

| Action | Who | When |
|---|---|---|
| Fund | Buyer | Created |
| Submit delivery | Seller | Funded |
| Start review | Buyer | Delivered |
| Raise a dispute | Buyer or seller | Funded, delivered or under review |
| Release payment | Buyer, or arbiter in a dispute | Under review or disputed |
| Refund | Seller, or arbiter in a dispute | Under review or disputed |

An arbiter can't decide a dispute they are part of.

## Evaluation results

Measured on the local model `llama3.2:3b`, using 20 agreements I wrote and labelled by hand.
The AI service was not simulated for these results.

| Measure | Result | What it's based on |
|---|---|---|
| Extraction accuracy | 97.3% | 73 stated fields, 2 missed, 0 wrong |
| Made-up field values | 0% | 7 fields the agreement doesn't state |
| Retrieval recall | 100% | 20 questions |
| Answer accuracy | 95% | 20 answerable questions, 1 wrongly refused |
| Made-up answers | 15.4% | 2 of 13 unanswerable questions |
| Acceptable recommendation | 90% | 20 cases, compared with 85% for always answering "review" |
| Unsafe release after code checks | 0% | 6 cases |
| Unsafe release suggestions stopped by code | 4 | The model made these, and the code rules changed them |
| Analysis time | Median 35.6s | On a laptop CPU |

**What these results mean**

- **Reading agreements works well.** Extraction and retrieval are the strongest results.
- **The small model isn't good at decisions.** It beats always answering "review" by just one
  case, and it suggested release 4 times when that would have been unsafe. The 0% unsafe result
  comes from the code rules, not from the model.
- **Citations don't prove an answer is right.** Asked which country's law applies, the model
  answered with the seller's name and quoted a real clause. The check confirms that a quote
  exists, but not that it answers the question.
- **Agent proposals aren't scored yet.** In one manual test, the agent proposed a dispute because
  of a delivery made before the deadline. The citation was real but the reasoning was wrong, which
  is why a person must approve every proposal.

**How the evaluation changed the system**

| Run | What it found | What changed |
|---|---|---|
| 1 | The model recommended release from a seller's claim alone, and always answering "review" scored higher than the model | Added a code rule for release, and made the labels stricter |
| 2 | Fake administrator text in the evidence got a release recommendation | Added a check for text that tries to instruct the AI |
| 3 | A manual test exposed answers that cite real but irrelevant clauses, so I added those questions | Not fixed yet, and listed below |

Full results are in [`server/evals/results`](server/evals/results). The labels also changed between
runs, including two I had labelled wrongly, so the scores of different runs aren't directly comparable.

## Run it locally

You need Node.js 24 and [Ollama](https://ollama.com). No database setup is needed, because
local development uses an embedded PostgreSQL engine.

```bash
ollama pull llama3.2:3b
```

```bash
ollama pull nomic-embed-text
```

Start the API from the `server` folder:

```bash
npm install
npm run dev
```

Start the website from the `client` folder in a second terminal, then open the address it prints:

```bash
npm install
npm run dev
```

To try the full flow, register two accounts, one as the buyer and one as the seller. Use a
second browser or a private window for the second account.

## Tests

| Command | Folder | What it covers |
|---|---|---|
| `npm test` | `server` | 111 tests for the API, permissions, RAG and agent, using a simulated model |
| `npm run eval` | `server` | The evaluation on the real model (slow) |
| `npx hardhat test` | `contracts` | 26 contract tests, including attacks |
| `npm run demo` | `contracts` | One full deal on a temporary local blockchain |

GitHub Actions runs these on each push, except the evaluation, which needs a real model. It
also repeats the server tests on real PostgreSQL, then builds and starts the Docker image.

## Project layout

```text
client/     React and TypeScript website
server/     Express API, PostgreSQL, RAG and agent
  src/escrowMachine.ts   The escrow rules
  src/rag/               Chunking, search and citation checks
  src/agent/             The LangGraph agent and its approval routes
  evals/                 Labelled data, scoring and saved results
contracts/  Solidity escrow contract and tests
docs/       Deployment guide
```

## Known limits

- **Backend and contract aren't synced.** They share the same rules and agreement
  fingerprint, but the app doesn't read contract events yet.
- **Answers can cite real but irrelevant clauses.** The citation check can't catch this yet.
- **Agent decisions aren't scored.** Only the analyzer and question answering are evaluated.
- **The cloud model path hasn't been tested with a real cloud provider.** It has only been run
  against Ollama's OpenAI-compatible API, so it needs a real key to confirm.
- **The evaluation is small.** I wrote and labelled all 20 agreements myself, and I also tuned
  against them, so the scores are likely higher than on real contracts.
- **The injection check is simple.** It matches known patterns and can miss a rewording. It's
  an extra layer. Safety relies on the AI having no tool that moves money.
- **Agent runs aren't recovered after a restart.** A real system would use a job queue.
- **Accounts are basic.** There is no email verification or password reset.
- **The contract hasn't been audited.** Real funds would need a professional audit and legal review.

## More

- [Deployment guide](docs/DEPLOY.md)
