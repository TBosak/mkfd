import type { Database } from "bun:sqlite";
import type { ServiceConnectorFeedState } from "../models/service-connector.model";

export function ensureServiceConnectorStateTable(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS service_connector_state (
    feed_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

export function loadServiceConnectorState(db: Database, feedId: string): ServiceConnectorFeedState | null {
  ensureServiceConnectorStateTable(db);
  const row = db.query("SELECT state_json FROM service_connector_state WHERE feed_id = ?").get(feedId) as { state_json: string } | null;
  return row ? JSON.parse(row.state_json) : null;
}

export function saveServiceConnectorState(db: Database, feedId: string, state: ServiceConnectorFeedState): void {
  ensureServiceConnectorStateTable(db);
  db.query(`INSERT INTO service_connector_state (feed_id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
    .run(feedId, JSON.stringify(state), Date.now());
}
