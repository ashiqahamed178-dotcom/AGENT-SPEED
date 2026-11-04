// Runs the labelled cases against the real configured model and reports scores.
//   npm run eval                 all cases
//   npm run eval -- --limit 3    a quick check on the first 3 cases
import "./isolate";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeTransaction } from "../src/aiAnalysis";
import { db } from "../src/db";
import { activeModel } from "../src/llm";
import { answerQuestion } from "../src/rag/agreementRag";
import { CASES } from "./cases";
import { percent, percentile, rate, scoreDecision, scoreField, scoreQuestion } from "./scoring";
import type { FieldOutcome, QuestionOutcome } from "./scoring";

const limitFlag = process.argv.indexOf("--limit");
const limit = limitFlag >= 0 ? Number(process.argv[limitFlag + 1]) : CASES.length;
const cases = CASES.slice(0, limit);
// A quick RAG check while developing. Its results aren't saved, so the published
// files always come from a full run.
const questionsOnly = process.argv.includes("--questions-only");

const FIELDS = ["buyer", "seller", "amount", "deadline"] as const;

type CaseResult = {
  id: string;
  tags: string[];
  analysisError?: string;
  analysisSeconds: number;
  fields?: Record<string, { expected: string | null; actual: string; outcome: FieldOutcome }>;
  decision?: { actual: string; acceptable: boolean; forbidden: boolean; guardApplied: boolean };
  questions: {
    question: string;
    error?: string;
    seconds: number;
    answer?: string;
    answerable?: boolean;
    rejectedCitations?: number;
    verifiedCitations?: number;
    refusedBy?: string | null;
    score?: QuestionOutcome;
  }[];
};

async function createEscrowRow(agreementText: string) {
  const users = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash)
     VALUES ($1, 'Eval Buyer', 'x'), ($2, 'Eval Seller', 'x')
     RETURNING id`,
    [`${randomUUID()}@eval.test`, `${randomUUID()}@eval.test`]
  );

  const escrow = await db.query<{ id: string }>(
    `INSERT INTO escrows (buyer_id, seller_id, amount, currency, agreement_text, status)
     VALUES ($1, $2, 1, 'USDC', $3, 'created')
     RETURNING id`,
    [users.rows[0]?.id, users.rows[1]?.id, agreementText]
  );

  return escrow.rows[0]?.id as string;
}

async function timed<T>(work: () => Promise<T>) {
  const started = Date.now();
  const value = await work();
  return { value, seconds: (Date.now() - started) / 1000 };
}

async function runCase(testCase: (typeof CASES)[number]): Promise<CaseResult> {
  // The model only sees the agreement and evidence. Structured fields are left
  // out, so it can't score points by copying values it was already given.
  const analysis = questionsOnly
    ? null
    : await timed(() =>
        analyzeTransaction({
          currentStatus: testCase.status,
          agreementText: testCase.agreementText,
          evidence: testCase.evidence
        })
      );

  const result: CaseResult = {
    id: testCase.id,
    tags: testCase.tags,
    analysisSeconds: analysis?.seconds ?? 0,
    questions: []
  };

  if (!analysis) {
    // Skipped on purpose.
  } else if (analysis.value.ok) {
    const { analysis: output } = analysis.value;
    result.fields = Object.fromEntries(
      FIELDS.map((field) => [
        field,
        {
          expected: testCase.expected[field],
          actual: output[field],
          outcome: scoreField(testCase.expected[field], output[field])
        }
      ])
    );
    result.decision = {
      actual: output.recommendation,
      guardApplied: analysis.value.guardApplied,
      ...scoreDecision(testCase.expected, output.recommendation)
    };
  } else {
    result.analysisError = analysis.value.error;
  }

  const escrowId = await createEscrowRow(testCase.agreementText);

  for (const question of testCase.questions) {
    try {
      const { value, seconds } = await timed(() =>
        answerQuestion(escrowId, testCase.agreementText, question.question)
      );

      const clauses = await db.query<{ position: number; text: string }>(
        "SELECT position, text FROM agreement_clauses WHERE escrow_id = $1",
        [escrowId]
      );
      const retrievedClauseTexts = clauses.rows
        .filter((clause) => value.retrievedClauseIds.includes(`C${clause.position}`))
        .map((clause) => clause.text);

      result.questions.push({
        question: question.question,
        seconds,
        answer: value.answer,
        answerable: value.answerable,
        rejectedCitations: value.rejectedCitations,
        verifiedCitations: value.citations.length,
        refusedBy: value.refusedBy,
        score: scoreQuestion(question, {
          answerable: value.answerable,
          answer: value.answer,
          retrievedClauseTexts
        })
      });
    } catch (error) {
      result.questions.push({
        question: question.question,
        seconds: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return result;
}

function summarize(results: CaseResult[]) {
  const fields = results.flatMap((result) => Object.values(result.fields ?? {}));
  const outcomeCount = (outcome: FieldOutcome) =>
    fields.filter((field) => field.outcome === outcome).length;

  const statedFields = fields.filter((field) => field.expected !== null);
  const absentFields = fields.filter((field) => field.expected === null);

  const decided = results.filter((result) => result.decision);
  const injection = results.filter((result) => result.tags.includes("injection") && result.decision);
  const manipulable = decided.filter((result) => {
    const testCase = CASES.find((item) => item.id === result.id);
    return (testCase?.expected.forbiddenRecommendations?.length ?? 0) > 0;
  });

  const questions = results.flatMap((result) => result.questions);
  const scored = questions.filter((question) => question.score);
  const outcome = (name: QuestionOutcome["outcome"]) =>
    scored.filter((question) => question.score?.outcome === name).length;
  const answerableCount = outcome("correct") + outcome("wrong_answer") + outcome("false_refusal");
  const unanswerableCount = outcome("correct_refusal") + outcome("made_up_answer");
  const retrievals = scored.filter((question) => question.score?.retrievalHit !== null);

  const analysisSeconds = results.map((result) => result.analysisSeconds);
  const questionSeconds = scored.map((question) => question.seconds);

  return {
    cases: results.length,
    extraction: {
      accuracyOnStatedFields: rate(outcomeCount("correct"), statedFields.length),
      statedFields: statedFields.length,
      wrong: outcomeCount("wrong"),
      missed: outcomeCount("missed"),
      madeUpRateOnAbsentFields: rate(outcomeCount("made_up"), absentFields.length),
      absentFields: absentFields.length
    },
    decisions: {
      acceptableRate: rate(decided.filter((result) => result.decision?.acceptable).length, decided.length),
      decided: decided.length,
      // A "model" that always answers review. A useful system has to beat this.
      alwaysReviewBaseline: rate(
        decided.filter((result) =>
          CASES.find((item) => item.id === result.id)?.expected.acceptableRecommendations.includes("review")
        ).length,
        decided.length
      ),
      unsafeReleasesStoppedByCode: decided.filter((result) => result.decision?.guardApplied).length,
      unsafeReleaseRate: rate(
        manipulable.filter((result) => result.decision?.forbidden).length,
        manipulable.length
      ),
      casesWhereReleaseIsUnsafe: manipulable.length,
      injectionResistance: rate(
        injection.filter((result) => !result.decision?.forbidden).length,
        injection.length
      ),
      injectionCases: injection.length
    },
    rag: {
      retrievalRecall: rate(
        retrievals.filter((question) => question.score?.retrievalHit).length,
        retrievals.length
      ),
      retrievalChecks: retrievals.length,
      answerAccuracy: rate(outcome("correct"), answerableCount),
      answerableQuestions: answerableCount,
      wrongAnswers: outcome("wrong_answer"),
      falseRefusals: outcome("false_refusal"),
      madeUpAnswerRate: rate(outcome("made_up_answer"), unanswerableCount),
      unanswerableQuestions: unanswerableCount,
      citationsRejectedByVerifier: scored.reduce(
        (total, question) => total + (question.rejectedCitations ?? 0),
        0
      )
    },
    reliability: {
      analysisFailures: results.filter((result) => result.analysisError).length,
      questionFailures: questions.filter((question) => question.error).length
    },
    latencySeconds: {
      analysisMedian: percentile(analysisSeconds, 0.5),
      analysisP95: percentile(analysisSeconds, 0.95),
      questionMedian: percentile(questionSeconds, 0.5),
      questionP95: percentile(questionSeconds, 0.95)
    }
  };
}

function toMarkdown(model: ReturnType<typeof activeModel>, summary: ReturnType<typeof summarize>, ranAt: string) {
  const { extraction: e, decisions: d, rag: r, reliability: l, latencySeconds: t } = summary;
  const seconds = (value: number | null) => (value === null ? "n/a" : `${value.toFixed(1)}s`);

  return `# AI evaluation results

Model: \`${model.model}\` (${model.provider}), embeddings: \`${model.embeddingModel}\`
Run: ${ranAt}, ${summary.cases} labelled agreements

| Measure | Score | Based on |
|---|---|---|
| Extraction accuracy | ${percent(e.accuracyOnStatedFields)} | ${e.statedFields} stated fields (${e.wrong} wrong, ${e.missed} missed) |
| Made-up values | ${percent(e.madeUpRateOnAbsentFields)} | ${e.absentFields} fields the agreement doesn't state (lower is better) |
| Defensible recommendation | ${percent(d.acceptableRate)} | ${d.decided} cases |
| Always answering "review", for comparison | ${percent(d.alwaysReviewBaseline)} | The same ${d.decided} cases |
| Unsafe "release" recommendation | ${percent(d.unsafeReleaseRate)} | ${d.casesWhereReleaseIsUnsafe} cases (lower is better) |
| Unsafe releases stopped by the code rule | ${d.unsafeReleasesStoppedByCode} | The model suggested these, and code changed them to review |
| Prompt injection resistance | ${percent(d.injectionResistance)} | ${d.injectionCases} attack cases |
| Retrieval recall | ${percent(r.retrievalRecall)} | ${r.retrievalChecks} questions |
| Answer accuracy | ${percent(r.answerAccuracy)} | ${r.answerableQuestions} answerable questions (${r.wrongAnswers} wrong, ${r.falseRefusals} wrongly refused) |
| Made-up answers | ${percent(r.madeUpAnswerRate)} | ${r.unanswerableQuestions} unanswerable questions (lower is better) |
| Citations blocked by the verifier | ${r.citationsRejectedByVerifier} | All questions |
| Failed AI calls | ${l.analysisFailures + l.questionFailures} | All calls |
| Analysis time | median ${seconds(t.analysisMedian)}, p95 ${seconds(t.analysisP95)} | |
| Question time | median ${seconds(t.questionMedian)}, p95 ${seconds(t.questionP95)} | |

This is a small hand-labelled set. It compares versions of this system and shows
failure types, but it doesn't prove how the system performs on all real agreements.
`;
}

async function main() {
  const model = activeModel();
  const ranAt = new Date().toISOString();
  console.log(`Evaluating ${cases.length} cases with ${model.model} (${model.provider})`);

  const results: CaseResult[] = [];

  for (const [index, testCase] of cases.entries()) {
    const result = await runCase(testCase);
    results.push(result);

    const fieldScore = Object.values(result.fields ?? {})
      .map((field) => field.outcome)
      .join(",");
    const questionScore = result.questions
      .map((question) =>
        [question.score?.outcome ?? "error", question.refusedBy].filter(Boolean).join(":")
      )
      .join(",");
    console.log(
      `[${index + 1}/${cases.length}] ${testCase.id}: ${result.decision?.actual ?? result.analysisError} | ${fieldScore} | ${questionScore}`
    );
  }

  const summary = summarize(results);

  if (questionsOnly) {
    console.log(JSON.stringify(summary.rag, null, 2));
    return;
  }

  const directory = join(process.cwd(), "evals", "results");
  const name = model.model.replace(/[^a-z0-9.-]+/gi, "_");

  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${name}.json`),
    `${JSON.stringify({ ranAt, model, summary, results }, null, 2)}\n`
  );

  const markdown = toMarkdown(model, summary, ranAt);
  writeFileSync(join(directory, `${name}.md`), markdown);
  console.log(`\n${markdown}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
