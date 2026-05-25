import React from "react";

interface SectionHeaderProps {
  title: string;
  sub?: string;
  current?: number;
  total?: number;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, sub, current, total }) => {
  return (
    <div style={{ marginBottom: 20, paddingBottom: 14, borderBottom: "1px solid hsl(var(--border))" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          {sub && <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", margin: "4px 0 0" }}>{sub}</p>}
        </div>
        {current !== undefined && total !== undefined && (
          <span style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", fontWeight: 500, whiteSpace: "nowrap" }}>
            {current} / {total}
          </span>
        )}
      </div>
    </div>
  );
};
