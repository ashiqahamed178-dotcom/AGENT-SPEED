import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starting the embedded PostgreSQL engine can take several seconds on the
    // first test in a file.
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
});
