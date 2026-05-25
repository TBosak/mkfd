import React from "react";
import type { FeedSummary } from "@/types/feed-summary";
import { FeedTypeBadge } from "./FeedTypeBadge";
import { FeedStatusBadge } from "./FeedStatusBadge";
import { FeedTagEditor } from "./FeedTagEditor";

type ActionType = "open" | "copy" | "preview" | "edit" | "duplicate" | "export" | "enable" | "disable" | "delete";

interface FeedDetailDrawerProps {
  feed: FeedSummary | null;
  onClose: () => void;
  onAction: (action: ActionType, feed: FeedSummary) => void;
  onUpdate: (id: string, changes: Partial<FeedSummary>) => void;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--muted-foreground))", marginBottom: 8 }}>
    {children}
  </div>
);

const UrlRow: React.FC<{ label: string; url: string }> = ({ label, url }) => (
  <div style={{ marginBottom: 6 }}>
    <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>{label}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontFamily: "var(--feeds-font-mono, monospace)", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "hsl(var(--foreground))" }}>
        {url}
      </span>
      <button
        onClick={() => navigator.clipboard.writeText(window.location.origin + url)}
        style={{ flexShrink: 0, padding: "2px 7px", borderRadius: 5, border: "1px solid hsl(var(--border))", fontSize: 10, cursor: "pointer", background: "transparent" }}
      >
        Copy
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ flexShrink: 0, padding: "2px 7px", borderRadius: 5, border: "1px solid hsl(var(--border))", fontSize: 10, cursor: "pointer", background: "transparent", textDecoration: "none", color: "inherit" }}
      >
        ↗
      </a>
    </div>
  </div>
);

export const FeedDetailDrawer: React.FC<FeedDetailDrawerProps> = ({ feed, onClose, onAction, onUpdate }) => {
  if (!feed) return null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 300 }}
      />
      {/* Drawer */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 480, maxWidth: "95vw",
          background: "hsl(var(--background))", borderLeft: "1px solid hsl(var(--border))",
          zIndex: 301, overflowY: "auto", display: "flex", flexDirection: "column",
          animation: "slideInRight 0.2s ease",
        }}
      >
        <style>{`@keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "16px 16px 12px", borderBottom: "1px solid hsl(var(--border))", position: "sticky", top: 0, background: "hsl(var(--background))", zIndex: 1 }}>
          <FeedTypeBadge type={feed.type} size={36} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {feed.title}
            </div>
            <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", fontFamily: "var(--feeds-font-mono, monospace)", marginTop: 2 }}>
              {feed.filename}
            </div>
            <div style={{ marginTop: 6 }}>
              <FeedStatusBadge status={feed.status} />
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ flexShrink: 0, background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 14, color: "hsl(var(--muted-foreground))" }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "16px" }}>
          {/* Endpoints */}
          <div style={{ marginBottom: 20 }}>
            <SectionTitle>Endpoints</SectionTitle>
            <div style={{ background: "hsl(var(--muted))", borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 4 }}>SOURCE</div>
              <div style={{ fontFamily: "var(--feeds-font-mono, monospace)", fontSize: 11, wordBreak: "break-all" }}>{feed.sourceUrl}</div>
            </div>
            <UrlRow label="RSS 2.0" url={`/public/feeds/${feed.id}.xml`} />
            <UrlRow label="Atom" url={`/public/feeds/${feed.id}.atom`} />
            <UrlRow label="JSON Feed" url={`/public/feeds/${feed.id}.json`} />
          </div>

          {/* Recent Activity */}
          <div style={{ marginBottom: 20 }}>
            <SectionTitle>Recent Activity</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>LAST RUN</div>
                <div style={{ fontSize: 12, fontFamily: "var(--feeds-font-mono, monospace)" }}>{feed.lastRunRelative ?? "Never"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>ITEMS</div>
                <div style={{ fontSize: 12 }}>
                  {feed.lastItemCount ?? "—"}
                  {feed.lastNewItemCount != null && feed.lastNewItemCount > 0 && (
                    <span style={{ marginLeft: 4, color: "#15803d", fontWeight: 700 }}>+{feed.lastNewItemCount}</span>
                  )}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>REFRESH</div>
                <div style={{ fontSize: 12 }}>{feed.refreshMinutes != null ? `${feed.refreshMinutes} min` : "—"}</div>
              </div>
              {feed.statusDetail && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", marginBottom: 2 }}>DETAIL</div>
                  <div style={{ fontSize: 11, color: "#b91c1c" }}>{feed.statusDetail}</div>
                </div>
              )}
            </div>
          </div>

          {/* Tags */}
          <div style={{ marginBottom: 20 }}>
            <SectionTitle>Tags</SectionTitle>
            <FeedTagEditor
              tags={feed.tags}
              onChange={(tags) => onUpdate(feed.id, { tags })}
            />
          </div>

          {/* Settings */}
          <div style={{ marginBottom: 20 }}>
            <SectionTitle>Settings</SectionTitle>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13 }}>Enabled</span>
              <button
                onClick={() => onAction(feed.enabled ? "disable" : "enable", feed)}
                style={{
                  width: 40, height: 22, borderRadius: 11, border: 0,
                  background: feed.enabled ? "#15803d" : "hsl(var(--muted))",
                  cursor: "pointer", position: "relative", transition: "background 0.2s",
                }}
                aria-label={feed.enabled ? "Disable feed" : "Enable feed"}
              >
                <span style={{
                  position: "absolute", top: 3, left: feed.enabled ? 20 : 3,
                  width: 16, height: 16, borderRadius: "50%", background: "#fff",
                  transition: "left 0.2s",
                }} />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid hsl(var(--border))", display: "flex", gap: 8, flexWrap: "wrap", position: "sticky", bottom: 0, background: "hsl(var(--background))" }}>
          <button
            onClick={() => onAction("preview", feed)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", fontSize: 13, cursor: "pointer" }}
          >
            Preview
          </button>
          <button
            onClick={() => onAction("duplicate", feed)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", fontSize: 13, cursor: "pointer" }}
          >
            Duplicate
          </button>
          <button
            onClick={() => onAction("delete", feed)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #fca5a5", background: "#fadcd9", color: "#b91c1c", fontSize: 13, cursor: "pointer" }}
          >
            Delete
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => onAction("edit", feed)}
            style={{ padding: "6px 14px", borderRadius: 6, border: 0, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            Edit
          </button>
        </div>
      </div>
    </>
  );
};
