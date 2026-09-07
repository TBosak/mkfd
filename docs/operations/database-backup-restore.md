# Runtime database: backup and restore

Mkfd keeps its runtime state in a single SQLite file — by default `./data/runtime.db`, overridable with `RUNTIME_DB_PATH`. It holds run logs, feed history snapshots and items, and application settings. Feed *configurations* live in `configs/` as YAML and are not in this database; back those up separately.

## Backup

Do not copy the file while the app is running. SQLite may have pages in its write-ahead log that a plain `cp` will miss, and the copy can be torn mid-write. Use the exported function, which takes a consistent snapshot under a read transaction:

```ts
import { backupRuntimeDatabase, restoreRuntimeDatabase } from "../../lib/analytics/db";

// Snapshot the live database to a standalone file.
backupRuntimeDatabase(sqlite, "./backups/runtime-2026-09-07.db");
```

The result is a self-contained SQLite file. It opens on its own with no journal or WAL sidecar, so it is safe to copy off the host, compress, or hand to another tool.

Take backups on whatever schedule matches how much history you are willing to lose. The database grows with run logs and feed history; retention settings bound that growth, so a backup is usually small.

## Restore

Stop the application first. Restoring underneath an open database handle is how a half-written file happens.

```ts
restoreRuntimeDatabase("./backups/runtime-2026-09-07.db", "./data/runtime.db");
```

Then start the application. On startup it applies any migrations the restored file has not seen, so a backup taken from an older release migrates forward automatically — you do not need to restore onto the exact version that produced it.

`restoreRuntimeDatabase` refuses to run if the backup file is missing, rather than leaving you with an empty database that looks like a successful restore.

## Verifying a restore

Check `GET /readyz`. It answers `200` with `{"ready":true}` when the database opened and migrated cleanly, and `503` with `{"ready":false,"reason":"..."}` when it did not. The endpoint is anonymous so an orchestrator can probe it, and the reason never contains a filesystem path.

A restored database that reports ready has been opened, migrated to the current schema, and is being read by the application.

## What happens if the database is unusable

The application no longer exits when the database cannot be opened or migrated. It starts, serves the UI, and reports not-ready through `/readyz` with the reason. This is deliberate: a process that dies on a bad database can only be diagnosed from container logs, whereas one that stays up can be asked what is wrong.

Feed serving and history will not work in that state. Fix the database — usually by restoring a backup — and restart.
