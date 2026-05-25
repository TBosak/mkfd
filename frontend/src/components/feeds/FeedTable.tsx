import React from "react";
import type { FeedSummary } from "@/types/feed-summary";
import { FeedTypeBadge } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedActionsMenu } from "./FeedActionsMenu";

type ActionType = "open" | "copy" | "preview" | "edit" | "duplicate" | "export" | "enable" | "disable" | "delete";

interface FeedTableProps {
  feeds: FeedSummary[];
  onAction: (action: ActionType, feed: FeedSummary) => void;
  onUpdate: (id: string, changes: Partial<FeedSummary>) => void;
  onSelectFeed?: (id: string) => void;
}

const TH: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <th className="workbench-table th" style={style}>
    {children}
  </th>
);

const TD: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }> = ({ children, style, onClick }) => (
  <td style={{ cursor: onClick ? "pointer" : undefined, ...style }} onClick={onClick}>
    {children}
  </td>
);

export const FeedTable: React.FC<FeedTableProps> = ({ feeds, onAction, onUpdate, onSelectFeed }) => {
  return (
    <div className="workbench-panel" style={{ overflowX: "auto" }}>
      <table className="workbench-table">
        <thead>
          <tr>
            <TH style={{ width: 32 }}>{""}</TH>
            <TH>Name / Source</TH>
            <TH style={{ width: 80 }}>Type</TH>
            <TH style={{ width: 100 }}>Status</TH>
            <TH style={{ width: 150 }}>Tags</TH>
            <TH style={{ width: 100 }}>Last run</TH>
            <TH style={{ width: 70 }}>Items</TH>
            <TH style={{ width: 40 }}>{""}</TH>
          </tr>
        </thead>
        <tbody>
          {feeds.map((feed) => (
            <tr key={feed.id}>
              {/* Favorite */}
              <TD style={{ textAlign: "center" }}>
                <button
                  onClick={() => onUpdate(feed.id, { favorite: !feed.favorite })}
                  style={{ background: "transparent", border: 0, cursor: "pointer", padding: 0, fontSize: 14, color: feed.favorite ? "#f59e0b" : "hsl(var(--muted-foreground))" }}
                  aria-label={feed.favorite ? "Unstar" : "Star"}
                >
                  {feed.favorite ? "★" : "☆"}
                </button>
              </TD>

              {/* Name / Source */}
              <TD onClick={() => onSelectFeed?.(feed.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <FeedTypeBadge type={feed.type} size={24} />
                  <div>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>{feed.title}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontFamily: "var(--feeds-font-mono, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>
                      {feed.sourceUrl}
                    </div>
                  </div>
                </div>
              </TD>

              {/* Type label */}
              <TD>
                <FeedTypeBadge type={feed.type} size={20} showLabel />
              </TD>

              {/* Status */}
              <TD><FeedStatusBadge status={feed.status} /></TD>

              {/* Tags */}
              <TD>
                <div style={{ display: "flex", gap: 4, flexWrap: "nowrap", overflow: "hidden" }}>
                  {feed.tags.slice(0, 3).map((tag) => (
                    <span key={tag} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                      {tag}
                    </span>
                  ))}
                  {feed.tags.length > 3 && (
                    <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 20, background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                      +{feed.tags.length - 3}
                    </span>
                  )}
                </div>
              </TD>

              {/* Last run */}
              <TD>
                <span style={{ fontFamily: "var(--feeds-font-mono, monospace)", fontSize: 11 }}>
                  {feed.lastRunRelative ?? "—"}
                </span>
              </TD>

              {/* Items */}
              <TD>
                <span style={{ fontSize: 12 }}>
                  {feed.lastItemCount ?? "—"}
                  {feed.lastNewItemCount != null && feed.lastNewItemCount > 0 && (
                    <span style={{ marginLeft: 2, color: "#15803d", fontWeight: 700, fontSize: 11 }}>+{feed.lastNewItemCount}</span>
                  )}
                </span>
              </TD>

              {/* Actions */}
              <TD>
                <FeedActionsMenu feed={feed} onAction={onAction} />
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
      {feeds.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 0", color: "hsl(var(--muted-foreground))", fontSize: 14 }}>
          No feeds found.
        </div>
      )}
    </div>
  );
};
