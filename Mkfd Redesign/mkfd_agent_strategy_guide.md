# Mkfd Agent Context: Engineering Workbench Patterns

This document provides technical context for agents generating or modifying Mkfd screens to ensure continuity with the "Workbench v2" architecture.

## 1. The Workbench Mental Model
Mkfd is not a consumer app; it is a tool for developers and sysadmins. Screens should prioritize **information density** over whitespace. If a screen looks "too clean," it likely lacks the technical depth required for the project.

## 2. Shared Component Requirements

### AppShell
Every desktop screen MUST include the `AppShell` consisting of:
- **NavigationDrawer**: Sidebar with labels "Feeds", "Health", "Settings".
- **TopAppBar**: Breadcrumbs (e.g., `Builder > New Feed`) and global actions (Discard, Publish).

### Feed Builder Logic
- **Step-based Tabs**: Navigation must follow the sequence: `Basic`, `Source`, `Selectors`, `Output`.
- **The Split View**: The builder is a two-column experience. The right column is the **Raw Data Output Console**, a dark-mode terminal emulator that shows logs and JSON/XML previews.

## 3. Data Visualization Styles
- **Run Logs**: Use tabular data. Columns: Timestamp, Feed ID, Status, Latency, Action.
- **Telemetry**: Use bar charts or area charts with the Muted Iris functional colors (Olive for success, Red for failure).
- **Health Index**: Use sparklines (vertical bar style) to show recent run history.

## 4. State Management Visuals
- **Protected Values**: Masked inputs should be clearly identifiable as encrypted (e.g., `ENC:**********`).
- **Configuration**: Always provide a "Live Output" toggle to show that the workbench is actively connected to a worker process.

## 5. Identity Persistence
- **Feed IDs**: Stable identities (UUIDs or slugs) should be prominent in technical views.
- **Filenames**: Always reference `/public/feeds/{feedId}.xml` as the source of truth for output.
