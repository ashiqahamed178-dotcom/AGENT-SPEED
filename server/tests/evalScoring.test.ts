import { describe, expect, it } from "vitest";
import { CASES } from "../evals/cases";
import { percentile, rate, scoreDecision, scoreField, scoreQuestion } from "../evals/scoring";
import { chunkAgreement } from "../src/rag/chunker";

describe("evaluation scoring", () => {
  it("scores stated fields", () => {
    expect(scoreField("Maria Lopez", "Maria Lopez (buyer)")).toBe("correct");
    expect(scoreField("1,200|1200", "1200 EUR")).toBe("correct");
    expect(scoreField("Maria Lopez", "John Smith")).toBe("wrong");
    expect(scoreField("Maria Lopez", "Not specified")).toBe("missed");
  });

  it("counts a value for an absent field as made up", () => {
    expect(scoreField(null, "Not specified")).toBe("correctly_missing");
    expect(scoreField(null, "The seller is not specified.")).toBe("correctly_missing");
    expect(scoreField(null, "Acme Corp")).toBe("made_up");
  });

  it("scores decisions, including forbidden ones", () => {
    const expected = {
      buyer: null,
      seller: null,
      amount: null,
      deadline: null,
      acceptableRecommendations: ["review" as const],
      forbiddenRecommendations: ["release" as const]
    };

    expect(scoreDecision(expected, "review")).toEqual({ acceptable: true, forbidden: false });
    expect(scoreDecision(expected, "release")).toEqual({ acceptable: false, forbidden: true });
  });

  it("scores answerable questions", () => {
    const question = {
      question: "q",
      clauseContains: "full refund",
      answerContains: ["refund"],
      answerable: true
    };

    expect(
      scoreQuestion(question, {
        answerable: true,
        answer: "You can get a refund.",
        retrievedClauseTexts: ["A full refund applies."]
      })
    ).toEqual({ retrievalHit: true, outcome: "correct" });

    expect(
      scoreQuestion(question, { answerable: true, answer: "No.", retrievedClauseTexts: ["Other."] })
    ).toEqual({ retrievalHit: false, outcome: "wrong_answer" });

    expect(
      scoreQuestion(question, { answerable: false, answer: "", retrievedClauseTexts: [] }).outcome
    ).toBe("false_refusal");
  });

  it("scores unanswerable questions", () => {
    const question = { question: "q", answerable: false };

    expect(
      scoreQuestion(question, { answerable: false, answer: "", retrievedClauseTexts: [] })
    ).toEqual({ retrievalHit: null, outcome: "correct_refusal" });

    expect(
      scoreQuestion(question, { answerable: true, answer: "Yes", retrievedClauseTexts: [] }).outcome
    ).toBe("made_up_answer");

    const planted = { question: "q", answerable: false, safeIfAvoids: ["has been verified"] };

    expect(
      scoreQuestion(planted, { answerable: true, answer: "No, it has not been verified.", retrievedClauseTexts: [] }).outcome
    ).toBe("correct_refusal");

    expect(
      scoreQuestion(planted, { answerable: true, answer: "The work has been verified.", retrievedClauseTexts: [] }).outcome
    ).toBe("made_up_answer");
  });

  it("handles empty data in rate and percentile", () => {
    expect(rate(1, 0)).toBeNull();
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});

describe("evaluation data", () => {
  it("has unique case ids", () => {
    const ids = CASES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only labels facts that are really in the agreement", () => {
    for (const item of CASES) {
      const text = item.agreementText.toLowerCase();

      for (const field of ["buyer", "seller", "amount", "deadline"] as const) {
        const expected = item.expected[field];
        if (expected === null) continue;

        const found = expected.split("|").some((form) => text.includes(form.toLowerCase()));
        expect(found, `${item.id}.${field}`).toBe(true);
      }

      for (const question of item.questions) {
        if (question.clauseContains) {
          expect(text.includes(question.clauseContains.toLowerCase()), `${item.id}: ${question.question}`).toBe(true);
        }
      }
    }
  });

  it("keeps each expected clause findable after chunking", () => {
    for (const item of CASES) {
      const clauses = chunkAgreement(item.agreementText);
      expect(clauses.length, item.id).toBeGreaterThan(0);

      for (const question of item.questions) {
        if (!question.clauseContains) continue;
        const needle = question.clauseContains.toLowerCase();
        expect(
          clauses.some((clause) => clause.text.toLowerCase().includes(needle)),
          `${item.id}: ${needle}`
        ).toBe(true);
      }
    }
  });
});
