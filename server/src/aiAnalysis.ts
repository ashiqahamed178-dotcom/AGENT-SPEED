import type { Response } from "express";
import { z } from "zod";
import { config } from "./config";

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

export async function runAnalysis(
  systemPrompt: string,
  userContent: string
): Promise<AnalysisResult> {
  let content: string | undefined;

  try {
    const response = await fetch(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.ollamaModel,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ]
      })
    });

    if (!response.ok) {
      console.error("Ollama error:", await response.text());
      return { ok: false, error: "Local AI model request failed. Check that Ollama is running." };
    }

    const result = (await response.json()) as { message?: { content?: string } };
    content = result.message?.content;
  } catch (error) {
    console.error("Ollama connection error:", error);
    return { ok: false, error: "Cannot connect to Ollama. Make sure the local Ollama service is running." };
  }

  if (!content) {
    return { ok: false, error: "The AI returned an empty response." };
  }

  let aiData: unknown;

  try {
    aiData = JSON.parse(content);
  } catch {
    return { ok: false, error: "The AI returned invalid JSON. Please retry." };
  }

  const validated = AnalysisSchema.safeParse(aiData);

  if (!validated.success) {
    console.error("Invalid AI response:", validated.error.flatten());
    return {
      ok: false,
      error: "The AI response did not match the expected format.",
      details: validated.error.flatten()
    };
  }

  return { ok: true, model: config.ollamaModel, analysis: validated.data };
}

export function sendAnalysisError(
  res: Response,
  result: Extract<AnalysisResult, { ok: false }>
) {
  return res.status(502).json({ error: result.error, details: result.details });
}
