import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { RunLog } from "@/types/health";

const STATUS_BADGE: Record<string, string> = {
  success:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const WEBHOOK_BADGE: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  skipped: "bg-slate-100 text-slate-500",
};

function ItemDelta({
  cur,
  prev,
}: {
  cur: number | null;
  prev: number | null;
}) {
  if (cur === null || prev === null)
    return <span className="text-muted-foreground">—</span>;
  const delta = cur - prev;
  if (delta === 0) return <span>{cur}</span>;
  return (
    <span className={delta < 0 ? "text-red-500" : "text-green-600"}>
      {cur} ({delta > 0 ? "+" : ""}
      {delta})
    </span>
  );
}

const PAGE_SIZE = 50;

export function RunLogTab({
  newRows,
  filterFeedId,
}: {
  newRows: RunLog[];
  filterFeedId?: string;
}) {
  const [rows, setRows] = useState<RunLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [feedIdFilter] = useState(filterFeedId ?? "");

  const fetchRows = useCallback(
    async (p: number) => {
      setLoading(true);
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(PAGE_SIZE),
      });
      if (feedIdFilter) params.set("feedId", feedIdFilter);
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("feedType", filterType);
      const res = await fetch(`/api/health/runs?${params}`);
      const data = await res.json();
      setRows(data.rows);
      setTotal(data.total);
      setLoading(false);
    },
    [feedIdFilter, filterStatus, filterType]
  );

  useEffect(() => {
    fetchRows(1);
    setPage(1);
  }, [fetchRows]);

  useEffect(() => {
    if (newRows.length === 0) return;
    const latest = newRows[newRows.length - 1];
    const matchesFeed = !feedIdFilter || latest.feedId === feedIdFilter;
    const matchesStatus = !filterStatus || latest.status === filterStatus;
    const matchesType = !filterType || latest.feedType === filterType;
    if (matchesFeed && matchesStatus && matchesType) {
      setRows((prev) => [latest, ...prev]);
      setTotal((t) => t + 1);
    }
  }, [newRows, feedIdFilter, filterStatus, filterType]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-end">
        <select
          className="text-sm border rounded px-2 py-1.5 bg-background"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
        <select
          className="text-sm border rounded px-2 py-1.5 bg-background"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="webScraping">Web Scraping</option>
          <option value="api">API</option>
          <option value="email">Email</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {total} runs
        </span>
      </div>

      {loading ? (
        <LoadingSpinner message="Loading runs…" />
      ) : (
        <div className="overflow-x-auto rounded border border-border/50">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>
                {[
                  "Feed",
                  "Started",
                  "Duration",
                  "Status",
                  "HTTP",
                  "Items",
                  "Fallbacks",
                  "Dup GUIDs",
                  "Webhook",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border/30 hover:bg-muted/20 cursor-pointer"
                  onClick={() =>
                    setExpandedId(expandedId === row.id ? null : row.id)
                  }
                >
                  <td className="px-3 py-2 font-medium">
                    {row.feedName}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {row.feedType}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(row.startedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {row.durationMs !== null
                      ? `${(row.durationMs / 1000).toFixed(1)}s`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.timedOut ? (
                      <span className="text-amber-600">timeout</span>
                    ) : (
                      (row.httpStatus ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <ItemDelta cur={row.itemCount} prev={row.prevItemCount} />
                  </td>
                  <td className="px-3 py-2">
                    {row.dateFallbacks > 0 ? (
                      <span className="text-amber-600">{row.dateFallbacks}</span>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.duplicateGuids > 0 ? (
                      <span className="text-red-500">{row.duplicateGuids}</span>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {row.webhookStatus ? (
                      <span
                        className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${WEBHOOK_BADGE[row.webhookStatus] ?? ""}`}
                      >
                        {row.webhookStatus}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {expandedId === row.id ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </td>
                </tr>
              ))}
              {rows.map((row) =>
                expandedId === row.id ? (
                  <tr
                    key={`${row.id}-detail`}
                    className="bg-muted/10 border-t border-border/20"
                  >
                    <td colSpan={10} className="px-4 py-3 space-y-2 text-xs">
                      {row.errorMessage && (
                        <div>
                          <span className="font-medium text-red-600">
                            Error:{" "}
                          </span>
                          <span className="font-mono">{row.errorMessage}</span>
                        </div>
                      )}
                      {row.webhookError && (
                        <div>
                          <span className="font-medium text-amber-600">
                            Webhook error:{" "}
                          </span>
                          <span className="font-mono">{row.webhookError}</span>
                        </div>
                      )}
                      {row.selectorMatches &&
                        (() => {
                          try {
                            const matches = JSON.parse(row.selectorMatches);
                            return (
                              <div>
                                <span className="font-medium">
                                  Selector matches:{" "}
                                </span>
                                <span className="font-mono">
                                  {Object.entries(matches)
                                    .map(([k, v]) => `${k}: ${v}`)
                                    .join(" | ")}
                                </span>
                              </div>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      {!row.errorMessage &&
                        !row.webhookError &&
                        !row.selectorMatches && (
                          <span className="text-muted-foreground">
                            No additional details
                          </span>
                        )}
                    </td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex gap-2 justify-center pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage(page - 1);
              fetchRows(page - 1);
            }}
          >
            Previous
          </Button>
          <span className="text-xs self-center text-muted-foreground">
            Page {page} of {Math.ceil(total / PAGE_SIZE)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => {
              setPage(page + 1);
              fetchRows(page + 1);
            }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
