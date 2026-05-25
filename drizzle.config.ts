import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/analytics/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.RUNTIME_DB_PATH ?? "./data/runtime.db",
  },
});
