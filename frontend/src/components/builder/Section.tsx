import React, { useState } from "react";

interface SectionProps {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({
  icon, title, sub, right, defaultOpen = true, children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        border: "1px solid hsl(var(--border))",
        borderRadius: 10,
        marginBottom: 16,
        overflow: "hidden",
        background: "hsl(var(--card))",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          padding: "12px 14px",
          background: "transparent",
          border: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {icon && (
          <span style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{icon}</span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
          {sub && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{sub}</div>}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        >
          ▾
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: "1px solid hsl(var(--border))", paddingTop: 12 }}>
          {children}
        </div>
      )}
    </div>
  );
};
