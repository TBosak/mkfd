import React, { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { TypePickerGrid } from "@/components/builder/TypePickerGrid";
import { BuilderLayout } from "@/components/builder/BuilderLayout";
import { PreviewPanel } from "@/components/builder/PreviewPanel";
import { FeedBuilderForm, type FeedBuilderFormHandle } from "@/components/forms/FeedBuilderForm";
import { SourceAssistantPanel, type SourceRecommendation } from "@/components/source-assistant/SourceAssistantPanel";
import type { SectionDef } from "@/components/builder/SectionNav";
import type { FeedFormData } from "@/types/feed";

const SECTIONS_SCRAPE: SectionDef[] = [
  { id: "basic",    label: "Basic" },
  { id: "headers",  label: "Headers & Cookies" },
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

const TYPE_LABELS: Record<string, string> = {
  webScraping: "Web Scraping",
  api: "REST API",
  email: "Email / IMAP",
  graphql: "GraphQL",
  sitemap: "Sitemap",
  calendar: "Calendar",
  filesystem: "Filesystem",
  webhook: "Webhook",
  feedTransformer: "Feed Transformer",
  serviceConnector: "Service Connector",
  sourceAssistant: "Source Assistant",
};

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--wb-surface)" }}>
      {/* Page Header */}
      {activeType && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            minHeight: 88,
            borderBottom: "1px solid var(--wb-outline)",
            background: "var(--wb-surface)",
            flexShrink: 0,
          }}
        >
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            height: 48,
            padding: "0 24px",
          }}>
          {mode === "create" && (
            <button
              type="button"
              onClick={handleDiscard}
              style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 20, color: "hsl(var(--muted-foreground))", padding: "0 4px" }}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              <span>Feeds</span>
              <ChevronRight size={13} />
              <span style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}>
                {mode === "edit" ? `Edit: ${feedId}` : `New ${TYPE_LABELS[activeType] ?? activeType}`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDiscard}
            style={{ height: 32, padding: "0 14px", borderRadius: 6, border: "1px solid var(--wb-outline)", background: "transparent", fontSize: 12, cursor: "pointer", color: "var(--wb-muted)" }}
          >
            {mode === "edit" ? "Cancel" : "Discard"}
          </button>
          <button
            type="button"
            onClick={() => formRef.current?.submit()}
            style={{ height: 32, padding: "0 16px", borderRadius: 6, border: 0, background: "var(--wb-primary)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
          >
            {mode === "edit" ? "Save" : "Publish"}
          </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))`, gap: 16, padding: "0 24px" }}>
            {sections.map((section, index) => {
              const active = section.id === activeSection;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    padding: "0 0 8px",
                    border: 0,
                    borderBottom: `2px solid ${active ? "var(--wb-primary)" : "transparent"}`,
                    background: "transparent",
                    color: active ? "var(--wb-primary)" : "var(--wb-muted)",
                    cursor: "pointer",
                  }}
                >
                  <span className="workbench-label" style={{ color: "inherit" }}>Step {String(index + 1).padStart(2, "0")}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Content */}
      {!activeType ? (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <SourceAssistantPanel
            onApply={(rec: SourceRecommendation) => {
              const typeMap: Record<string, string> = {
                scrape: "webScraping",
                webScraping: "webScraping",
                rest: "api",
                api: "api",
                calendar: "email",
                email: "email",
              };
              const mappedType = typeMap[rec.routeType] ?? rec.action?.replace("open-", "") ?? "webScraping";
              if (["webScraping", "api", "email"].includes(mappedType)) {
                handleTypeSelect(mappedType);
              }
            }}
            onPickType={handleTypeSelect}
          />
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
              selectedType={activeType as FeedFormData["feedType"]}
              activeSection={activeSection}
              onValuesChange={setFormValues}
            />
          </BuilderLayout>
        </div>
      )}
    </div>
  );
};
