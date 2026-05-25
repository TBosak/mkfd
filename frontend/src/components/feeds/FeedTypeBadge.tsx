import React from "react";
import type { FeedType } from "@/types/feed-summary";

type TypeMeta = {
  label: string;
  bg: string;
  color: string;
  border: string;
};

export const TYPE_META: Record<FeedType, TypeMeta> = {
  scrape:     { label: "Scrape",      bg: "#dde6fb", color: "#1e40af", border: "#bfdbfe" },
  rest:       { label: "REST API",    bg: "#dcf3e3", color: "#14532d", border: "#bbf7d0" },
  graphql:    { label: "GraphQL",     bg: "#ede4fc", color: "#4c1d95", border: "#ddd6fe" },
  email:      { label: "Email",       bg: "#fdecc8", color: "#78350f", border: "#fde68a" },
  calendar:   { label: "Calendar",    bg: "#fadcd9", color: "#7f1d1d", border: "#fca5a5" },
  sitemap:    { label: "Sitemap",     bg: "#e0f2fe", color: "#0c4a6e", border: "#bae6fd" },
  filesystem: { label: "Filesystem",  bg: "#f1f5f9", color: "#334155", border: "#cbd5e1" },
  webhook:    { label: "Webhook",     bg: "#fef9c3", color: "#713f12", border: "#fef08a" },
};

const TYPE_ICONS: Record<FeedType, React.ReactNode> = {
  scrape: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  rest: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  graphql: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
    </svg>
  ),
  email: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  calendar: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  sitemap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  ),
  filesystem: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  webhook: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
};

interface FeedTypeBadgeProps {
  type: FeedType;
  size?: number;
  showLabel?: boolean;
}

export const FeedTypeBadge: React.FC<FeedTypeBadgeProps> = ({ type, size = 32, showLabel = false }) => {
  const meta = TYPE_META[type] ?? TYPE_META.scrape;
  const icon = TYPE_ICONS[type] ?? TYPE_ICONS.scrape;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 8,
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      {showLabel && (
        <span style={{ fontSize: 12, fontWeight: 500, color: meta.color }}>{meta.label}</span>
      )}
    </div>
  );
};
