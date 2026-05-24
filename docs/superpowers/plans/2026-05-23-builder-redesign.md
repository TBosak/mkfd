# Builder UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **UI implementation:** For Tasks 1–10 (all React component work), use **superpowers:frontend-design** to validate visual designs before writing final component code.
>
> **Critical:** Before marking any task complete, verify against the **Functionality Preservation Checklist** in the spec. No existing form field may be removed.

**Goal:** Replace the flat tab-based `FeedBuilderForm` with a multi-phase, section-based builder: collapsible section navigator, always-visible preview panel, sticky save bar, and a feed type picker landing. All existing form fields are preserved.

**Architecture:** A new `BuildFeedPage` wraps the existing `FeedBuilderForm` (which stays as the react-hook-form hub). New layout primitives (`Section`, `SectionNav`, `BuilderLayout`) live in `components/builder/`. Each form sub-component (`WebScrapingForm`, `APIForm`, `EmailForm`) is refactored to accept `activeSection` and render only that section's fields.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui, react-hook-form, `feeds-tokens.css` (same token bridge as My Feeds)

**Depends on:**
- Auto-save Draft — `useFeedDraft` + `DraftRestoreDialog` wired into `BuildFeedPage`
- Protected Value Encryption — `StorageSelect` uses `{ type: "protected" }` shape
- Feed Config Formalization — Basic section exposes `FeedMetadata` fields
- App Shell / shared UI tokens — either `feeds-tokens.css` must be extracted before both My Feeds and Builder, or My Feeds must land first and provide the shared token bridge

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/components/builder/Section.tsx` | Collapsible card wrapper |
| Create | `frontend/src/components/builder/Field.tsx` | Field label + hint |
| Create | `frontend/src/components/builder/FieldRow.tsx` | 2/3-column grid row |
| Create | `frontend/src/components/builder/StorageSelect.tsx` | Plain/Encrypt/Env dropdown |
| Create | `frontend/src/components/builder/KVEditor.tsx` | Protected key-value editor |
| Create | `frontend/src/components/builder/SectionNav.tsx` | Collapsible left nav |
| Create | `frontend/src/components/builder/SectionHeader.tsx` | Section title bar |
| Create | `frontend/src/components/builder/SectionPager.tsx` | Prev/Next bar |
| Create | `frontend/src/components/builder/BuilderLayout.tsx` | 3-column layout shell |
| Create | `frontend/src/components/builder/TypePickerGrid.tsx` | Feed type picker landing |
| Create | `frontend/src/components/builder/PreviewPanel.tsx` | Right-column live preview |
| Create | `frontend/src/pages/BuildFeedPage.tsx` | Phase + section state, submit |
| Modify | `frontend/src/components/forms/WebScrapingForm.tsx` | Section-aware rendering |
| Modify | `frontend/src/components/forms/APIForm.tsx` | Section-aware rendering |
| Modify | `frontend/src/components/forms/EmailForm.tsx` | Section-aware rendering |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Remove phase/layout; keep form state/submit |
| Modify | `frontend/src/App.tsx` | Route `/` and `/feeds/:id/edit` to `BuildFeedPage` |

---

### Task 1: Shared primitives — `Section`, `Field`, `FieldRow`

**Files:**
- Create: `frontend/src/components/builder/Section.tsx`
- Create: `frontend/src/components/builder/Field.tsx`
- Create: `frontend/src/components/builder/FieldRow.tsx`

- [ ] **Step 1: Create `Section.tsx`**

```tsx
// frontend/src/components/builder/Section.tsx
import { useState } from "react";

type Props = {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
};

export function Section({ icon, title, sub, right, collapsible = false, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: "var(--feeds-radius-lg)", overflow: "hidden", marginBottom: 12 }}>
      <div
        style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "14px 16px", borderBottom: open || !collapsible ? "1px solid var(--line)" : undefined, cursor: collapsible ? "pointer" : undefined }}
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
      >
        {icon && (
          <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--bg-sunken)", border: "1px solid var(--line)", display: "grid", placeItems: "center", color: "var(--ink-3)", flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em" }}>{title}</h3>
          {sub && <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{sub}</div>}
        </div>
        {right && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
        {collapsible && (
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.16s" }}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        )}
      </div>
      {(!collapsible || open) && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `Field.tsx`**

```tsx
// frontend/src/components/builder/Field.tsx
type Props = {
  label?: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  span?: boolean;
  children: React.ReactNode;
};

export function Field({ label, hint, required, optional, span, children }: Props) {
  return (
    <div style={span ? { gridColumn: "1 / -1" } : undefined}>
      {label && (
        <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "var(--ink-2)", marginBottom: 5 }}>
          {label}
          {required && <span style={{ color: "var(--err)", marginLeft: 3 }}>*</span>}
          {optional && <span style={{ color: "var(--ink-4)", marginLeft: 6, fontWeight: 400 }}>Optional</span>}
        </label>
      )}
      {children}
      {hint && <div style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Create `FieldRow.tsx`**

```tsx
// frontend/src/components/builder/FieldRow.tsx
type Props = { cols?: 2 | 3; children: React.ReactNode };

export function FieldRow({ cols = 2, children }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols === 3 ? "1fr 1fr 1fr" : "1fr 1fr", gap: 12 }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/builder/Section.tsx frontend/src/components/builder/Field.tsx frontend/src/components/builder/FieldRow.tsx
git commit -m "feat: add builder Section, Field, FieldRow primitives"
```

---

### Task 2: `StorageSelect` + `KVEditor`

**Files:**
- Create: `frontend/src/components/builder/StorageSelect.tsx`
- Create: `frontend/src/components/builder/KVEditor.tsx`

- [ ] **Step 1: Create `StorageSelect.tsx`**

```tsx
// frontend/src/components/builder/StorageSelect.tsx
import { useCallback, useEffect, useRef, useState } from "react";

export type StorageMode = "plain" | "protected" | "env";

const OPTS: { id: StorageMode; label: string; short: string }[] = [
  { id: "plain",     label: "Plain text",   short: "Plain" },
  { id: "protected", label: "Encrypted",    short: "ENC"   },
  { id: "env",       label: "Env variable", short: "ENV"   },
];

type Props = { value: StorageMode; onChange: (v: StorageMode) => void; sensitive?: boolean };

export function StorageSelect({ value, onChange, sensitive }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const cur = OPTS.find((o) => o.id === value) ?? OPTS[0];
  const bg = value === "protected" ? "var(--info-soft)" : value === "env" ? "var(--warn-soft)" : sensitive ? "var(--err-soft)" : "var(--bg-sunken)";
  const color = value === "protected" ? "var(--info-ink)" : value === "env" ? "var(--warn-ink)" : sensitive ? "var(--err-ink)" : "var(--ink-3)";

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 7px", borderRadius: 5, border: "1px solid var(--line)", background: bg, color, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--feeds-font-mono)" }}
        title={value === "protected" ? "Encrypted in YAML" : value === "env" ? "Environment variable" : sensitive ? "Warning: looks sensitive" : "Plain text in YAML"}
      >
        {cur.short}
        <svg viewBox="0 0 24 24" width={10} height={10} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", minWidth: 170, background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 4, zIndex: 30 }}>
          {OPTS.map((o) => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 6, border: 0, background: value === o.id ? "var(--bg-sunken)" : "transparent", cursor: "pointer", fontSize: 12.5, color: "var(--ink-2)", fontWeight: value === o.id ? 600 : 400 }}
            >
              {o.label}
              {value === o.id && <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="var(--ok)" strokeWidth="2.5"><path d="M5 12l5 5L20 7" /></svg>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `KVEditor.tsx`**

```tsx
// frontend/src/components/builder/KVEditor.tsx
import { StorageSelect, type StorageMode } from "./StorageSelect";

export type KVRow = { key: string; value: string; storage: StorageMode };

const SENSITIVE_KEYS = /authorization|cookie|x-api-key|api[-_]?key|apikey|token|secret|password|bearer|session/i;
const looksSensitive = (k: string) => SENSITIVE_KEYS.test(k);

type Props = {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showStorage?: boolean;
  addLabel?: string;
};

export function KVEditor({ rows, onChange, keyPlaceholder = "Name", valuePlaceholder = "Value", showStorage = true, addLabel = "Add row" }: Props) {
  const set = (i: number, patch: Partial<KVRow>) =>
    onChange(rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, ix) => ix !== i));
  const add = () => onChange([...rows, { key: "", value: "", storage: "plain" }]);

  const colTemplate = showStorage ? "1fr 1fr 80px 28px" : "1fr 1fr 28px";

  const headStyle: React.CSSProperties = { fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: "var(--ink-4)", fontWeight: 600, padding: "6px 8px" };
  const cellStyle: React.CSSProperties = { padding: "4px 6px" };

  return (
    <div>
      <div style={{ background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: colTemplate, background: "var(--bg-sunken)", borderBottom: "1px solid var(--line)" }}>
          <div style={headStyle}>Name</div>
          <div style={headStyle}>Value</div>
          {showStorage && <div style={headStyle}>Storage</div>}
          <div />
        </div>
        {rows.length === 0 && (
          <div style={{ padding: "12px 14px", color: "var(--ink-4)", fontSize: 12.5, textAlign: "center" }}>None yet.</div>
        )}
        {rows.map((row, i) => {
          const sensitive = looksSensitive(row.key);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: colTemplate, borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : undefined, alignItems: "center" }}>
              <div style={cellStyle}>
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  placeholder={keyPlaceholder}
                  value={row.key}
                  onChange={(e) => set(i, { key: e.target.value })}
                />
              </div>
              <div style={cellStyle}>
                <input
                  className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm font-mono"
                  placeholder={row.storage === "env" ? "ENV_VAR_NAME" : valuePlaceholder}
                  value={row.value}
                  type={row.storage === "protected" ? "password" : "text"}
                  onChange={(e) => set(i, { value: e.target.value })}
                />
              </div>
              {showStorage && (
                <div style={{ ...cellStyle, display: "flex", justifyContent: "center" }}>
                  <StorageSelect value={row.storage} onChange={(s) => set(i, { storage: s })} sensitive={sensitive && row.storage === "plain"} />
                </div>
              )}
              <div style={{ ...cellStyle, display: "flex", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  style={{ width: 22, height: 22, display: "grid", placeItems: "center", background: "transparent", border: 0, cursor: "pointer", color: "var(--ink-4)", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--err)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--ink-4)")}
                >
                  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={add}
          style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 28, padding: "0 10px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--bg-elevated)", color: "var(--ink-2)", fontSize: 12, fontWeight: 500, cursor: "pointer" }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          {addLabel}
        </button>
        {rows.some((r) => looksSensitive(r.key) && r.storage === "plain") && (
          <span style={{ fontSize: 11.5, color: "var(--warn-ink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9l-8.2 14a2 2 0 001.7 3h16.4a2 2 0 001.7-3l-8.2-14a2 2 0 00-3.4 0z" /></svg>
            Some values look sensitive but are stored plain.
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/builder/StorageSelect.tsx frontend/src/components/builder/KVEditor.tsx
git commit -m "feat: add StorageSelect and KVEditor builder primitives"
```

---

### Task 3: Layout components — `SectionNav`, `SectionHeader`, `SectionPager`, `BuilderLayout`

**Files:**
- Create: `frontend/src/components/builder/SectionNav.tsx`
- Create: `frontend/src/components/builder/SectionHeader.tsx`
- Create: `frontend/src/components/builder/SectionPager.tsx`
- Create: `frontend/src/components/builder/BuilderLayout.tsx`

- [ ] **Step 1: Create `SectionNav.tsx`**

```tsx
// frontend/src/components/builder/SectionNav.tsx
export type BuilderSection = { id: string; label: string; icon: React.ReactNode; count?: number };

type Props = {
  sections: BuilderSection[];
  active: string;
  onChange: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

export function SectionNav({ sections, active, onChange, collapsed, onToggleCollapsed }: Props) {
  const w = collapsed ? 52 : 200;

  return (
    <nav style={{ width: w, flexShrink: 0, background: "var(--bg-elevated)", borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", transition: "width 0.18s ease", overflow: "hidden", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", padding: collapsed ? "10px 0" : "10px 12px", borderBottom: "1px solid var(--line)" }}>
        {!collapsed && <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-4)", fontWeight: 700 }}>Sections</span>}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand" : "Collapse"}
          style={{ width: 24, height: 24, display: "grid", placeItems: "center", background: "transparent", border: 0, cursor: "pointer", color: "var(--ink-3)", borderRadius: 4 }}
        >
          <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.18s" }}>
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            title={collapsed ? s.label : undefined}
            style={{
              display: "flex", alignItems: "center", gap: 9, width: "100%",
              padding: collapsed ? "8px 0" : "8px 12px",
              justifyContent: collapsed ? "center" : "flex-start",
              background: active === s.id ? "var(--bg-sunken)" : "transparent",
              color: active === s.id ? "var(--ink)" : "var(--ink-3)",
              border: 0, borderLeft: active === s.id ? "2px solid var(--brand)" : "2px solid transparent",
              cursor: "pointer", fontSize: 13, fontWeight: active === s.id ? 500 : 400,
              transition: "background 0.1s",
            }}
          >
            <span style={{ flexShrink: 0, display: "grid", placeItems: "center" }}>{s.icon}</span>
            {!collapsed && <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>}
            {!collapsed && typeof s.count === "number" && s.count > 0 && (
              <span style={{ fontSize: 10, fontWeight: 600, background: "var(--bg-sunken)", border: "1px solid var(--line)", color: "var(--ink-3)", borderRadius: 999, padding: "0 5px", height: 17, display: "inline-flex", alignItems: "center", fontFamily: "var(--feeds-font-mono)" }}>{s.count}</span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Create `SectionHeader.tsx`**

```tsx
// frontend/src/components/builder/SectionHeader.tsx
type Props = { title: string; sub?: string; ix?: number; total?: number };

export function SectionHeader({ title, sub, ix, total }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</h2>
        {sub && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 3 }}>{sub}</div>}
      </div>
      {typeof ix === "number" && typeof total === "number" && (
        <span style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--feeds-font-mono)", flexShrink: 0 }}>{ix + 1} / {total}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `SectionPager.tsx`**

```tsx
// frontend/src/components/builder/SectionPager.tsx
import type { BuilderSection } from "./SectionNav";

type Props = { sections: BuilderSection[]; active: string; onChange: (id: string) => void };

export function SectionPager({ sections, active, onChange }: Props) {
  const ix = sections.findIndex((s) => s.id === active);
  if (ix < 0) return null;
  const prev = sections[ix - 1];
  const next = sections[ix + 1];

  const btn = (label: string, onClick: () => void, primary?: boolean) => (
    <button
      onClick={onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 8, border: `1px solid ${primary ? "transparent" : "var(--line)"}`, background: primary ? "hsl(var(--primary))" : "var(--bg-elevated)", color: primary ? "hsl(var(--primary-foreground))" : "var(--ink)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
      {prev ? btn(`‹ ${prev.label}`, () => onChange(prev.id)) : <span />}
      <span style={{ flex: 1 }} />
      {next && btn(`${next.label} ›`, () => onChange(next.id), true)}
    </div>
  );
}
```

- [ ] **Step 4: Create `BuilderLayout.tsx`**

```tsx
// frontend/src/components/builder/BuilderLayout.tsx
import type { BuilderSection } from "./SectionNav";
import { SectionNav } from "./SectionNav";
import { SectionHeader } from "./SectionHeader";
import { SectionPager } from "./SectionPager";

type Props = {
  sections: BuilderSection[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  navCollapsed: boolean;
  onToggleNav: () => void;
  sectionSub?: string;
  preview: React.ReactNode;
  children: React.ReactNode;
};

export function BuilderLayout({ sections, activeSection, onSectionChange, navCollapsed, onToggleNav, sectionSub, preview, children }: Props) {
  const ix = sections.findIndex((s) => s.id === activeSection);
  const title = sections[ix]?.label ?? "";

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {sections.length > 1 && (
        <SectionNav sections={sections} active={activeSection} onChange={onSectionChange} collapsed={navCollapsed} onToggleCollapsed={onToggleNav} />
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px 80px", minWidth: 0 }}>
        {sections.length > 1 && (
          <SectionHeader title={title} sub={sectionSub} ix={ix} total={sections.length} />
        )}
        {children}
        {sections.length > 1 && (
          <SectionPager sections={sections} active={activeSection} onChange={onSectionChange} />
        )}
      </div>
      <aside style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 16 }}>
        {preview}
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/builder/SectionNav.tsx frontend/src/components/builder/SectionHeader.tsx frontend/src/components/builder/SectionPager.tsx frontend/src/components/builder/BuilderLayout.tsx
git commit -m "feat: add SectionNav, SectionHeader, SectionPager, BuilderLayout"
```

---

### Task 4: `TypePickerGrid` + `PreviewPanel`

**Files:**
- Create: `frontend/src/components/builder/TypePickerGrid.tsx`
- Create: `frontend/src/components/builder/PreviewPanel.tsx`

- [ ] **Step 1: Create `TypePickerGrid.tsx`**

```tsx
// frontend/src/components/builder/TypePickerGrid.tsx

type FeedTypeEntry = { id: string; label: string; desc: string; active: boolean };

const FEED_TYPES: FeedTypeEntry[] = [
  { id: "webScraping",      label: "Web Scraping",    desc: "Turn any webpage into a feed",      active: true  },
  { id: "api",              label: "REST API",        desc: "Map JSON endpoints to feed items",  active: true  },
  { id: "email",            label: "Email",           desc: "Watch an IMAP folder",              active: true  },
  { id: "graphql",          label: "GraphQL",         desc: "Query a GraphQL endpoint",          active: false },
  { id: "calendar",         label: "Calendar",        desc: "Subscribe to an ICS feed",          active: false },
  { id: "sitemap",          label: "Sitemap",         desc: "Track URLs from sitemap.xml",       active: false },
  { id: "filesystem",       label: "Filesystem",      desc: "Watch a local directory",           active: false },
  { id: "webhook",          label: "Webhook",         desc: "Receive events via inbound URL",    active: false },
  { id: "feedTransformer",  label: "Existing feed",   desc: "Clean & republish an RSS/Atom",     active: false },
  { id: "serviceConnector", label: "Connector",       desc: "Jellyfin, Sonarr, and more",        active: false },
];

type Props = { onPick: (type: string) => void };

export function TypePickerGrid({ onPick }: Props) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em" }}>What's the source?</h2>
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>Choose a feed type to get started.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {FEED_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={t.active ? () => onPick(t.id) : undefined}
            disabled={!t.active}
            style={{
              display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
              padding: "14px 16px", borderRadius: "var(--feeds-radius-lg)",
              border: "1px solid var(--line)",
              background: "var(--bg-elevated)",
              cursor: t.active ? "pointer" : "not-allowed",
              opacity: t.active ? 1 : 0.55,
              textAlign: "left",
              transition: "border-color 0.12s, box-shadow 0.12s",
            }}
            onMouseEnter={(e) => { if (t.active) { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--brand)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-2)"; } }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line)"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{t.label}</strong>
              {!t.active && (
                <span style={{ fontSize: 9.5, fontWeight: 600, background: "var(--bg-sunken)", color: "var(--ink-4)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 5px", letterSpacing: "0.04em" }}>SOON</span>
              )}
            </div>
            <span style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.35 }}>{t.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `PreviewPanel.tsx`**

```tsx
// frontend/src/components/builder/PreviewPanel.tsx
import { useState } from "react";

type Props = { feedName?: string; sourceUrl?: string };

export function PreviewPanel({ feedName, sourceUrl }: Props) {
  const [tab, setTab] = useState<"items" | "rss">("items");
  const title = feedName || "Untitled feed";
  const url = sourceUrl || "https://example.com";

  const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <link>${url}</link>
    <description>Generated by Mkfd</description>
    <item>
      <title>Sample item 1</title>
      <link>${url}/item-1</link>
    </item>
    <item>
      <title>Sample item 2</title>
      <link>${url}/item-2</link>
    </item>
  </channel>
</rss>`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-4)", fontWeight: 700 }}>Preview</span>
        <div style={{ display: "inline-flex", background: "var(--bg-sunken)", border: "1px solid var(--line)", borderRadius: 7, padding: 2, gap: 1 }}>
          {(["items", "rss"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{ height: 22, padding: "0 8px", fontSize: 11, fontWeight: 500, background: tab === t ? "var(--bg-elevated)" : "transparent", color: tab === t ? "var(--ink)" : "var(--ink-3)", border: 0, borderRadius: 5, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {t === "items" ? "Items" : "RSS"}
            </button>
          ))}
        </div>
      </div>

      {tab === "items" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {["Sample item 1", "Sample item 2"].map((t, i) => (
            <div key={i} style={{ padding: "10px 12px", background: "var(--bg-elevated)", border: "1px solid var(--line)", borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{t}</div>
              <div style={{ fontSize: 11, color: "var(--ink-4)", fontFamily: "var(--feeds-font-mono)", marginTop: 3 }}>{url}/item-{i + 1}</div>
            </div>
          ))}
          <div style={{ padding: "8px 12px", textAlign: "center", fontSize: 11.5, color: "var(--ink-4)" }}>
            Preview updates when you save and run the feed.
          </div>
        </div>
      ) : (
        <pre style={{ margin: 0, padding: "10px 12px", background: "var(--bg-sunken)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 11, color: "var(--ink-2)", fontFamily: "var(--feeds-font-mono)", overflowX: "auto", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {rssXml}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/builder/TypePickerGrid.tsx frontend/src/components/builder/PreviewPanel.tsx
git commit -m "feat: add TypePickerGrid and PreviewPanel builder components"
```

---

### Task 5: `BuildFeedPage` — top-level page

**Files:**
- Create: `frontend/src/pages/BuildFeedPage.tsx`

- [ ] **Step 1: Create `BuildFeedPage.tsx`**

```tsx
// frontend/src/pages/BuildFeedPage.tsx
import "@/styles/feeds-tokens.css";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TypePickerGrid } from "@/components/builder/TypePickerGrid";
import { BuilderLayout } from "@/components/builder/BuilderLayout";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { FeedBuilderForm } from "@/components/forms/FeedBuilderForm";
import type { FeedFormData } from "@/types/feed";
import type { BuilderSection } from "@/components/builder/SectionNav";

// Section definitions per feed type — icons are inline SVG nodes
const scrapeIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18"/></svg>;
const codeIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6M14 4l-4 16"/></svg>;
const settingsIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9l-8.2 14a2 2 0 001.7 3h16.4a2 2 0 001.7-3l-8.2-14a2 2 0 00-3.4 0z"/></svg>;
const mailIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
const tagIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor"/></svg>;
const lockIcon = <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>;

const SECTIONS_SCRAPE: BuilderSection[] = [
  { id: "basic",   label: "Basic",             icon: tagIcon    },
  { id: "source",  label: "Source",            icon: scrapeIcon },
  { id: "headers", label: "Headers & Cookies", icon: lockIcon   },
  { id: "extract", label: "Extraction",        icon: codeIcon   },
  { id: "output",  label: "Output",            icon: settingsIcon },
  { id: "advanced",label: "Advanced",          icon: settingsIcon },
];

const SECTIONS_API: BuilderSection[] = [
  { id: "basic",   label: "Basic",            icon: tagIcon     },
  { id: "endpoint",label: "Endpoint",         icon: codeIcon    },
  { id: "mapping", label: "Response Mapping", icon: scrapeIcon  },
  { id: "headers", label: "Headers",          icon: lockIcon    },
  { id: "output",  label: "Output",           icon: settingsIcon },
];

const SECTIONS_EMAIL: BuilderSection[] = [
  { id: "basic",      label: "Basic",      icon: tagIcon  },
  { id: "connection", label: "Connection", icon: mailIcon },
  { id: "filter",     label: "Filter",     icon: tagIcon  },
];

function sectionsFor(type: string): BuilderSection[] {
  if (type === "webScraping") return SECTIONS_SCRAPE;
  if (type === "api")         return SECTIONS_API;
  if (type === "email")       return SECTIONS_EMAIL;
  return [{ id: "basic", label: "Basic", icon: tagIcon }];
}

const SECTION_SUBS: Record<string, string> = {
  basic:      "Identity, refresh schedule, and tags.",
  source:     "Where Mkfd fetches from on every refresh.",
  headers:    "Authentication headers and cookies.",
  extract:    "How items are pulled out of the source.",
  output:     "Sort order, strictness, and outbound webhook.",
  advanced:   "Timeouts, retry, and user-agent settings.",
  endpoint:   "HTTP request configuration.",
  mapping:    "JSON path configuration for feed fields.",
  connection: "IMAP server and credentials.",
  filter:     "Folder selection and message count.",
};

interface Props {
  mode?: "create" | "edit";
  feedId?: string;
  initialData?: Partial<FeedFormData>;
}

export function BuildFeedPage({ mode = "create", feedId, initialData }: Props) {
  const navigate = useNavigate();
  const [activeType, setActiveType] = useState<string | null>(
    initialData?.feedType ?? null
  );
  const [activeSection, setActiveSection] = useState("basic");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [builderValues, setBuilderValues] = useState<Partial<FeedFormData>>({});

  const sections = activeType ? sectionsFor(activeType) : [];

  const handlePickType = (type: string) => {
    setActiveType(type);
    setActiveSection("basic");
  };

  const crumb = activeType
    ? `Configure ${activeType === "webScraping" ? "Web Scraping" : activeType === "api" ? "REST API" : activeType}`
    : "Choose a feed type";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      {/* Page header */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", borderBottom: "1px solid var(--line)", background: "var(--bg-elevated)", flexShrink: 0, zIndex: 10 }}>
        <button
          onClick={() => navigate("/feeds")}
          style={{ width: 30, height: 30, display: "grid", placeItems: "center", background: "transparent", border: "1px solid var(--line)", borderRadius: 7, cursor: "pointer", color: "var(--ink-3)" }}
        >
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{mode === "edit" ? `Edit feed` : "Build feed"}</h1>
          <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{crumb}</span>
        </div>
        {activeType && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "var(--ink-3)", fontFamily: "var(--feeds-font-mono)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)", display: "inline-block" }} />
              Draft saved
            </span>
            <button
              onClick={() => { setActiveType(null); setActiveSection("basic"); }}
              style={{ height: 30, padding: "0 12px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--bg-elevated)", color: "var(--ink)", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}
            >
              Discard
            </button>
          </div>
        )}
      </header>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex" }}>
        {!activeType ? (
          <div style={{ flex: 1, overflowY: "auto", padding: "48px 24px" }}>
            <TypePickerGrid onPick={handlePickType} />
          </div>
        ) : (
          <BuilderLayout
            sections={sections}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            navCollapsed={navCollapsed}
            onToggleNav={() => setNavCollapsed((c) => !c)}
            sectionSub={SECTION_SUBS[activeSection]}
            preview={<PreviewPanel feedName={builderValues?.feedName} sourceUrl={builderValues?.feedUrl} />}
          >
            <FeedBuilderForm
              mode={mode}
              feedId={feedId}
              initialData={initialData ?? (activeType ? { feedType: activeType as any } : undefined)}
              activeSection={activeSection}
              onValuesChange={setBuilderValues}
            />
          </BuilderLayout>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles** (will have errors until FeedBuilderForm is updated)

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: type errors about `activeSection` and `onValuesChange` props on `FeedBuilderForm` — that's expected; Task 9 fixes them.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/BuildFeedPage.tsx
git commit -m "feat: add BuildFeedPage with phase/section state"
```

---

### Task 6: Refactor `WebScrapingForm` — section-aware

**Files:**
- Modify: `frontend/src/components/forms/WebScrapingForm.tsx`

- [ ] **Step 1: Read current file**

```bash
cat frontend/src/components/forms/WebScrapingForm.tsx
```

- [ ] **Step 2: Add `activeSection` prop and wrap sections**

Add these imports at the top of the file:

```tsx
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { FieldRow } from "@/components/builder/FieldRow";
import { KVEditor, type KVRow } from "@/components/builder/KVEditor";
```

Add `activeSection?: string` to the component props interface.

Wrap the existing fields into Section components grouped by section id. The component should render only the section matching `activeSection` (or all if `activeSection` is undefined for backwards compatibility).

Structure:

```tsx
// Section: "basic" (rendered when activeSection === "basic" or undefined)
<Section title="Basic" icon={...}>
  <FieldRow>
    {/* feedName field — existing register("feedName") */}
    {/* category field — if present */}
  </FieldRow>
  <FieldRow>
    {/* refreshTime field — existing register("refreshTime") */}
    {/* tags field */}
  </FieldRow>
</Section>

// Section: "source" (rendered when activeSection === "source" or undefined)
<Section title="Source" icon={...}>
  <Field label="Feed URL" required>
    {/* existing feedUrl input — register("feedUrl") */}
  </Field>
  {/* FlareSolverrIndicator */}
</Section>

// Section: "headers" (rendered when activeSection === "headers" or undefined)
<Section title="Headers & Cookies" icon={...} collapsible defaultOpen={false}>
  <KVEditor
    rows={headers}
    onChange={setHeaders}
    keyPlaceholder="Header name"
    addLabel="Add header"
  />
</Section>

// Section: "extract" (rendered when activeSection === "extract" or undefined)
<Section title="Extraction" icon={...}>
  <Field label="Iterator selector" required>
    {/* existing itemSelector — register("itemSelector") */}
  </Field>
  <FieldRow>
    {/* titleSelector, authorSelector */}
  </FieldRow>
  <FieldRow>
    {/* dateSelector, descriptionSelector */}
  </FieldRow>
  {/* enclosureSelector + enclosureType */}
</Section>

// Section: "output" (rendered when activeSection === "output" or undefined)
<Section title="Output" icon={...}>
  {/* strict, reverse, titleStripHtml, authorStripHtml, summaryStripHtml toggles */}
  {/* webhook section: enabled toggle → url + newItemsOnly */}
</Section>

// Section: "advanced" (rendered when activeSection === "advanced" or undefined)
<Section title="Advanced" icon={...} collapsible defaultOpen={false}>
  {/* advanced toggle */}
</Section>
```

The `activeSection` filtering logic:

```tsx
const show = (id: string) => !activeSection || activeSection === id;
```

Wrap each section block: `{show("basic") && <Section title="Basic">...</Section>}`

- [ ] **Step 3: Add headers state** — `KVEditor` needs local state for headers rows. Add:

```tsx
const [headers, setHeaders] = useState<KVRow[]>([]);
```

The headers are converted to/from the `FeedFormData` format at submit time (handled in `FeedBuilderForm.tsx` via `getValues()`).

- [ ] **Step 4: Verify all original fields are present**

Check that every field from the original `WebScrapingForm` appears in one of the sections. Refer to the preservation checklist in the spec.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/forms/WebScrapingForm.tsx
git commit -m "feat: refactor WebScrapingForm into section-aware layout"
```

---

### Task 7: Refactor `APIForm` — section-aware

**Files:**
- Modify: `frontend/src/components/forms/APIForm.tsx`

- [ ] **Step 1: Read current file**

```bash
cat frontend/src/components/forms/APIForm.tsx
```

- [ ] **Step 2: Add `activeSection` prop and wrap sections**

Sections: `basic` / `endpoint` / `mapping` / `headers` / `output`

```tsx
// basic: feedName, refreshTime, tags, category
// endpoint: baseUrl, method, route
// mapping: jsonPath (items), titlePath, linkPath, datePath, descriptionPath, authorPath, enclosurePath
// headers: KVEditor for HTTP headers
// output: webhook fields
```

Add `activeSection?: string` prop and `show()` filtering identical to WebScrapingForm.

Add `headers` state for `KVEditor`. 

- [ ] **Step 3: Verify all original fields present**

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/forms/APIForm.tsx
git commit -m "feat: refactor APIForm into section-aware layout"
```

---

### Task 8: Refactor `EmailForm` — section-aware

**Files:**
- Modify: `frontend/src/components/forms/EmailForm.tsx`

- [ ] **Step 1: Read current file**

```bash
cat frontend/src/components/forms/EmailForm.tsx
```

- [ ] **Step 2: Add `activeSection` prop and wrap sections**

Sections: `basic` / `connection` / `filter`

```tsx
// basic: feedName, refreshTime, tags, category
// connection: imapHost, imapPort, imapUser, imapPassword (with StorageSelect defaulting to "protected"), imapFolder
// filter: emailCount
```

Import `StorageSelect` and wire the password field storage:

```tsx
import { StorageSelect, type StorageMode } from "@/components/builder/StorageSelect";
// ...
const [passwordStorage, setPasswordStorage] = useState<StorageMode>("protected");
```

The password input:

```tsx
<Field label="Password" required>
  <div style={{ display: "flex", gap: 6 }}>
    <input
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      type={passwordStorage === "protected" ? "password" : "text"}
      {...register("imapPassword")}
    />
    <StorageSelect value={passwordStorage} onChange={setPasswordStorage} sensitive />
  </div>
</Field>
```

- [ ] **Step 3: Verify all original fields present**

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/forms/EmailForm.tsx
git commit -m "feat: refactor EmailForm into section-aware layout"
```

---

### Task 9: Update `FeedBuilderForm` — accept new props, remove layout

**Files:**
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] **Step 1: Add new props to the interface**

```tsx
interface FeedBuilderFormProps {
  mode?: "create" | "edit";
  feedId?: string;
  initialData?: Partial<FeedFormData>;
  activeSection?: string;                          // NEW: section to show
  onValuesChange?: (v: Partial<FeedFormData>) => void; // NEW: live values for preview
}
```

- [ ] **Step 2: Pass `activeSection` down to sub-forms**

In the component body, replace the section rendering:

```tsx
{feedType === "webScraping" && (
  <WebScrapingForm
    register={register}
    watch={watch}
    setValue={setValue}
    control={control}
    errors={errors}
    activeSection={activeSection}
  />
)}
{feedType === "api" && (
  <APIForm
    register={register}
    watch={watch}
    setValue={setValue}
    control={control}
    errors={errors}
    activeSection={activeSection}
  />
)}
{feedType === "email" && (
  <EmailForm
    register={register}
    watch={watch}
    setValue={setValue}
    control={control}
    errors={errors}
    activeSection={activeSection}
  />
)}
```

- [ ] **Step 3: Wire `onValuesChange` via watch effect**

After the `useForm` call:

```tsx
const allValues = watch();
useEffect(() => {
  onValuesChange?.(allValues);
}, [allValues]);
```

- [ ] **Step 4: Remove old layout chrome**

Remove the outermost layout container, the old tab switcher, the inline type selector buttons, and the `<FeedPreview>` modal (preview is now in `PreviewPanel`). Keep only: `useForm`, submit handler, and the sub-form rendering.

The `FeedBuilderForm` should render a plain `<form onSubmit={...}>` with sub-forms inside and nothing else.

The save/submit button is in `BuildFeedPage`'s header and in a save-bar. Add a hidden submit button to the `<form>` for form submission via `requestSubmit()`, or keep an `id="feed-builder-form"` on the form so `BuildFeedPage` can trigger it externally. Simplest: keep the submit in `FeedBuilderForm` and expose `onSave: () => void` callback. `BuildFeedPage` wires a ref to trigger submit.

Alternatively, expose a ref-based imperative handle:

```tsx
import { forwardRef, useImperativeHandle } from "react";

export interface FeedBuilderFormHandle {
  submit: () => void;
}

export const FeedBuilderForm = forwardRef<FeedBuilderFormHandle, FeedBuilderFormProps>(
  function FeedBuilderForm({ mode, feedId, initialData, activeSection, onValuesChange }, ref) {
    // ...
    useImperativeHandle(ref, () => ({
      submit: () => handleSubmit(onSubmit)(),
    }));
    // ...
  }
);
```

In `BuildFeedPage`, wire the save button:

```tsx
const formRef = useRef<FeedBuilderFormHandle>(null);
// ...
<button onClick={() => formRef.current?.submit()}>Create feed</button>
// ...
<FeedBuilderForm ref={formRef} ... />
```

- [ ] **Step 5: Keep `DraftRestoreDialog` wired**

The draft auto-save effect and `DraftRestoreDialog` stay in `FeedBuilderForm` (added in the Auto-save Draft task). Ensure they still work after removing old layout chrome.

- [ ] **Step 6: Verify TypeScript compiles cleanly**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/forms/FeedBuilderForm.tsx
git commit -m "feat: update FeedBuilderForm to accept section + preview props"
```

---

### Task 10: `App.tsx` routing + smoke test

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update `App.tsx` imports and routes**

```tsx
// Remove: import { FeedBuilderForm } from "./components/forms/FeedBuilderForm";
// Remove: import { EditFeedPage } from "./pages/EditFeedPage";
// Add:
import { BuildFeedPage } from "./pages/BuildFeedPage";
```

In the Routes:

```tsx
// Remove: <Route path="/" element={<FeedBuilderForm />} />
// Remove: <Route path="/feeds/:id/edit" element={<EditFeedPage />} />
// Add:
<Route path="/" element={<BuildFeedPage mode="create" />} />
<Route path="/feeds/:id/edit" element={<EditFeedPageWrapper />} />
```

Add a small wrapper for edit mode (replace `EditFeedPage` or update it if it passes `feedId` down):

```tsx
function EditFeedPageWrapper() {
  const { id } = useParams<{ id: string }>();
  // fetch existing config here or delegate to BuildFeedPage
  return <BuildFeedPage mode="edit" feedId={id} />;
}
```

If `EditFeedPage` already handles data fetching and passes `initialData`, update it to render `BuildFeedPage` instead of `FeedBuilderForm` directly.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Start servers and smoke test**

```bash
bun run index.ts &
cd frontend && bun run dev
```

Open `http://localhost:5173/` and verify:

```text
[ ] Type picker page loads with 10 type cards
[ ] 3 active types (Web Scraping, REST API, Email); 7 show "SOON"
[ ] Clicking Web Scraping enters section navigator with 6 sections
[ ] SectionNav visible on left (collapsed/expand toggle works)
[ ] Clicking each section in nav shows correct fields
[ ] SectionPager prev/next navigates sections
[ ] PreviewPanel visible on right
[ ] All webScraping fields present across sections
[ ] All api fields present across sections
[ ] All email fields (including password with StorageSelect) present
[ ] Create mode: submit creates feed and navigates to /feeds
[ ] Edit mode at /feeds/some-id/edit: loads initial data, submit updates feed
[ ] Discard navigates back to /feeds
[ ] DraftRestoreDialog appears on return visit after typing
[ ] FlareSolverr indicator still present in Source section
[ ] Existing /feeds and /health routes unaffected
```

- [ ] **Step 4: Stop servers**

```bash
kill %2 %1
```

- [ ] **Step 5: Update PROGRESS.md**

```markdown
| Builder UI Redesign | ✅ | ✅ |
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx docs/superpowers/PROGRESS.md
git commit -m "feat: wire BuildFeedPage into App routing; mark Builder UI Redesign complete"
```
