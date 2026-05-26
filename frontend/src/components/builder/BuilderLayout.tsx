import React from "react";
import type { SectionDef } from "./SectionNav";

interface BuilderLayoutProps {
  sections: SectionDef[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  preview?: React.ReactNode;
  children: React.ReactNode;
}

export const BuilderLayout: React.FC<BuilderLayoutProps> = ({
  preview, children,
}) => {
  return (
    <div className="flex h-full overflow-hidden">
      <section
        className="min-w-0 overflow-y-auto border-r"
        style={{ width: "58%", padding: 24, background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}
      >
        {children}
      </section>
      {preview && (
        <aside
          className="min-w-[360px] shrink-0 overflow-hidden"
          style={{
            width: "42%",
            background: "var(--wb-console)",
          }}
        >
          {preview}
        </aside>
      )}
    </div>
  );
};
