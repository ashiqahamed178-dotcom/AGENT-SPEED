import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string)
  };
}

const request = {
  system: "You are a test.",
  user: "Hello",
  jsonSchema: { type: "object" }
};

async function loadLlm(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const name of ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "EMBEDDING_MODEL"]) {
    vi.stubEnv(name, env[name] ?? "");
  }
  return import("../src/llm");
}

const cloudEnv = {
  LLM_PROVIDER: "cloud",
  LLM_BASE_URL: "https://llm.example.test/v1/",
  LLM_API_KEY: "test-key",
  LLM_MODEL: "cloud-chat",
  EMBEDDING_MODEL: "cloud-embed"
};

describe("LLM provider switch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses Ollama by default, enforcing the JSON schema", async () => {
    const { chatJson } = await loadLlm();
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: "{}" } }));

    expect(await chatJson(request)).toBe("{}");

    const sent = lastRequest();
    expect(sent.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(sent.body.model).toBe("llama3.2:3b");
    expect(sent.body.format).toEqual({ type: "object" });
    expect(sent.body.options.temperature).toBe(0);
    expect(sent.headers.Authorization).toBeUndefined();
  });

  it("uses the cloud API when configured", async () => {
    const { chatJson } = await loadLlm(cloudEnv);
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "{}" } }] }));

    expect(await chatJson(request)).toBe("{}");

    const sent = lastRequest();
    expect(sent.url).toBe("https://llm.example.test/v1/chat/completions");
    expect(sent.body.model).toBe("cloud-chat");
    expect(sent.headers.Authorization).toBe("Bearer test-key");
    expect(sent.body.response_format.json_schema.schema).toEqual({ type: "object" });
  });

  it("refuses to start the cloud provider with missing settings", async () => {
    await expect(loadLlm({ LLM_PROVIDER: "cloud" })).rejects.toThrow(/LLM_API_KEY/);
  });

  it("keeps provider error details out of the error message", async () => {
    const { chatJson, LlmUnavailableError } = await loadLlm(cloudEnv);
    fetchMock.mockResolvedValue(jsonResponse({ error: "account secret-details" }, false, 429));

    const error = await chatJson(request).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect((error as Error).message).not.toContain("secret-details");
  });

  it("reports a clear error when the model can't be reached", async () => {
    const { chatJson, LlmUnavailableError } = await loadLlm();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(chatJson(request)).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("creates embeddings with Ollama", async () => {
    const { embed } = await loadLlm();
    fetchMock.mockResolvedValue(jsonResponse({ embeddings: [[1, 2], [3, 4]] }));

    expect(await embed(["a", "b"])).toEqual([[1, 2], [3, 4]]);
    expect(lastRequest().body.model).toBe("nomic-embed-text");
  });

  it("creates cloud embeddings in the original order at the stored size", async () => {
    const { embed } = await loadLlm(cloudEnv);
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { index: 1, embedding: [3, 4] },
          { index: 0, embedding: [1, 2] }
        ]
      })
    );

    expect(await embed(["a", "b"])).toEqual([[1, 2], [3, 4]]);
    expect(lastRequest().body.dimensions).toBe(768);
  });

  it("rejects incomplete embeddings", async () => {
    const { embed, LlmUnavailableError } = await loadLlm();
    fetchMock.mockResolvedValue(jsonResponse({ embeddings: [[1, 2]] }));

    await expect(embed(["a", "b"])).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("does not call the model when there is nothing to embed", async () => {
    const { embed } = await loadLlm();

    expect(await embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
