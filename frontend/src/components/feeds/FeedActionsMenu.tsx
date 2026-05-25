import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { FeedSummary } from "@/types/feed-summary";

type ActionType = "open" | "copy" | "preview" | "edit" | "duplicate" | "export" | "enable" | "disable" | "delete";

interface FeedActionsMenuProps {
  feed: FeedSummary;
  onAction: (action: ActionType, feed: FeedSummary) => void;
}

export const FeedActionsMenu: React.FC<FeedActionsMenuProps> = ({ feed, onAction }) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current && !triggerRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function handleOpen() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpen((v) => !v);
  }

  const item = (label: string, action: ActionType, danger = false) => (
    <button
      key={action}
      onClick={() => { setOpen(false); onAction(action, feed); }}
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "6px 12px",
        background: "transparent", border: 0, cursor: "pointer", fontSize: 13,
        color: danger ? "#b91c1c" : "hsl(var(--foreground))",
        borderRadius: 6,
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = danger ? "#fadcd9" : "hsl(var(--muted))"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {label}
    </button>
  );

  const separator = <hr style={{ margin: "4px 0", border: 0, borderTop: "1px solid hsl(var(--border))" }} />;

  return (
    <>
      <button
        ref={triggerRef}
        onClick={handleOpen}
        aria-label="Feed actions"
        style={{
          background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 6,
          padding: "2px 6px", cursor: "pointer", color: "hsl(var(--muted-foreground))",
          fontSize: 16, lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {open && createPortal(
        <div
          style={{
            position: "fixed", top: pos.top, right: pos.right, zIndex: 9999,
            background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
            borderRadius: 10, boxShadow: "var(--shadow-pop, 0 8px 32px rgba(0,0,0,0.12))",
            minWidth: 180, padding: "6px 4px",
          }}
        >
          {item("Open RSS", "open")}
          {item("Copy feed URL", "copy")}
          {item("Preview", "preview")}
          {separator}
          {item("Edit config", "edit")}
          {item("Duplicate", "duplicate")}
          {item("Export YAML", "export")}
          {separator}
          {feed.enabled ? item("Disable feed", "disable") : item("Enable feed", "enable")}
          {separator}
          {item("Delete", "delete", true)}
        </div>,
        document.body
      )}
    </>
  );
};
