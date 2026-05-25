import React from "react";

interface SectionPagerProps {
  sections: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}

export const SectionPager: React.FC<SectionPagerProps> = ({ sections, active, onChange }) => {
  const idx = sections.findIndex((s) => s.id === active);
  const prev = idx > 0 ? sections[idx - 1] : null;
  const next = idx < sections.length - 1 ? sections[idx + 1] : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0 0",
        marginTop: 12,
        borderTop: "1px solid hsl(var(--border))",
      }}
    >
      <div>
        {prev && (
          <button
            type="button"
            onClick={() => onChange(prev.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 7,
              border: "1px solid hsl(var(--border))", background: "transparent",
              cursor: "pointer", fontSize: 13, color: "hsl(var(--foreground))",
            }}
          >
            ← {prev.label}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
        {idx + 1} / {sections.length}
      </div>
      <div>
        {next && (
          <button
            type="button"
            onClick={() => onChange(next.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 7,
              border: "1px solid hsl(var(--border))", background: "transparent",
              cursor: "pointer", fontSize: 13, color: "hsl(var(--foreground))",
            }}
          >
            {next.label} →
          </button>
        )}
      </div>
    </div>
  );
};
