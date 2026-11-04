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
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("llama3.2:3b")
});

const env = EnvSchema.parse({
  ...process.env,
  // An empty value in .env means "not set".
  DATABASE_URL: process.env.DATABASE_URL || undefined,
  JWT_SECRET: process.env.JWT_SECRET || undefined
});

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
  ollamaUrl: env.OLLAMA_URL,
  ollamaModel: env.OLLAMA_MODEL
};
