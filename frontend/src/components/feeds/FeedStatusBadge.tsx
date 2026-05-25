import React from "react";
import type { FeedStatus } from "@/types/feed-summary";

type StatusMeta = {
  label: string;
  bg: string;
  color: string;
  dotColor: string;
};

const STATUS_META: Record<FeedStatus, StatusMeta> = {
  healthy:  { label: "Healthy",   bg: "#dcf3e3", color: "#14532d", dotColor: "#15803d" },
  warning:  { label: "Warning",   bg: "#fdecc8", color: "#78350f", dotColor: "#b45309" },
  error:    { label: "Error",     bg: "#fadcd9", color: "#7f1d1d", dotColor: "#b91c1c" },
  disabled: { label: "Disabled",  bg: "#f1f5f9", color: "#64748b", dotColor: "#94a3b8" },
  neverRun: { label: "Never run", bg: "#f8fafc", color: "#64748b", dotColor: "#cbd5e1" },
  running:  { label: "Running",   bg: "#dde6fb", color: "#1e40af", dotColor: "#1d4ed8" },
};

interface FeedStatusBadgeProps {
  status: FeedStatus;
}

export const FeedStatusBadge: React.FC<FeedStatusBadgeProps> = ({ status }) => {
  const meta = STATUS_META[status] ?? STATUS_META.neverRun;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 20,
        background: meta.bg,
        color: meta.color,
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: meta.dotColor,
          flexShrink: 0,
        }}
      />
      {meta.label}
    </span>
  );
};
