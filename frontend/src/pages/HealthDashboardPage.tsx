import { useState, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OverviewTab } from "./health/OverviewTab";
import { RunLogTab } from "./health/RunLogTab";
import { FeedHealthTab } from "./health/FeedHealthTab";
import { SettingsTab } from "./health/SettingsTab";
import { useHealthStream } from "@/hooks/useHealthStream";
import type { RunLog, HealthSummary } from "@/types/health";

export function HealthDashboardPage() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [newRows, setNewRows] = useState<RunLog[]>([]);
  const [feedIdFilter, setFeedIdFilter] = useState<string | undefined>();

  const fetchSummary = useCallback(() => {
    fetch("/api/health/summary")
      .then((r) => r.json())
      .then(setSummary);
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useHealthStream((row) => {
    setNewRows((prev) => [...prev.slice(-99), row]);
    fetchSummary();
  });

  const handleSelectFeed = (feedId: string) => {
    setFeedIdFilter(feedId);
    setActiveTab("runs");
  };

  return (
    <div className="space-y-4 animate-in">
      <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-red-600 bg-clip-text text-transparent">
        Feed Health
      </h2>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 w-full max-w-md">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Run Log</TabsTrigger>
          <TabsTrigger value="feeds">Feed Health</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab summary={summary} />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RunLogTab newRows={newRows} filterFeedId={feedIdFilter} />
        </TabsContent>
        <TabsContent value="feeds" className="mt-4">
          <FeedHealthTab
            feedHealth={summary?.feedHealth ?? []}
            onSelectFeed={handleSelectFeed}
          />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
