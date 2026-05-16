import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/analytics/schema.ts",
  out: "./drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DB_PATH ?? "./data/health.db",
  },
});
