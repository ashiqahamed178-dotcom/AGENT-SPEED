import { config } from "./config";

// One interface over every model. The rest of the app doesn't know whether it
// is talking to Ollama on this computer or to a cloud API.
export type ChatRequest = {
  system: string;
  user: string;
  // JSON Schema for the reply, sent to the provider to enforce while generating.
  // Providers differ in how strictly they do that, so callers must still
  // validate the reply.
  jsonSchema: Record<string, unknown>;
};

export class LlmUnavailableError extends Error {}

const { llm } = config;

export const activeModel = () => ({
  provider: llm.provider,
  model: llm.model,
  embeddingModel: llm.embeddingModel
});

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(llm.timeoutMs)
    });
  } catch (error) {
    console.error("LLM connection error:", error);
    throw new LlmUnavailableError(`Cannot reach the AI service (${llm.provider}).`);
  }

  if (!response.ok) {
    // Details stay in the server log, because they can contain account information.
    console.error(`LLM error ${response.status}:`, await response.text());
    throw new LlmUnavailableError(`The AI service (${llm.provider}) returned an error.`);
  }

  return (await response.json()) as unknown;
}

function cloudHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${llm.apiKey}` };
}

async function ollamaChat(request: ChatRequest): Promise<string | undefined> {
  const result = (await post(`${llm.baseUrl}/api/chat`, {
    model: llm.model,
    stream: false,
    format: request.jsonSchema,
    options: { temperature: 0 },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.user }
    ]
  })) as { message?: { content?: string } };

  return result.message?.content;
}

// Works with any OpenAI-compatible API, such as Gemini, Groq or OpenAI.
async function cloudChat(request: ChatRequest): Promise<string | undefined> {
  const result = (await post(
    `${llm.baseUrl}/chat/completions`,
    {
      model: llm.model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "response", schema: request.jsonSchema }
      },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user }
      ]
    },
    cloudHeaders()
  )) as { choices?: { message?: { content?: string } }[] };

  return result.choices?.[0]?.message?.content;
}

export function chatJson(request: ChatRequest): Promise<string | undefined> {
  return llm.provider === "ollama" ? ollamaChat(request) : cloudChat(request);
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (llm.provider === "ollama") {
    const result = (await post(`${llm.baseUrl}/api/embed`, {
      model: llm.embeddingModel,
      input: texts
    })) as { embeddings?: number[][] };

    if (result.embeddings?.length !== texts.length) {
      throw new LlmUnavailableError("The AI service returned incomplete embeddings.");
    }

    return result.embeddings;
  }

  const result = (await post(
    `${llm.baseUrl}/embeddings`,
    { model: llm.embeddingModel, input: texts, dimensions: llm.embeddingDimensions },
    cloudHeaders()
  )) as { data?: { index: number; embedding: number[] }[] };

  if (result.data?.length !== texts.length) {
    throw new LlmUnavailableError("The AI service returned incomplete embeddings.");
  }

  return [...result.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
}
