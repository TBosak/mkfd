import React, { useState } from "react";
import type { FeedSummary } from "@/types/feed-summary";
import { FeedTypeBadge } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedTagEditor } from "./FeedTagEditor";
import { FeedActionsMenu } from "./FeedActionsMenu";
import { Copy, ExternalLink } from "lucide-react";

type ActionType = "open" | "copy" | "preview" | "edit" | "duplicate" | "export" | "enable" | "disable" | "delete";
type FormatType = "rss" | "atom" | "json";

interface FeedCardProps {
  feed: FeedSummary;
  onAction: (action: ActionType, feed: FeedSummary) => void;
  onUpdate: (id: string, changes: Partial<FeedSummary>) => void;
}

export const FeedCard: React.FC<FeedCardProps> = ({ feed, onAction, onUpdate }) => {
  const [format, setFormat] = useState<FormatType>("rss");

  const feedUrl = format === "rss"
    ? `/public/feeds/${feed.id}.xml`
    : format === "atom"
      ? `/public/feeds/${feed.id}.atom`
      : `/public/feeds/${feed.id}.json`;

  const copyUrl = () => { navigator.clipboard.writeText(window.location.origin + feedUrl); };

  const metaGrid: { label: string; value: React.ReactNode }[] = [
    { label: "Status", value: <FeedStatusBadge status={feed.status} /> },
    {
      label: "Last run",
      value: <span style={{ fontFamily: "var(--feeds-font-mono, monospace)", fontSize: 11 }}>{feed.lastRunRelative ?? "—"}</span>
    },
    {
      label: "Refresh",
      value: <span style={{ fontSize: 12 }}>{feed.refreshMinutes != null ? `${feed.refreshMinutes} min` : "—"}</span>
    },
    {
      label: "Items",
      value: (
        <span style={{ fontSize: 12 }}>
          {feed.lastItemCount ?? "—"}
          {feed.lastNewItemCount != null && feed.lastNewItemCount > 0 && (
            <span style={{ marginLeft: 4, color: "#15803d", fontWeight: 600 }}>+{feed.lastNewItemCount}</span>
          )}
        </span>
      )
    },
  ];

  return (
    <div
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "var(--feeds-radius, 10px)",
        boxShadow: "var(--shadow-1)",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      {/* Head */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px 10px" }}>
        <FeedTypeBadge type={feed.type} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {feed.title}
            </span>
            {feed.origin.type === "community" && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "#ede4fc", color: "#4c1d95", fontWeight: 600 }}>
                Community
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{feed.filename}</div>
        </div>
        <button
          onClick={() => onUpdate(feed.id, { favorite: !feed.favorite })}
          style={{ background: "transparent", border: 0, cursor: "pointer", padding: 2, fontSize: 16, color: feed.favorite ? "#f59e0b" : "hsl(var(--muted-foreground))" }}
          aria-label={feed.favorite ? "Unstar" : "Star"}
        >
          {feed.favorite ? "★" : "☆"}
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: "0 14px", flex: 1 }}>
        {/* Source URL */}
        <div
          style={{
            fontFamily: "var(--feeds-font-mono, monospace)",
            fontSize: 11,
            color: "hsl(var(--muted-foreground))",
            background: "hsl(var(--muted))",
            borderRadius: 6,
            padding: "4px 8px",
            marginBottom: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {feed.sourceMethod && <span style={{ marginRight: 4, fontWeight: 700, color: "#1e40af" }}>{feed.sourceMethod}</span>}
          {feed.sourceUrl}
        </div>

        {/* Meta grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", marginBottom: 10 }}>
          {metaGrid.map(({ label, value }) => (
            <div key={label}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "hsl(var(--muted-foreground))", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
              <div>{value}</div>
            </div>
          ))}
        </div>

        {/* Tags */}
        <div style={{ marginBottom: 10 }}>
          <FeedTagEditor
            tags={feed.tags}
            onChange={(tags) => onUpdate(feed.id, { tags })}
          />
        </div>

        {/* Secrets */}
        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {feed.secrets.protected && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "#dde6fb", color: "#1e40af", fontWeight: 600 }}>
              🔒 Encrypted
            </span>
          )}
          {feed.secrets.env && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "#fdecc8", color: "#78350f", fontWeight: 600 }}>
              ENV
            </span>
          )}
          {feed.secrets.plain && (
            <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "#fadcd9", color: "#7f1d1d", fontWeight: 600 }}>
              ⚠ Plain secret
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderTop: "1px solid hsl(var(--border))",
          background: "hsl(var(--muted) / 0.4)",
        }}
      >
        {/* Format picker */}
        <div style={{ display: "flex", gap: 2 }}>
          {(["rss", "atom", "json"] as FormatType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              style={{
                padding: "2px 7px", borderRadius: 6, border: "1px solid",
                fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: format === f ? "hsl(var(--primary))" : "transparent",
                color: format === f ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                borderColor: format === f ? "hsl(var(--primary))" : "hsl(var(--border))",
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          onClick={copyUrl}
          aria-label="Copy feed URL"
          style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid hsl(var(--border))", fontSize: 11, cursor: "pointer", background: "transparent", color: "hsl(var(--foreground))", display: "flex", alignItems: "center" }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
        <a
          href={feedUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open feed"
          style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid hsl(var(--border))", fontSize: 11, cursor: "pointer", background: "transparent", color: "hsl(var(--foreground))", textDecoration: "none", display: "flex", alignItems: "center" }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <div style={{ flex: 1 }} />
        <FeedActionsMenu feed={feed} onAction={onAction} />
      </div>
    </div>
  );
};
