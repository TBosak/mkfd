import type { FeedFormData } from "@/types/feed";

// Converts FeedFormData (react-hook-form state) to the typed shape the backend expects.
// The backend caster handles feedId assignment and encryption — we just reshape the data.
export function buildFeedConfigFromFormData(data: FeedFormData): Record<string, unknown> {
  // The backend caster already handles all field mapping from FeedFormData.
  // We just send the data as-is since the caster was written to accept FeedFormData shape.
  // This function exists as the explicit boundary — future transformations go here.
  return data as unknown as Record<string, unknown>;
}
