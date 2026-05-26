import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";
import type { FeedHealth, ChartRun } from "@/types/health";

const HEALTH_DOT: Record<FeedHealth["healthStatus"], string> = {
  green: "bg-[var(--wb-success)]",
  yellow: "bg-[var(--wb-warning)]",
  red: "bg-[var(--wb-error)]",
};

function Sparkline({ feedId }: { feedId: string }) {
  const [data, setData] = useState<ChartRun[]>([]);
  useEffect(() => {
    fetch(`/api/health/chart/${feedId}`)
      .then((r) => r.json())
      .then(({ runs }) => setData(runs.slice(-14)));
  }, [feedId]);

  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={data}>
        <Line
          type="monotone"
          dataKey="itemCount"
          stroke="#52606a"
          strokeWidth={1.5}
          dot={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 10, padding: "2px 6px" }}
          formatter={(v) => [`${v} items`, ""]}
          labelFormatter={() => ""}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function FeedHealthTab({
  feedHealth,
  onSelectFeed,
}: {
  feedHealth: FeedHealth[];
  onSelectFeed: (feedId: string) => void;
}) {
  if (feedHealth.length === 0)
    return (
      <p className="text-muted-foreground text-sm py-4">
        No runs logged yet.
      </p>
    );

  return (
    <div className="space-y-3">
      {feedHealth.map((feed) => (
        <Card
          key={feed.feedId}
          className="workbench-panel cursor-pointer shadow-none transition-colors hover:bg-muted"
          onClick={() => onSelectFeed(feed.feedId)}
        >
          <CardHeader className="workbench-panel-header pb-1">
            <div className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${HEALTH_DOT[feed.healthStatus]}`}
              />
              <span className="font-semibold text-sm">{feed.feedName}</span>
              <span className="text-xs text-muted-foreground ml-1">
                {feed.feedType}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {feed.lastRunAt
                  ? new Date(feed.lastRunAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex gap-4 text-xs text-muted-foreground mb-2">
              <span>
                <span className="font-medium text-foreground">7d success: </span>
                {Math.round(feed.successRate7d * 100)}%
              </span>
              <span>
                <span className="font-medium text-foreground">Avg: </span>
                {Math.round(feed.avgDuration7d / 1000)}s
              </span>
              {feed.lastHttpStatus && (
                <span>
                  <span className="font-medium text-foreground">
                    Last HTTP:{" "}
                  </span>
                  <span
                    className={
                      feed.lastHttpStatus >= 400 ? "text-red-500" : ""
                    }
                  >
                    {feed.lastHttpStatus}
                  </span>
                </span>
              )}
            </div>
            <Sparkline feedId={feed.feedId} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
