import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

interface SectionProps {
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  right?: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({
  icon, title, sub, right, collapsible = false, defaultOpen = true, children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  const header = (
    <>
      {icon && (
        <span style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{icon}</span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        {sub && <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{sub}</div>}
      </div>
      {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      {collapsible && (
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: "hsl(var(--muted-foreground))",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
      )}
    </>
  );

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
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 10, width: "100%",
            padding: "12px 14px", background: "transparent", border: 0,
            cursor: "pointer", textAlign: "left",
          }}
        >
          {header}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          {header}
        </div>
      )}
      {isOpen && (
        <div style={{ padding: "12px 14px 14px", borderTop: "1px solid hsl(var(--border))" }}>
          {children}
        </div>
      )}
    </div>
  );
};
