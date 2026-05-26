import { RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  title?: string;
  onReanalyze: () => void;
  busy?: boolean;
};

export function WebScrapingAnalysisBanner({ title, onReanalyze, busy }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            Source Assistant analysis applied{title ? `: ${title}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            This scraping setup was prefilled from the shared analysis result.
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onReanalyze} disabled={busy}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        Re-analyze Page
      </Button>
    </div>
  );
}
