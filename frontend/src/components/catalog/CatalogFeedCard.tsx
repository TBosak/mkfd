import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Lock, Rss } from "lucide-react";

export type CatalogFeedEntry = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  feedType: string;
  requiresSecrets: boolean;
  requiresPrivateNetwork: boolean;
  requiresTemplateValues?: boolean;
};

type Props = {
  entry: CatalogFeedEntry;
  onOpen: (entry: CatalogFeedEntry) => void;
};

export function CatalogFeedCard({ entry, onOpen }: Props) {
  return (
    <Card className="rounded-md shadow-none">
      <CardHeader className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{entry.title}</CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Rss className="h-3.5 w-3.5" />{entry.feedType}</span>
              <span>{entry.category}</span>
              {entry.requiresTemplateValues && <span className="inline-flex items-center gap-1"><KeyRound className="h-3.5 w-3.5" />Template</span>}
              {entry.requiresSecrets && <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" />Secrets</span>}
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpen(entry)}>Details</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        <p className="line-clamp-2 text-sm text-muted-foreground">{entry.description}</p>
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.slice(0, 5).map((tag) => (
            <span key={tag} className="rounded border px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
