import React, { useState } from "react";
import { Sparkles, RefreshCw, ChevronRight, CheckCircle, Circle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSourceAssistant } from "@/hooks/useSourceAssistant";
import type { SourceAssistantApplyResponse, SourceAssistantRecommendation } from "@/types/source-assistant";

const ANALYSIS_STEPS = [
  "Fetching source",
  "Checking for existing feeds",
  "Checking for sitemaps",
  "Checking for calendars",
  "Checking API/JSON shape",
  "Detecting forms",
  "Reading page-level JSON-LD",
  "Detecting repeated item links",
  "Sampling detail pages",
  "Reading detail-page JSON-LD",
  "Suggesting CSS selectors",
  "Building recommendations",
];

interface SourceAssistantPanelProps {
  onApply: (result: SourceAssistantApplyResponse) => void;
  onPickType: (type: string) => void;
}

const BAND_META = {
  high:   { label: "High confidence",   color: "var(--wb-success)" },
  medium: { label: "Medium confidence", color: "var(--wb-primary)" },
  low:    { label: "Low confidence",    color: "var(--wb-warning)" },
};

function routeCta(routeType: string) {
  if (routeType === "existingFeed") return "Use transformer";
  if (routeType === "webScraping") return "Configure scraping";
  if (routeType === "restApi") return "Configure API";
  return "Apply";
}

function ConfidenceMeter({ band, confidence }: { band: "high" | "medium" | "low"; confidence: number }) {
  const meta = BAND_META[band] ?? BAND_META.low;
  const percent = Math.round(confidence * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <div style={{ width: 80, height: 6, borderRadius: 4, background: "hsl(var(--muted))", overflow: "hidden" }}>
        <div style={{ width: `${percent}%`, height: "100%", background: meta.color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, whiteSpace: "nowrap" }}>
        {percent > 0 ? `${percent}%` : ""}
      </span>
      <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
        {meta.label}
      </span>
    </div>
  );
}

function RecommendationCard({
  rec,
  rank,
  isTop,
  onApply,
}: {
  rec: SourceAssistantRecommendation;
  rank: number;
  isTop: boolean;
  onApply: (rec: SourceAssistantRecommendation) => void;
}) {
  const [open, setOpen] = useState(isTop);
  const hasDetails = rec.reasons.length > 0 || rec.evidence.length > 0 || rec.warnings.length > 0;

  return (
    <div
      style={{
        border: `1px solid ${isTop ? "var(--wb-primary)" : "var(--wb-outline)"}`,
        borderRadius: 8,
        background: "var(--wb-card)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px" }}>
        <span
          style={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
            background: isTop ? "var(--wb-primary)" : "hsl(var(--muted))",
            color: isTop ? "#fff" : "hsl(var(--muted-foreground))",
            fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {rank}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{rec.title}</span>
            {rec.description && (
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>· {rec.description}</span>
            )}
          </div>
          <div style={{ marginTop: 6 }}>
            <ConfidenceMeter band={rec.confidenceBand} confidence={rec.confidence} />
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {hasDetails && open && (
        <div style={{ borderTop: "1px solid var(--wb-outline)", padding: "10px 14px", background: "hsl(var(--muted) / 0.3)" }}>
          {rec.reasons.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em" }}>Why</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                {rec.reasons.map((r, i) => <li key={i}>{r.message}</li>)}
              </ul>
            </div>
          )}
          {rec.evidence.length > 0 && (
            <div style={{ marginBottom: rec.warnings.length > 0 ? 8 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: "hsl(var(--muted-foreground))", textTransform: "uppercase", letterSpacing: "0.05em" }}>Evidence</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {rec.evidence.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, minWidth: 80, color: "hsl(var(--muted-foreground))" }}>{e.label}</span>
                    <span style={{ fontFamily: "var(--font-mono, monospace)", color: "hsl(var(--foreground))" }}>{String(e.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {rec.warnings.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: "var(--wb-warning)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Warnings</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
                {rec.warnings.map((w, i) => (
                  <li key={i} style={{ color: "var(--wb-warning)" }}>
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--wb-outline)" }}>
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            style={{ background: "transparent", border: 0, cursor: "pointer", fontSize: 12, color: "hsl(var(--muted-foreground))", display: "flex", alignItems: "center", gap: 4 }}
          >
            {open ? "Hide details" : "Show details"}
            <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.15s" }} />
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={() => onApply(rec)}
          style={{
            padding: "5px 14px", borderRadius: 6, border: isTop ? 0 : "1px solid var(--wb-outline)",
            background: isTop ? "var(--wb-primary)" : "transparent",
            color: isTop ? "#fff" : "hsl(var(--foreground))",
            fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
          }}
        >
          {routeCta(rec.routeType)}
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}

export const SourceAssistantPanel: React.FC<SourceAssistantPanelProps> = ({ onApply, onPickType: _onPickType }) => {
  const [url, setUrl] = useState("");
  const [needsHeaders, setNeedsHeaders] = useState(false);
  const [advancedFetch, setAdvancedFetch] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const assistant = useSourceAssistant();
  const { status, analysis: result, error } = assistant;

  async function handleAnalyze() {
    if (!url.trim()) return;
    setAnalysisStep(0);

    // Simulate step progression while waiting for the backend
    let step = 0;
    const stepInterval = setInterval(() => {
      step = Math.min(step + 1, ANALYSIS_STEPS.length - 2);
      setAnalysisStep(step);
    }, 400);

    try {
      await assistant.analyze(url.trim(), { needsHeaders, advancedFetch });
      clearInterval(stepInterval);
      setAnalysisStep(ANALYSIS_STEPS.length - 1);
    } catch (err: any) {
      clearInterval(stepInterval);
    }
  }

  function handleReanalyze() {
    assistant.reset();
  }

  async function handleApply(rec: SourceAssistantRecommendation) {
    try {
      onApply(await assistant.apply(rec.id));
    } catch (err: any) {
      alert(err?.message ?? "Could not apply recommendation");
    }
  }

  return (
    <div style={{ padding: "28px 24px 0", maxWidth: 980, margin: "0 auto" }}>
      {/* Panel header */}
      <div
        style={{
          border: "1px solid var(--wb-outline)",
          borderTop: "3px solid var(--wb-primary)",
          borderRadius: 8,
          background: "var(--wb-card)",
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Sparkles size={16} style={{ color: "var(--wb-primary)" }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>Source Assistant</span>
          </div>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "hsl(var(--muted-foreground))", lineHeight: 1.5 }}>
            Paste a URL — Mkfd will check for an existing feed, sitemap, calendar, API, JSON-LD, and scrapeable content, then recommend the best path.
          </p>

          {/* URL input row */}
          {status !== "analyzing" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <Input
                placeholder="https://example.com/news"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url.trim() && handleAnalyze()}
                style={{ flex: 1 }}
                disabled={status === "ready"}
              />
              {status === "ready" ? (
                <Button type="button" variant="outline" onClick={handleReanalyze} className="shrink-0">
                  <RefreshCw size={14} className="mr-2" />
                  Re-analyze
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!url.trim()}
                  className="shrink-0"
                  style={{ background: "var(--wb-primary)", color: "#fff", border: 0 }}
                >
                  <Sparkles size={14} className="mr-2" />
                  Analyze source
                </Button>
              )}
            </div>
          )}

          {/* Options */}
          {status === "idle" && (
            <div style={{ display: "flex", gap: 20, paddingBottom: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={needsHeaders} onChange={(e) => setNeedsHeaders(e.target.checked)} />
                This source needs custom headers or cookies
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                <input type="checkbox" checked={advancedFetch} onChange={(e) => setAdvancedFetch(e.target.checked)} />
                Try advanced browser rendering
              </label>
            </div>
          )}
        </div>

        {/* Analysis progress */}
        {status === "analyzing" && (
          <div style={{ borderTop: "1px solid var(--wb-outline)", padding: "14px 20px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Loader2 size={16} style={{ color: "var(--wb-primary)", animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Analyzing source…</span>
              <span style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320 }}>{url}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px" }}>
              {ANALYSIS_STEPS.map((step, i) => {
                const done = i < analysisStep;
                const running = i === analysisStep;
                return (
                  <div key={step} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: done ? "hsl(var(--foreground))" : running ? "var(--wb-primary)" : "hsl(var(--muted-foreground))" }}>
                    {done ? <CheckCircle size={11} style={{ color: "var(--wb-success)", flexShrink: 0 }} />
                      : running ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite", flexShrink: 0 }} />
                      : <Circle size={11} style={{ flexShrink: 0, opacity: 0.4 }} />}
                    {step}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error state */}
        {status === "error" && error && (
          <div style={{ borderTop: "1px solid var(--wb-outline)", padding: "12px 20px 14px", background: "hsl(var(--destructive) / 0.06)" }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--wb-error)" }}>{error}</p>
            <button
              type="button"
              onClick={handleReanalyze}
              style={{ marginTop: 8, fontSize: 12, color: "hsl(var(--foreground))", background: "transparent", border: "1px solid var(--wb-outline)", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        )}

        {/* Recommendations */}
        {status === "ready" && result && (
          <div style={{ borderTop: "1px solid var(--wb-outline)", padding: "14px 20px 16px", background: "hsl(var(--muted) / 0.25)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Recommended approaches</span>
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>Analyzed {url}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {result.recommendations.map((rec, i) => (
                <RecommendationCard
                  key={rec.id}
                  rec={rec}
                  rank={i + 1}
                  isTop={i === 0}
                  onApply={handleApply}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
