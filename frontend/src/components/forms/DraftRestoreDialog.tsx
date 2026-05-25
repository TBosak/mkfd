import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { FeedDraft } from "@/hooks/useFeedDraft";

const FEED_TYPE_LABELS: Record<string, string> = {
  webScraping: "Web Scraping", api: "REST API", rest: "REST API",
  email: "Email", calendar: "Calendar", sitemap: "Sitemap",
  filesystem: "Filesystem", webhook: "Webhook",
  feedTransformer: "Existing Feed", serviceConnector: "Service Connector",
};

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

type Props = { draft: FeedDraft | null; onRestore: () => void; onDiscard: () => void };

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
            You have an unsaved {typeLabel} draft from {timeLabel}. Would you like to restore it?
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
