import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { TypePickerGrid } from "@/components/builder/TypePickerGrid";
import { BuilderLayout } from "@/components/builder/BuilderLayout";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { SectionPager } from "@/components/builder/SectionPager";
import { FeedBuilderForm, type FeedBuilderFormHandle } from "@/components/forms/FeedBuilderForm";
import type { SectionDef } from "@/components/builder/SectionNav";
import type { FeedFormData } from "@/types/feed";

const SECTIONS_SCRAPE: SectionDef[] = [
  { id: "basic",    label: "Basic" },
  { id: "source",   label: "Source URL" },
  { id: "extract",  label: "Selectors" },
  { id: "output",   label: "Output" },
  { id: "advanced", label: "Advanced" },
];

const SECTIONS_API: SectionDef[] = [
  { id: "basic",    label: "Basic" },
  { id: "endpoint", label: "Endpoint" },
  { id: "mapping",  label: "Mapping" },
  { id: "headers",  label: "Headers" },
  { id: "output",   label: "Output" },
];

const SECTIONS_EMAIL: SectionDef[] = [
  { id: "basic",      label: "Basic" },
  { id: "connection", label: "Connection" },
  { id: "filter",     label: "Filter" },
];

function getSections(type: string): SectionDef[] {
  if (type === "api") return SECTIONS_API;
  if (type === "email") return SECTIONS_EMAIL;
  return SECTIONS_SCRAPE;
}

interface BuildFeedPageProps {
  mode?: "create" | "edit";
  feedId?: string;
  initialData?: Partial<FeedFormData>;
}

export const BuildFeedPage: React.FC<BuildFeedPageProps> = ({
  mode = "create",
  feedId,
  initialData,
}) => {
  const navigate = useNavigate();
  const formRef = useRef<FeedBuilderFormHandle>(null);

  const [activeType, setActiveType] = useState<string | null>(
    mode === "edit" && initialData?.feedType ? initialData.feedType : null
  );
  const [activeSection, setActiveSection] = useState<string>("basic");
  const [formValues, setFormValues] = useState<Partial<FeedFormData>>(initialData ?? {});

  const sections = activeType ? getSections(activeType) : [];

  const handleTypeSelect = (type: string) => {
    setActiveType(type);
    setActiveSection("basic");
  };

  const handleDiscard = () => {
    if (mode === "edit") {
      navigate("/feeds");
    } else {
      setActiveType(null);
      setActiveSection("basic");
    }
  };

  const feedName = (formValues.feedName as string | undefined) ?? "Untitled Feed";
  const sourceUrl = (formValues as any).feedUrl ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Page Header */}
      {activeType && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 16px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--background))",
            flexShrink: 0,
          }}
        >
          {mode === "create" && (
            <button
              type="button"
              onClick={handleDiscard}
              style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 20, color: "hsl(var(--muted-foreground))", padding: "0 4px" }}
              aria-label="Back"
            >
              ←
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              <span>Feeds</span>
              <span>›</span>
              <span style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>
                {mode === "edit" ? `Edit: ${feedId}` : `New ${activeType}`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDiscard}
            style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", fontSize: 12, cursor: "pointer", color: "hsl(var(--muted-foreground))" }}
          >
            {mode === "edit" ? "Cancel" : "Discard"}
          </button>
          <button
            type="button"
            onClick={() => formRef.current?.submit()}
            style={{ padding: "4px 16px", borderRadius: 6, border: 0, background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {mode === "edit" ? "Save" : "Publish"}
          </button>
        </div>
      )}

      {/* Content */}
      {!activeType ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <TypePickerGrid onSelect={handleTypeSelect} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <BuilderLayout
            sections={sections}
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            preview={<PreviewPanel feedName={feedName} sourceUrl={sourceUrl} />}
          >
            <FeedBuilderForm
              ref={formRef}
              mode={mode}
              feedId={feedId}
              initialData={initialData}
              activeSection={activeSection}
              onValuesChange={setFormValues}
            />
            {sections.length > 1 && (
              <SectionPager
                sections={sections}
                active={activeSection}
                onChange={setActiveSection}
              />
            )}
          </BuilderLayout>
        </div>
      )}
    </div>
  );
};
