import type { Response } from "express";
import { z } from "zod";
import { activeModel, chatJson, LlmUnavailableError } from "./llm";

export const AnalysisSchema = z.object({
  summary: z.string(),
  buyer: z.string(),
  seller: z.string(),
  amount: z.coerce.string(),
  currency: z.string(),
  deadline: z.string(),
  deliverables: z.array(z.string()),
  paymentConditions: z.array(z.string()),
  risks: z.array(z.string()),
  missingInformation: z.array(z.string()),
  recommendation: z.enum(["release", "refund", "dispute", "review"]),
  reasoning: z.string()
});

export type Analysis = z.infer<typeof AnalysisSchema>;

export type AnalysisResult =
  | { ok: true; model: string; analysis: Analysis }
  | { ok: false; error: string; details?: unknown };

const analysisJsonSchema = z.toJSONSchema(AnalysisSchema, { io: "input" }) as Record<string, unknown>;

// Models sometimes return a bad reply, so each analysis gets one more try. A
// reply that still fails validation is reported and never shown as a result.
const MAX_ATTEMPTS = 2;

export async function runAnalysis(
  systemPrompt: string,
  userContent: string
): Promise<AnalysisResult> {
  let failure: AnalysisResult = { ok: false, error: "The AI returned an empty response." };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let content: string | undefined;

    try {
      content = await chatJson({
        system: systemPrompt,
        user: userContent,
        jsonSchema: analysisJsonSchema
      });
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        return { ok: false, error: error.message };
      }
      throw error;
    }

    if (!content) {
      failure = { ok: false, error: "The AI returned an empty response." };
      continue;
    }

    let aiData: unknown;

    try {
      aiData = JSON.parse(content);
    } catch {
      failure = { ok: false, error: "The AI returned invalid JSON. Please retry." };
      continue;
    }

    const validated = AnalysisSchema.safeParse(aiData);

    if (validated.success) {
      return { ok: true, model: activeModel().model, analysis: validated.data };
    }

    console.error("Invalid AI response:", validated.error.flatten());
    failure = {
      ok: false,
      error: "The AI response did not match the expected format.",
      details: validated.error.flatten()
    };
  }

  return failure;
}

export function sendAnalysisError(
  res: Response,
  result: Extract<AnalysisResult, { ok: false }>
) {
  return res.status(502).json({ error: result.error, details: result.details });
}
