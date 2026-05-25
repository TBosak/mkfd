import React, { useState } from "react";
import { SectionNav, type SectionDef } from "./SectionNav";

interface BuilderLayoutProps {
  sections: SectionDef[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  preview?: React.ReactNode;
  children: React.ReactNode;
}

const NAV_COLLAPSED_KEY = "mkfd:builder:nav-collapsed";

export const BuilderLayout: React.FC<BuilderLayoutProps> = ({
  sections, activeSection, onSectionChange, preview, children,
}) => {
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem(NAV_COLLAPSED_KEY) === "true"
  );

  const toggleNav = () => {
    const next = !navCollapsed;
    setNavCollapsed(next);
    localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
  };

  const showNav = sections.length > 1;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {showNav && (
        <SectionNav
          sections={sections}
          active={activeSection}
          onChange={onSectionChange}
          collapsed={navCollapsed}
          onToggleCollapsed={toggleNav}
        />
      )}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minWidth: 0 }}>
        {children}
      </div>
      {preview && (
        <aside
          style={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid hsl(var(--border))",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {preview}
        </aside>
      )}
    </div>
  );
};
