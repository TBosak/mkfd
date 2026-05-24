# Auto-save Draft — Design Spec

**Date:** 2026-05-22
**Tier:** R2 Output & Operations
**Status:** Approved

---

## Goal

Preserve feed builder form state in `localStorage` so work is not lost on accidental navigation or page refresh. Applies to both create mode and edit mode. On return, a dialog prompts the user to restore or discard the draft.

---

## Scope

### In scope

- `frontend/src/hooks/useFeedDraft.ts` — custom hook: reads/writes draft to `localStorage`, debounced save, clear on discard or successful save
- `frontend/src/components/forms/DraftRestoreDialog.tsx` — dialog shown when a draft exists on mount; Restore / Discard actions
- `frontend/src/components/forms/FeedBuilderForm.tsx` — wires draft key, auto-save on form value change, clear on save, mounts dialog

### Out of scope

- Backend draft storage — localStorage only, no server changes
- Draft versioning or history — one draft per key, latest always wins
- Draft migration across feed type switches — switching feed type loads a different draft key (or none), old draft stays until explicitly discarded or that type's form is saved

---

## Draft Storage Shape

```ts
// frontend/src/hooks/useFeedDraft.ts
export type FeedDraft = {
  data:     FeedFormData;   // full react-hook-form state snapshot
  savedAt:  string;         // ISO timestamp — displayed in restore prompt
  feedType: string;         // used in prompt label
  mode:     "create" | "edit";
  feedId?:  string;         // present in edit mode only
};
```

### Storage key scheme

| Context | Key |
|---|---|
| Create — Web Scraping | `mkfd:draft:new:webScraping` |
| Create — REST API | `mkfd:draft:new:api` |
| Create — Email | `mkfd:draft:new:email` |
| Edit (any type) | `mkfd:draft:{feedId}` |

The draft key is recomputed when the active feed type tab changes in create mode. Switching tabs loads a different draft (or none) without clearing the previous tab's draft.

On read, if `JSON.parse` throws (corrupted entry), the key is removed silently and `draft` returns `null`.

---

## `useFeedDraft` Hook

```ts
// frontend/src/hooks/useFeedDraft.ts
import { useState, useEffect, useCallback, useMemo } from "react";
import type { FeedFormData } from "@/types/feed";

export type FeedDraft = {
  data:     FeedFormData;
  savedAt:  string;
  feedType: string;
  mode:     "create" | "edit";
  feedId?:  string;
};

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
            data,
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

`debounce` is implemented inline — no external dependency.

---

## `DraftRestoreDialog` Component

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

---

## FeedBuilderForm Integration

Four wiring points in `frontend/src/components/forms/FeedBuilderForm.tsx`:

### 1. Draft key

```ts
import { useFeedDraft } from "@/hooks/useFeedDraft";
import { DraftRestoreDialog } from "./DraftRestoreDialog";

// Inside the component, after useForm:
const activeFeedType = watch("feedType") ?? "webScraping";
const draftKey = mode === "edit" && feedId
  ? `mkfd:draft:${feedId}`
  : `mkfd:draft:new:${activeFeedType}`;
const { draft, saveDraft, clearDraft } = useFeedDraft(draftKey);
```

### 2. Auto-save on change

```ts
const formValues = watch();

useEffect(() => {
  saveDraft(formValues, activeFeedType, mode, feedId);
}, [formValues]);
```

### 3. Clear on successful save

In the `onSubmit` success branch, before `navigate` or `window.location.reload()`:

```ts
clearDraft();
```

### 4. Restore dialog

In the JSX, rendered at the top of the form:

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

---

## What This Spec Does Not Cover

- Backend draft storage — localStorage only
- Draft versioning — one draft per key, latest always wins
- Drafts for other forms (e.g. future service connector builder) — they can adopt `useFeedDraft` when built
- Draft compression or size limits — `FeedFormData` is small enough that raw JSON is fine
