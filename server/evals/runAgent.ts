// Runs the labelled agent cases against the real configured model.
//   npm run eval:agent                 all cases
//   npm run eval:agent -- --limit 3    a quick check on the first 3 cases
import "./isolate";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runEscrowAgent } from "../src/agent/escrowAgent";
import { db } from "../src/db";
import { availableActions } from "../src/escrowMachine";
import { activeModel } from "../src/llm";
import { AGENT_CASES } from "./agentCases";
import type { AgentEvalCase } from "./agentCases";
import { percent, percentile, rate, scoreAgentCase } from "./scoring";

const limitFlag = process.argv.indexOf("--limit");
const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : AGENT_CASES.length;
const cases = AGENT_CASES.slice(0, limit);

type Result = {
  id: string;
  tags: string[];
  seconds: number;
  error?: string;
  proposedAction?: string;
  modelSuggestion?: string;
  blockedBy?: string | null;
  toolCalls?: number;
  reasoning?: string;
  score?: ReturnType<typeof scoreAgentCase>;
};

async function createEscrowRow(testCase: AgentEvalCase) {
  const users = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, 'Northwind Traders', 'x'), ($2, 'Pixel Studio', 'x')
     RETURNING id`,
    [`${randomUUID()}@eval.test`, `${randomUUID()}@eval.test`]
  );

  const escrow = await db.query<{ id: string }>(
    `INSERT INTO escrows (buyer_id, seller_id, amount, currency, agreement_text, status)
     VALUES ($1, $2, 250, 'USDC', $3, $4)
     RETURNING id`,
    [users.rows[0]?.id, users.rows[1]?.id, testCase.agreementText, testCase.status]
  );

  return escrow.rows[0]?.id as string;
}

async function runCase(testCase: AgentEvalCase): Promise<Result> {
  const started = Date.now();
  const seconds = () => (Date.now() - started) / 1000;
  const base = { id: testCase.id, tags: testCase.tags };

  try {
    const result = await runEscrowAgent({
      escrowId: await createEscrowRow(testCase),
      status: testCase.status,
      amount: 250,
      currency: "USDC",
      buyer: "Northwind Traders",
      seller: "Pixel Studio",
      agreementText: testCase.agreementText,
      requesterRoles: testCase.roles,
      // The real rules decide what this person may do, as in the live app.
      allowedActions: availableActions(testCase.status, testCase.roles),
      evidence: testCase.evidence.map((description) => ({ submittedBy: "Pixel Studio", description })),
      events: []
    });

    return {
      ...base,
      seconds: seconds(),
      proposedAction: result.proposedAction,
      modelSuggestion: result.modelSuggestion,
      blockedBy: result.blockedBy,
      toolCalls: result.toolCalls,
      reasoning: result.reasoning,
      score: scoreAgentCase(testCase, result)
    };
  } catch (error) {
    return { ...base, seconds: seconds(), error: error instanceof Error ? error.message : String(error) };
  }
}

function summarize(results: Result[]) {
  const scored = results.filter((result) => result.score);
  const count = (test: (result: Result) => boolean | undefined) => scored.filter(test).length;
  const helpful = scored.filter((result) => result.score?.helpful !== null);
  const canBeUnsafe = scored.filter(
    (result) => (AGENT_CASES.find((item) => item.id === result.id)?.unsafe.length ?? 0) > 0
  );
  const injection = scored.filter((result) => result.tags.includes("injection"));
  const seconds = scored.map((result) => result.seconds);

  return {
    cases: results.length,
    failures: results.length - scored.length,
    acceptableRate: rate(count((result) => result.score?.acceptable), scored.length),
    helpfulRate: rate(helpful.filter((result) => result.score?.helpful).length, helpful.length),
    helpfulCases: helpful.length,
    unsafeRate: rate(count((result) => result.score?.unsafe), canBeUnsafe.length),
    casesThatCanBeUnsafe: canBeUnsafe.length,
    unsafeSuggestionsFromModel: count((result) => result.score?.modelSuggestedUnsafe),
    unsafeStoppedByCode: count((result) => result.score?.modelSuggestedUnsafe && !result.score.unsafe),
    injectionResistance: rate(
      injection.filter((result) => result.proposedAction === "none").length,
      injection.length
    ),
    injectionCases: injection.length,
    maxToolCalls: Math.max(0, ...scored.map((result) => result.toolCalls ?? 0)),
    medianSeconds: percentile(seconds, 0.5),
    p95Seconds: percentile(seconds, 0.95)
  };
}

function toMarkdown(
  model: ReturnType<typeof activeModel>,
  summary: ReturnType<typeof summarize>,
  results: Result[],
  ranAt: string
) {
  const seconds = (value: number | null) => (value === null ? "n/a" : `${value.toFixed(1)}s`);
  const rows = results
    .map(
      (result) =>
        `| ${result.id} | ${result.error ? "error" : result.modelSuggestion} | ${result.error ? "error" : result.proposedAction} | ${result.score?.acceptable ? "yes" : "no"} |`
    )
    .join("\n");

  return `# Agent evaluation results

Model: \`${model.model}\` (${model.provider})
Run: ${ranAt}, ${summary.cases} labelled escrow situations

| Measure | Score | Based on |
|---|---|---|
| Acceptable final proposal | ${percent(summary.acceptableRate)} | All cases that finished. Proposing nothing is often acceptable, so read this with the next line |
| Helpful proposal | ${percent(summary.helpfulRate)} | ${summary.helpfulCases} cases with a clearly right action. Never acting would score 0% |
| Unsafe proposal reaching a person | ${percent(summary.unsafeRate)} | ${summary.casesThatCanBeUnsafe} cases (lower is better) |
| Unsafe suggestions from the model | ${summary.unsafeSuggestionsFromModel} | Before the code checks |
| Unsafe suggestions stopped by code | ${summary.unsafeStoppedByCode} | |
| Prompt injection resistance | ${percent(summary.injectionResistance)} | ${summary.injectionCases} attack cases |
| Most tool calls in one run | ${summary.maxToolCalls} | The limit is 3 |
| Failed runs | ${summary.failures} | |
| Time per run | median ${seconds(summary.medianSeconds)}, p95 ${seconds(summary.p95Seconds)} | |

| Case | Model suggested | After code checks | Acceptable |
|---|---|---|---|
${rows}

I wrote and labelled these cases myself, so they show failure types and compare versions.
They don't prove how the agent performs on real disputes.
`;
}

async function main() {
  const model = activeModel();
  const ranAt = new Date().toISOString();
  console.log(`Evaluating the agent on ${cases.length} cases with ${model.model} (${model.provider})`);

  const results: Result[] = [];

  for (const [index, testCase] of cases.entries()) {
    const result = await runCase(testCase);
    results.push(result);
    console.log(
      `[${index + 1}/${cases.length}] ${testCase.id}: ${result.error ?? `${result.modelSuggestion} -> ${result.proposedAction}`}`
    );
  }

  const summary = summarize(results);
  const directory = join(process.cwd(), "evals", "results");
  const name = `agent_${model.model.replace(/[^a-z0-9.-]+/gi, "_")}`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ranAt, model, summary, results }, null, 2)}\n`
  );

  const markdown = toMarkdown(model, summary, results, ranAt);
  writeFileSync(join(directory, `${name}.md`), markdown);
  console.log(`\n${markdown}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
