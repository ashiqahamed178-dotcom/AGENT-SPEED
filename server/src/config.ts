import { config as loadDotenv } from "dotenv";
import { randomBytes } from "node:crypto";
import { z } from "zod";

loadDotenv({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  // Neon/PostgreSQL connection string. Without it, development and tests use
  // PGlite, a real PostgreSQL engine embedded in the process.
  DATABASE_URL: z.string().min(1).optional(),
  JWT_SECRET: z.string().min(32).optional(),
  // "ollama" runs on this computer. "cloud" is any OpenAI-compatible API.
  LLM_PROVIDER: z.enum(["ollama", "cloud"]).default("ollama"),
  LLM_BASE_URL: z.string().url().optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
  EMBEDDING_MODEL: z.string().min(1).optional(),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000)
});

// An empty value in .env means "not set".
const env = EnvSchema.parse(
  Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value || undefined]))
);

if (env.LLM_PROVIDER === "cloud") {
  const missing = (["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "EMBEDDING_MODEL"] as const).filter(
    (name) => !env[name]
  );

  if (missing.length > 0) {
    throw new Error(`LLM_PROVIDER=cloud also requires: ${missing.join(", ")}`);
  }
}

const isProduction = env.NODE_ENV === "production";

if (isProduction && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required in production.");
}

if (isProduction && !env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production.");
}

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction,
  isTest: env.NODE_ENV === "test",
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  // Outside production a missing secret gets a random one, so nobody can rely
  // on a default secret. Sessions then end when the server restarts.
  jwtSecret: env.JWT_SECRET ?? randomBytes(48).toString("hex"),
  llm: {
    provider: env.LLM_PROVIDER,
    baseUrl: (env.LLM_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, ""),
    apiKey: env.LLM_API_KEY ?? "",
    model: env.LLM_MODEL ?? "llama3.2:3b",
    embeddingModel: env.EMBEDDING_MODEL ?? "nomic-embed-text",
    // Stored vectors have one fixed size, so every embedding model must match it.
    embeddingDimensions: 768,
    timeoutMs: env.LLM_TIMEOUT_MS
  }
};
