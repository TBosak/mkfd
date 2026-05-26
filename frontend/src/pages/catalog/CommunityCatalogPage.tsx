import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/components/ui/toast-provider";
import { CatalogFeedCard, type CatalogFeedEntry } from "@/components/catalog/CatalogFeedCard";
import { CatalogFeedDetailDrawer } from "@/components/catalog/CatalogFeedDetailDrawer";
import { CatalogImportDialog } from "@/components/catalog/CatalogImportDialog";

type Manifest = {
  feeds: CatalogFeedEntry[];
};

type Detail = {
  yaml: string;
  template?: { variables: Record<string, any> };
};

export function CommunityCatalogPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [feeds, setFeeds] = useState<CatalogFeedEntry[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CatalogFeedEntry | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  async function loadCatalog() {
    setLoading(true);
    try {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
      const manifest = await res.json() as Manifest;
      setFeeds(manifest.feeds ?? []);
    } catch (err) {
      toast.push({ tone: "err", title: "Catalog unavailable", body: err instanceof Error ? err.message : "Could not load catalog" });
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(entry: CatalogFeedEntry) {
    setSelected(entry);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/catalog/${entry.id}`);
      if (!res.ok) throw new Error(`Catalog detail failed (${res.status})`);
      setDetail(await res.json());
    } catch (err) {
      toast.push({ tone: "err", title: "Could not load recipe", body: err instanceof Error ? err.message : "Catalog detail failed" });
    } finally {
      setDetailLoading(false);
    }
  }

  async function importSelected(values?: Record<string, unknown>, secretStorage?: Record<string, "protected" | "env" | "plain">) {
    if (!selected) return;
    setImporting(true);
    try {
      const res = await fetch(`/api/catalog/${selected.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, secretStorage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? data.errors?.[0]?.message ?? `Import failed (${res.status})`);
      toast.push({ tone: "ok", title: "Feed imported", body: selected.title });
      setImportOpen(false);
      navigate(`/feeds/${data.feedId}/edit`);
    } catch (err) {
      toast.push({ tone: "err", title: "Import failed", body: err instanceof Error ? err.message : "Could not import feed" });
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => { loadCatalog(); }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return feeds;
    return feeds.filter((feed) =>
      [feed.title, feed.description, feed.category, feed.feedType, ...feed.tags].some((value) => value.toLowerCase().includes(q)),
    );
  }, [feeds, query]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="border-b px-4 py-4 sm:px-6" style={{ borderColor: "var(--wb-outline)", background: "var(--wb-surface-low)" }}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Community Catalog</h1>
            <p className="text-sm text-muted-foreground">Browse public feed recipes and import them into this instance.</p>
          </div>
          <Button type="button" variant="outline" onClick={loadCatalog} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="relative mt-4 max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Search recipes, categories, tags" />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        {loading ? (
          <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No catalog recipes match the current filter.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((entry) => <CatalogFeedCard key={entry.id} entry={entry} onOpen={openDetail} />)}
          </div>
        )}
      </main>

      <CatalogFeedDetailDrawer
        open={Boolean(selected) && !importOpen}
        entry={selected}
        detail={detail}
        loading={detailLoading}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onImport={() => setImportOpen(true)}
      />
      {selected && (
        <CatalogImportDialog
          open={importOpen}
          title={selected.title}
          template={detail?.template}
          importing={importing}
          onOpenChange={setImportOpen}
          onImport={importSelected}
        />
      )}
    </div>
  );
}
