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
    emailUsername: _emailUsername,
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
        (data: FeedFormData, feedType: string, mode: "create" | "edit", feedId?: string) => {
          const entry: FeedDraft = {
            data: redactDraftData(data),
            savedAt: new Date().toISOString(),
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
