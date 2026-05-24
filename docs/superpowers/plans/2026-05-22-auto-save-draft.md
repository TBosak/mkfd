# Auto-save Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve `FeedBuilderForm` state in `localStorage` so work is not lost on accidental navigation or page refresh. On return, a dialog prompts the user to restore or discard the saved draft.

**Architecture:** A new `useFeedDraft` hook handles read/write/clear to `localStorage` with a 500ms debounced save and an inline `debounce` utility (no new dependency). A new `DraftRestoreDialog` component shows on mount when a draft exists. `FeedBuilderForm` wires all three: draft key computation, auto-save effect, clear on submit, and dialog mount.

**Security decision:** Drafts are stored in browser `localStorage`, so they must be redacted before writing. Auto-save preserves non-sensitive builder progress only: feed type, display name, selectors, mapping fields, refresh interval, output metadata, and UI state. It must not persist passwords, Authorization/Cookie values, webhook secrets, protected-value plaintext, API bodies marked sensitive, or any resolved secret value. For protected/env editor rows, save key names and storage mode only; do not save plaintext values. Restoring a draft should never rehydrate a secret field from `localStorage`.

**Tech Stack:** React, TypeScript, react-hook-form, shadcn/ui Dialog, localStorage

**Depends on:** Protected Value Encryption and Feed Config Formalization must be implemented first enough for the frontend to know the canonical `ProtectedValue`/env row shapes and `FeedFormData` fields. This is still a pure frontend change, but its redaction allowlist must track the formalized config model.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/hooks/useFeedDraft.ts` | `FeedDraft` type, inline debounce, read/save/clear |
| Create | `frontend/src/components/forms/DraftRestoreDialog.tsx` | Restore / Discard dialog shown when draft exists |
| Modify | `frontend/src/components/forms/FeedBuilderForm.tsx` | Draft key, auto-save effect, clear on submit, mount dialog |

---

### Task 1: `useFeedDraft` hook

**Files:**
- Create: `frontend/src/hooks/useFeedDraft.ts`

- [ ] **Step 1: Create the hook**

```ts
// frontend/src/hooks/useFeedDraft.ts
import { useState, useEffect, useCallback, useMemo } from "react";
import type { FeedFormData } from "@/types/feed";

export type FeedDraft = {
  data:     Partial<FeedFormData>;
  savedAt:  string;
  feedType: string;
  mode:     "create" | "edit";
  feedId?:  string;
};

function redactDraftData(data: FeedFormData): Partial<FeedFormData> {
  const {
    emailPassword: _emailPassword,
    headers: _headers,
    cookies: _cookies,
    webhook: _webhook,
    apiBody: _apiBody,
    apiHeaders: _apiHeaders,
    apiParams: _apiParams,
    ...safeData
  } = data as FeedFormData & Record<string, unknown>;

  return safeData;
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}

export function useFeedDraft(draftKey: string) {
  const [draft, setDraft] = useState<FeedDraft | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      setDraft(raw ? (JSON.parse(raw) as FeedDraft) : null);
    } catch {
      localStorage.removeItem(draftKey);
      setDraft(null);
    }
  }, [draftKey]);

  const saveDraft = useMemo(
    () =>
      debounce(
        (
          data: FeedFormData,
          feedType: string,
          mode: "create" | "edit",
          feedId?: string,
        ) => {
          const entry: FeedDraft = {
            data: redactDraftData(data),
            savedAt:  new Date().toISOString(),
            feedType,
            mode,
            feedId,
          };
          localStorage.setItem(draftKey, JSON.stringify(entry));
        },
        500,
      ),
    [draftKey],
  );

  const clearDraft = useCallback(() => {
    localStorage.removeItem(draftKey);
    setDraft(null);
  }, [draftKey]);

  return { draft, saveDraft, clearDraft };
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly** (`bun run tsc --noEmit` in `frontend/`)

---

### Task 2: `DraftRestoreDialog` component

**Files:**
- Create: `frontend/src/components/forms/DraftRestoreDialog.tsx`

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/forms/DraftRestoreDialog.tsx
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FeedDraft } from "@/hooks/useFeedDraft";

const FEED_TYPE_LABELS: Record<string, string> = {
  webScraping:      "Web Scraping",
  api:              "REST API",
  rest:             "REST API",
  email:            "Email",
  calendar:         "Calendar",
  sitemap:          "Sitemap",
  filesystem:       "Filesystem",
  webhook:          "Webhook",
  feedTransformer:  "Existing Feed",
  serviceConnector: "Service Connector",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins  = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days  = Math.floor(diffMs / 86_400_000);
  if (mins  < 1)  return "just now";
  if (mins  < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type Props = {
  draft:     FeedDraft | null;
  onRestore: () => void;
  onDiscard: () => void;
};

export function DraftRestoreDialog({ draft, onRestore, onDiscard }: Props) {
  if (!draft) return null;
  const typeLabel = FEED_TYPE_LABELS[draft.feedType] ?? draft.feedType;
  const timeLabel = relativeTime(draft.savedAt);

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Unsaved draft found</DialogTitle>
          <DialogDescription>
            You have an unsaved {typeLabel} draft from {timeLabel}.
            Would you like to restore it?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onDiscard}>Discard</Button>
          <Button onClick={onRestore}>Restore draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

---

### Task 3: Wire into `FeedBuilderForm`

**Files:**
- Modify: `frontend/src/components/forms/FeedBuilderForm.tsx`

- [ ] **Step 1: Add imports** at the top of the file

```ts
import { useFeedDraft } from "@/hooks/useFeedDraft";
import { DraftRestoreDialog } from "./DraftRestoreDialog";
```

- [ ] **Step 2: Compute draft key** — inside the component, after the `useForm` call

```ts
const activeFeedType = watch("feedType") ?? "webScraping";
const draftKey = mode === "edit" && feedId
  ? `mkfd:draft:${feedId}`
  : `mkfd:draft:new:${activeFeedType}`;
const { draft, saveDraft, clearDraft } = useFeedDraft(draftKey);
```

- [ ] **Step 3: Auto-save effect** — after the draft key block

```ts
const formValues = watch();

useEffect(() => {
  saveDraft(formValues, activeFeedType, mode, feedId);
}, [formValues]);
```

- [ ] **Step 4: Clear draft on successful submit** — in the `onSubmit` success branch, before `navigate` / `window.location.reload()`

```ts
clearDraft();
```

- [ ] **Step 5: Mount restore dialog** — at the top of the returned JSX (before the `<form>` tag)

```tsx
<DraftRestoreDialog
  draft={draft}
  onRestore={() => {
    reset(draft!.data);
    clearDraft();
  }}
  onDiscard={clearDraft}
/>
```

- [ ] **Step 6: Verify TypeScript compiles cleanly**

---

### Task 4: Manual smoke test

- [ ] Open feed builder in create mode, fill several fields, navigate away — confirm no errors in console
- [ ] Return to feed builder — confirm `DraftRestoreDialog` appears with correct feed type and relative time
- [ ] Click **Restore draft** — confirm fields are repopulated
- [ ] Fill fields again, submit successfully — confirm dialog does not reappear on next visit
- [ ] Open edit mode for an existing feed, make changes, navigate away — confirm edit draft is keyed separately from create drafts
- [ ] Click **Discard** — confirm dialog dismisses and fields stay at default
