import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
} from "recharts";
import type { HealthSummary } from "@/types/health";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="workbench-panel border-t-4 shadow-none" style={{ borderTopColor: "var(--wb-primary)" }}>
      <CardContent className="p-4">
        <p className="workbench-label">{label}</p>
        <p className="workbench-value mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

export function OverviewTab({
  summary,
}: {
  summary: HealthSummary | null;
}) {
  const [chartData, setChartData] = useState<
    { date: string; success: number; error: number; avgDuration: number | null }[]
  >([]);

  useEffect(() => {
    fetch("/api/health/runs?pageSize=200")
      .then((r) => r.json())
      .then(({ rows }) => {
        const byDay: Record<
          string,
          { date: string; success: number; error: number; durations: number[] }
        > = {};
        for (const row of rows) {
          const day = new Date(row.startedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          if (!byDay[day])
            byDay[day] = { date: day, success: 0, error: 0, durations: [] };
          if (row.status === "success") byDay[day].success++;
          else byDay[day].error++;
          if (row.durationMs !== null) byDay[day].durations.push(row.durationMs);
        }
        setChartData(
          Object.values(byDay).map((d) => ({
            date: d.date,
            success: d.success,
            error: d.error,
            avgDuration: d.durations.length
              ? Math.round(
                  d.durations.reduce((a, b) => a + b, 0) /
                    d.durations.length /
                    1000
                )
              : null,
          }))
        );
      });
  }, []);

  if (!summary) return <LoadingSpinner message="Loading overview…" />;

  const errFeeds = summary.feedHealth.filter(
    (f) => f.healthStatus === "red"
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Runs (24h)" value={String(summary.last24h)} />
        <StatCard
          label="Success Rate (7d)"
          value={`${Math.round(summary.successRate7d * 100)}%`}
        />
        <StatCard
          label="Avg Duration (7d)"
          value={`${Math.round(summary.avgDuration7d / 1000)}s`}
        />
        <StatCard label="Feeds w/ Errors" value={String(errFeeds)} />
      </div>

      <Card className="workbench-panel shadow-none">
        <CardHeader className="workbench-panel-header pb-2">
          <h3 className="font-semibold text-sm">
            Runs per Day — Success vs Error
          </h3>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="success" stackId="a" fill="#7a8a5f" name="Success" />
              <Bar
                dataKey="error"
                stackId="a"
                fill="#b25555"
                name="Error"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="workbench-panel shadow-none">
        <CardHeader className="workbench-panel-header pb-2">
          <h3 className="font-semibold text-sm">
            Avg Duration (seconds) per Day
          </h3>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="avgDuration"
                stroke="#a06a51"
                strokeWidth={2}
                dot={false}
                name="Avg Duration (s)"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
