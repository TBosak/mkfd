import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import "@/styles/feeds-tokens.css";
import type { FeedSummary, FeedStatus, FeedType } from "@/types/feed-summary";
import { FeedCard } from "@/components/feeds/FeedCard";
import { FeedTable } from "@/components/feeds/FeedTable";
import { FeedDetailDrawer } from "@/components/feeds/FeedDetailDrawer";
import { ScrollableFilterRow } from "@/components/feeds/ScrollableFilterRow";
import { useToast } from "@/components/ui/toast-provider";
import { Grid2X2, Plus, Search, Table2, X } from "lucide-react";

type ViewMode = "cards" | "table";
type ActionType = "open" | "copy" | "preview" | "edit" | "duplicate" | "export" | "enable" | "disable" | "delete";

type QuickFilter = "all" | "favorites" | "warnings" | "broken" | "disabled" | "secrets" | "community";

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites" },
  { id: "warnings", label: "Warnings" },
  { id: "broken", label: "Broken" },
  { id: "disabled", label: "Disabled" },
  { id: "secrets", label: "Secrets" },
  { id: "community", label: "Community" },
];

const TYPE_LABELS: Record<FeedType, string> = {
  scrape: "Scrape", rest: "REST API", graphql: "GraphQL",
  email: "Email", calendar: "Calendar", sitemap: "Sitemap",
  filesystem: "Filesystem", webhook: "Webhook",
};

export const MyFeedsPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();

  const [feeds, setFeeds] = useState<FeedSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [typeFilters, setTypeFilters] = useState<FeedType[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("table");
  const [detailId, setDetailId] = useState<string | null>(null);

  const loadFeeds = useCallback(async () => {
    try {
      const res = await fetch("/api/feeds");
      if (!res.ok) throw new Error("Failed to load feeds");
      const data = await res.json();
      setFeeds(data.feeds ?? []);
    } catch (e) {
      toast.push({ tone: "err", title: "Failed to load feeds", body: String(e) });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadFeeds(); }, [loadFeeds]);

  // All unique tags across feeds
  const allTags = Array.from(new Set(feeds.flatMap((f) => f.tags))).sort();
  // All feed types present
  const allTypes = Array.from(new Set(feeds.map((f) => f.type))) as FeedType[];

  const applyFilters = (f: FeedSummary): boolean => {
    if (search && !f.title.toLowerCase().includes(search.toLowerCase()) && !f.sourceUrl.toLowerCase().includes(search.toLowerCase())) return false;
    if (quickFilter === "favorites" && !f.favorite) return false;
    if (quickFilter === "warnings" && f.status !== "warning") return false;
    if (quickFilter === "broken" && f.status !== "error") return false;
    if (quickFilter === "disabled" && f.status !== "disabled") return false;
    if (quickFilter === "secrets" && !f.secrets.plain && !f.secrets.protected && !f.secrets.env) return false;
    if (quickFilter === "community" && f.origin.type !== "community") return false;
    if (typeFilters.length > 0 && !typeFilters.includes(f.type)) return false;
    if (tagFilters.length > 0 && !tagFilters.some((t) => f.tags.includes(t))) return false;
    return true;
  };

  const filtered = feeds.filter(applyFilters);
  const detailFeed = detailId ? feeds.find((f) => f.id === detailId) ?? null : null;
  const runningCount = feeds.filter((f) => f.enabled && f.status !== "error" && f.status !== "disabled").length;
  const warningCount = feeds.filter((f) => f.status === "warning").length;
  const failedCount = feeds.filter((f) => f.status === "error").length;

  const handleUpdate = async (id: string, changes: Partial<FeedSummary>) => {
    // Optimistic update
    setFeeds((prev) => prev.map((f) => f.id === id ? { ...f, ...changes } : f));

    // Persist
    try {
      if ("tags" in changes || "favorite" in changes || "category" in changes) {
        await fetch(`/api/feeds/${id}/metadata`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        });
      }
    } catch (e) {
      // Revert
      loadFeeds();
      toast.push({ tone: "err", title: "Failed to save changes" });
    }
  };

  const handleAction = async (action: ActionType, feed: FeedSummary) => {
    switch (action) {
      case "open":
        window.open(`/public/feeds/${feed.id}.xml`, "_blank");
        break;
      case "copy":
        navigator.clipboard.writeText(`${window.location.origin}/public/feeds/${feed.id}.xml`);
        toast.push({ tone: "ok", title: "Feed URL copied" });
        break;
      case "preview":
        window.open(`/public/feeds/${feed.id}.xml`, "_blank");
        break;
      case "edit":
        navigate(`/feeds/${feed.id}/edit`);
        break;
      case "duplicate": {
        try {
          const res = await fetch(`/api/feeds/${feed.id}/duplicate`, { method: "POST" });
          if (!res.ok) throw new Error("Duplicate failed");
          toast.push({ tone: "ok", title: "Feed duplicated" });
          await loadFeeds();
        } catch (e) {
          toast.push({ tone: "err", title: "Failed to duplicate feed" });
        }
        break;
      }
      case "export": {
        try {
          const res = await fetch(`/api/feeds/${feed.id}/export`);
          if (!res.ok) throw new Error("Export failed");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${feed.id}.yaml`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (e) {
          toast.push({ tone: "err", title: "Failed to export feed" });
        }
        break;
      }
      case "enable": {
        setFeeds((prev) => prev.map((f) => f.id === feed.id ? { ...f, enabled: true, status: "neverRun" as FeedStatus } : f));
        const enableRes = await fetch(`/api/feeds/${feed.id}/enabled`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        });
        if (!enableRes.ok) {
          setFeeds((prev) => prev.map((f) => f.id === feed.id ? { ...f, enabled: false } : f));
          toast.push({ tone: "err", title: "enable failed" });
          return;
        }
        toast.push({ tone: "ok", title: "Feed enabled", body: feed.title });
        break;
      }
      case "disable": {
        setFeeds((prev) => prev.map((f) => f.id === feed.id ? { ...f, enabled: false, status: "disabled" as FeedStatus } : f));
        const disableRes = await fetch(`/api/feeds/${feed.id}/enabled`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        });
        if (!disableRes.ok) {
          setFeeds((prev) => prev.map((f) => f.id === feed.id ? { ...f, enabled: true } : f));
          toast.push({ tone: "err", title: "disable failed" });
          return;
        }
        toast.push({ tone: "warn", title: "Feed disabled", body: feed.title });
        break;
      }
      case "delete": {
        // Optimistic remove with undo
        const prev = [...feeds];
        setFeeds((f) => f.filter((x) => x.id !== feed.id));
        if (detailId === feed.id) setDetailId(null);
        const toastId = toast.push({
          tone: "err",
          title: `"${feed.title}" deleted`,
          ms: 5000,
          action: {
            label: "Undo",
            onClick: async () => {
              setFeeds(prev);
              // No backend undo — just restore UI state
            },
          },
        });
        try {
          const res = await fetch(`/api/feeds/${feed.id}`, { method: "DELETE" });
          if (!res.ok) { toast.dismiss(toastId); setFeeds(prev); toast.push({ tone: "err", title: "Delete failed" }); return; }
        } catch {
          toast.dismiss(toastId);
          setFeeds(prev);
          toast.push({ tone: "err", title: "Failed to delete feed" });
        }
        break;
      }
    }
  };

  const toggleType = (type: FeedType) => {
    setTypeFilters((prev) => prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]);
  };

  const toggleTag = (tag: string) => {
    setTagFilters((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-6" style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search feeds..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-full rounded border bg-muted pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-8 items-center gap-2 rounded bg-primary px-4 text-xs font-semibold text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Create Feed
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-4">
          {[
            ["Total Feeds", feeds.length, "var(--wb-primary)"],
            ["Running", runningCount, "var(--wb-success)"],
            ["Warnings", warningCount, "var(--wb-warning)"],
            ["Failed", failedCount, "var(--wb-error)"],
          ].map(([label, value, color]) => (
            <div key={label} className="workbench-panel border-t-4 p-4" style={{ borderTopColor: color as string }}>
              <div className="workbench-label">{label}</div>
              <div className="workbench-value" style={{ color: color as string }}>{value}</div>
            </div>
          ))}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="m-0 text-xl font-semibold">Feeds</h1>
            <p className="m-0 text-xs text-muted-foreground">
              Showing {filtered.length} of {feeds.length} configured feeds
            </p>
          </div>
          <div style={{ display: "flex", gap: 2 }}>
            <button
              onClick={() => setView("cards")}
              className="grid h-8 w-8 place-items-center rounded-l border text-muted-foreground"
              style={{ background: view === "cards" ? "var(--wb-primary)" : "transparent", color: view === "cards" ? "#fff" : undefined, borderColor: "var(--wb-outline)" }}
              aria-label="Card view"
            >
              <Grid2X2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView("table")}
              className="grid h-8 w-8 place-items-center rounded-r border border-l-0 text-muted-foreground"
              style={{ background: view === "table" ? "var(--wb-primary)" : "transparent", color: view === "table" ? "#fff" : undefined, borderColor: "var(--wb-outline)" }}
              aria-label="Table view"
            >
              <Table2 className="h-4 w-4" />
            </button>
          </div>
        </div>

      {/* Quick filters */}
      <div style={{ marginBottom: 10 }}>
        <ScrollableFilterRow>
          {QUICK_FILTERS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setQuickFilter(id)}
              style={{
                padding: "4px 12px", borderRadius: 20, border: "1px solid",
                fontSize: 12, fontWeight: quickFilter === id ? 700 : 500, cursor: "pointer", whiteSpace: "nowrap",
                background: quickFilter === id ? "hsl(var(--primary))" : "transparent",
                color: quickFilter === id ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                borderColor: quickFilter === id ? "hsl(var(--primary))" : "hsl(var(--border))",
              }}
            >
              {label}
            </button>
          ))}
          {(typeFilters.length > 0 || tagFilters.length > 0 || quickFilter !== "all" || search) && (
            <button
              onClick={() => { setTypeFilters([]); setTagFilters([]); setQuickFilter("all"); setSearch(""); }}
              aria-label="Clear filters"
              style={{ padding: "4px 8px", borderRadius: 20, border: "1px solid hsl(var(--border))", background: "transparent", cursor: "pointer", color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center" }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </ScrollableFilterRow>
      </div>

      {/* Type filters */}
      {allTypes.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <ScrollableFilterRow label="Type">
            {allTypes.map((type) => (
              <button
                key={type}
                onClick={() => toggleType(type)}
                style={{
                  padding: "3px 10px", borderRadius: 20, border: "1px solid",
                  fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
                  background: typeFilters.includes(type) ? "hsl(var(--foreground))" : "transparent",
                  color: typeFilters.includes(type) ? "hsl(var(--background))" : "hsl(var(--muted-foreground))",
                  borderColor: typeFilters.includes(type) ? "hsl(var(--foreground))" : "hsl(var(--border))",
                }}
              >
                {TYPE_LABELS[type]}
              </button>
            ))}
          </ScrollableFilterRow>
        </div>
      )}

      {/* Tag filters */}
      {allTags.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ScrollableFilterRow label="Tags">
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                style={{
                  padding: "3px 10px", borderRadius: 20, border: "1px solid",
                  fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
                  background: tagFilters.includes(tag) ? "hsl(var(--foreground))" : "transparent",
                  color: tagFilters.includes(tag) ? "hsl(var(--background))" : "hsl(var(--muted-foreground))",
                  borderColor: tagFilters.includes(tag) ? "hsl(var(--foreground))" : "hsl(var(--border))",
                }}
              >
                {tag}
              </button>
            ))}
          </ScrollableFilterRow>
        </div>
      )}


      {/* Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "hsl(var(--muted-foreground))" }}>Loading feeds...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60 }}>
          <div
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              borderRadius: 8,
              border: "1px solid hsl(var(--border))",
              background: "hsl(var(--muted))",
              margin: "0 auto 12px",
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No feeds found</div>
          <div style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
            {feeds.length === 0 ? "Create your first feed to get started." : "Try adjusting your filters."}
          </div>
        </div>
      ) : view === "cards" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
          {filtered.map((feed) => (
            <FeedCard
              key={feed.id}
              feed={feed}
              onAction={handleAction}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      ) : (
        <FeedTable
          feeds={filtered}
          onAction={handleAction}
          onUpdate={handleUpdate}
          onSelectFeed={(id) => setDetailId(id)}
        />
      )}

      {/* Detail Drawer */}
      <FeedDetailDrawer
        feed={detailFeed}
        onClose={() => setDetailId(null)}
        onAction={handleAction}
        onUpdate={handleUpdate}
      />
      </div>
    </div>
  );
};
