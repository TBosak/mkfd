import React from "react";

export interface SectionDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface SectionNavProps {
  sections: SectionDef[];
  active: string;
  onChange: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export const SectionNav: React.FC<SectionNavProps> = ({
  sections, active, onChange, collapsed, onToggleCollapsed,
}) => {
  return (
    <nav
      style={{
        width: collapsed ? 44 : 200,
        transition: "width 0.18s ease",
        flexShrink: 0,
        borderRight: "1px solid hsl(var(--border))",
        display: "flex",
        flexDirection: "column",
        background: "hsl(var(--card))",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-end", padding: "8px 8px 4px" }}>
        <button
          type="button"
          onClick={onToggleCollapsed}
          style={{ background: "transparent", border: "1px solid hsl(var(--border))", borderRadius: 5, padding: "2px 6px", cursor: "pointer", fontSize: 11, color: "hsl(var(--muted-foreground))" }}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, padding: "0 6px 10px" }}>
        {sections.map((section) => {
          const isActive = section.id === active;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: collapsed ? "8px" : "7px 10px",
                borderRadius: 7,
                background: isActive ? "hsl(var(--primary))" : "transparent",
                color: isActive ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                border: 0,
                cursor: "pointer",
                textAlign: "left",
                fontSize: 13,
                fontWeight: isActive ? 600 : 400,
                transition: "background 0.12s",
                justifyContent: collapsed ? "center" : "flex-start",
                borderLeft: isActive && !collapsed ? "3px solid hsl(var(--primary-foreground))" : "3px solid transparent",
              }}
              title={collapsed ? section.label : undefined}
            >
              {section.icon && <span style={{ flexShrink: 0 }}>{section.icon}</span>}
              {!collapsed && <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{section.label}</span>}
              {!collapsed && section.count !== undefined && (
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.7 }}>{section.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
