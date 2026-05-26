import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CatalogFeedEntry } from "./CatalogFeedCard";

type Props = {
  open: boolean;
  entry: CatalogFeedEntry | null;
  detail: { yaml: string; template?: { variables: Record<string, any> } } | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: () => void;
};

export function CatalogFeedDetailDrawer({ open, entry, detail, loading, onOpenChange, onImport }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entry?.title ?? "Catalog Feed"}</DialogTitle>
          <DialogDescription>{entry?.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {entry?.tags.map((tag) => <span key={tag} className="rounded border px-2 py-0.5">{tag}</span>)}
          </div>
          <pre className="max-h-[48vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
            {loading ? "Loading..." : detail?.yaml ?? "No preview available."}
          </pre>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" onClick={onImport} disabled={!detail || loading}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
