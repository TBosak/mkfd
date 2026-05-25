import { useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "./health/OverviewTab";
import { RunLogTab } from "./health/RunLogTab";
import { FeedHealthTab } from "./health/FeedHealthTab";
import { useHealthStream } from "@/hooks/useHealthStream";
import type { RunLog, HealthSummary } from "@/types/health";
import { Download, RefreshCw } from "lucide-react";

export function HealthDashboardPage() {
  const location = useLocation();
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [activeTab, setActiveTab] = useState(() => new URLSearchParams(location.search).get("tab") ?? "overview");
  const [newRows, setNewRows] = useState<RunLog[]>([]);
  const [feedIdFilter, setFeedIdFilter] = useState<string | undefined>();

  const fetchSummary = useCallback(() => {
    fetch("/api/health/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => {
    const tab = new URLSearchParams(location.search).get("tab");
    if (tab) setActiveTab(tab);
  }, [location.search]);

  useHealthStream((row) => {
    setNewRows((prev) => [...prev.slice(-99), row]);
    fetchSummary();
  });

  const handleSelectFeed = (feedId: string) => {
    setFeedIdFilter(feedId);
    setActiveTab("runs");
  };

  return (
    <div className="flex h-full min-h-0 flex-col animate-in" style={{ background: "var(--wb-surface)" }}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-6" style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}>
        <h1 className="text-xl font-semibold">Health Dashboard</h1>
        <div className="flex items-center gap-3">
          <button type="button" className="flex h-8 items-center justify-center rounded border px-3 text-primary" style={{ borderColor: "var(--wb-primary)" }} onClick={fetchSummary} aria-label="Force re-sync" title="Force Re-sync">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-8 items-center justify-center rounded bg-primary px-3 text-primary-foreground"
            aria-label="Export logs"
            title="Export Logs"
            onClick={async () => {
              const r = await fetch("/api/health/runs?pageSize=10000");
              const { rows } = await r.json();
              const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "mkfd-run-log.json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </header>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b px-6 pt-3" style={{ background: "var(--wb-surface)", borderColor: "var(--wb-outline)" }}>
        <TabsList className="grid h-auto w-full max-w-xl grid-cols-3 bg-transparent p-0">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Run Log</TabsTrigger>
          <TabsTrigger value="feeds">Feed Health</TabsTrigger>
        </TabsList>
        </div>
        <div className="flex-1 overflow-auto p-6">
        <TabsContent value="overview" className="mt-0">
          <OverviewTab summary={summary} />
        </TabsContent>
        <TabsContent value="runs" className="mt-0">
          <RunLogTab newRows={newRows} filterFeedId={feedIdFilter} />
        </TabsContent>
        <TabsContent value="feeds" className="mt-0">
          <FeedHealthTab
            feedHealth={summary?.feedHealth ?? []}
            onSelectFeed={handleSelectFeed}
          />
        </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
