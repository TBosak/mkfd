// Top-level Build Feed page — composes assistant + builders + preview.

const PHASES = {
  ASSISTANT: "assistant",
  ANALYZING: "analyzing",
  RECOMMEND: "recommend",
  BUILDER:   "builder",
};

const BuildFeedPage = ({ initial }) => {
  const toast = useToast();
  const editing = !!initial;

  // ---------- assistant state ----------
  const [phase, setPhase] = useState(editing ? PHASES.BUILDER : PHASES.ASSISTANT);
  const [url, setUrl] = useState("");
  const [advancedFetch, setAdvancedFetch] = useState(false);
  const [headersCookies, setHeadersCookies] = useState(false);
  const [manualHint, setManualHint] = useState(false);

  const [analyzeStep, setAnalyzeStep] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [appliedAnalysis, setAppliedAnalysis] = useState(null);

  // ---------- builder state ----------
  const [activeType, setActiveType] = useState(initial?.feedType || null);
  const [builderState, setBuilderState] = useState(null);
  const [draftSavedAt, setDraftSavedAt] = useState("just now");
  const [activeSection, setActiveSection] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Track sections of current builder
  const Builder = activeType ? window.BUILDERS[activeType] : null;
  const sections = Builder?.sections || [];
  useEffect(() => {
    if (sections.length === 0) {
      setActiveSection(null);
      return;
    }
    if (!activeSection || !sections.find((s) => s.id === activeSection)) {
      setActiveSection(sections[0].id);
    }
  }, [activeType]);

  // listen for builder state changes (each builder pushes to window.__builderState)
  useEffect(() => {
    const handler = () => setBuilderState({ ...window.__builderState });
    window.addEventListener("builder-state", handler);
    return () => window.removeEventListener("builder-state", handler);
  }, []);

  // ---------- analyze ----------
  const runAnalysis = (urlIn) => {
    setPhase(PHASES.ANALYZING);
    setAnalyzeStep(0);
    const total = ANALYSIS_STEPS.length;
    let i = 0;
    const tick = () => {
      i += 1;
      setAnalyzeStep(i);
      if (i < total) {
        setTimeout(tick, 150 + Math.random() * 220);
      } else {
        setTimeout(() => {
          setAnalysis(synthAnalysis(urlIn));
          setPhase(PHASES.RECOMMEND);
        }, 300);
      }
    };
    setTimeout(tick, 150);
  };

  const onAnalyze = () => {
    if (!url) return;
    runAnalysis(url);
  };

  const onReanalyze = () => {
    runAnalysis(url);
  };

  const onApply = (rec) => {
    if (rec.action === "open-picker" || rec.routeType === "manual") {
      setPhase(PHASES.ASSISTANT);
      return;
    }
    setActiveType(rec.routeType);
    // Build a starter applied analysis payload (mostly for the banner + pre-fills)
    setAppliedAnalysis({
      route: rec.routeType,
      modeLabel:
        rec.routeType === "scrape"
          ? "Drill Chain + JSON-LD"
          : rec.label,
      summary: rec.summaryDetail || rec.summary,
      request: { mode: "simple", url },
      extraction: { mode: "drillChainJsonLd" },
      drillChain: { selector: "article.card a" },
    });
    setPhase(PHASES.BUILDER);
    toast.push({
      tone: "ok",
      title: "Analysis applied",
      body: rec.label + " · " + (rec.summary || ""),
    });
  };

  const onPickType = (typeId) => {
    setActiveType(typeId);
    setAppliedAnalysis(null);
    setPhase(PHASES.BUILDER);
  };

  const onBack = () => {
    if (phase === PHASES.BUILDER || phase === PHASES.RECOMMEND) {
      setPhase(PHASES.ASSISTANT);
      setActiveType(null);
      setAppliedAnalysis(null);
    }
  };

  // fake draft autosave indicator
  useEffect(() => {
    if (phase !== PHASES.BUILDER) return;
    const id = setInterval(() => setDraftSavedAt("just now"), 12000);
    return () => clearInterval(id);
  }, [phase]);

  const onSave = () => {
    toast.push({
      tone: "ok",
      title: editing ? "Feed saved" : "Feed created",
      body: (builderState?.feedName || "Untitled") + " · " + (builderState?.feedType || activeType),
      action: { label: "Open in My Feeds", onClick: () => (window.location.href = "index.html") },
    });
  };

  // ---------- render ----------

  const crumb =
    phase === PHASES.ASSISTANT ? "Build feed"
      : phase === PHASES.ANALYZING ? "Analyzing source…"
      : phase === PHASES.RECOMMEND ? "Choose an approach"
      : `Configure ${(FEED_TYPES_FULL.find((t) => t.id === activeType) || {}).label || "feed"}`;

  return (
    <div className="page">
      <header className="page-header">
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => (window.location.href = "index.html")}
          title="Back to My Feeds"
        >
          <Icon name="chev" size={14} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="page-title">
          <h1>{editing ? `Edit ${initial.feedName || "feed"}` : "Build feed"}</h1>
          <span className="sub">{crumb}</span>
        </div>
        <div className="page-actions">
          {phase === PHASES.BUILDER && (
            <React.Fragment>
              <span className="autosave" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--ok)" }} />
                Draft saved {draftSavedAt}
              </span>
              <button className="btn" onClick={onBack}>
                Discard
              </button>
              <button className="btn btn-brand" onClick={onSave}>
                <Icon name="check" size={13} /> {editing ? "Save changes" : "Create feed"}
              </button>
            </React.Fragment>
          )}
        </div>
      </header>

      <div className="page-body">
        {phase === PHASES.BUILDER ? (
          <div className={sections.length > 1 ? "build-3col" : "build-layout"}>
            {sections.length > 1 && (
              <SectionNav
                sections={sections}
                active={activeSection}
                onChange={setActiveSection}
                collapsed={navCollapsed}
                onToggleCollapsed={() => setNavCollapsed((c) => !c)}
              />
            )}
            <div className="build-main">
              {Builder ? (
                <React.Fragment>
                  {sections.length > 1 && activeSection && (
                    <SectionHeader
                      title={sections.find((s) => s.id === activeSection)?.label || ""}
                      sub={
                        activeSection === "basic" ? "Identity, refresh schedule, and tags."
                          : activeSection === "source" ? "Where Mkfd fetches from on every refresh."
                          : activeSection === "items" ? "How items are pulled out of the source."
                          : activeSection === "channel" ? "RSS channel-level metadata."
                          : activeSection === "output" ? "Sort order, strictness, and outbound webhook."
                          : activeSection === "advanced" ? "Timeouts, retry, user-agent, FlareSolverr, browser rendering."
                          : undefined
                      }
                      ix={sections.findIndex((s) => s.id === activeSection)}
                      total={sections.length}
                    />
                  )}
                  <Builder initial={initial} appliedAnalysis={appliedAnalysis} activeSection={activeSection} />
                  {sections.length > 1 && (
                    <SectionPager sections={sections} active={activeSection} onChange={setActiveSection} />
                  )}
                </React.Fragment>
              ) : (
                <div className="card">
                  <div className="card-body" style={{ padding: 40, textAlign: "center", color: "var(--ink-3)" }}>
                    Pick a feed type to continue.
                  </div>
                </div>
              )}
              {/* Sticky save bar — duplicated to be reachable at form bottom */}
              <div className="save-bar">
                <span className="draft">
                  <span className="dot" />
                  Autosaved as draft · feedId will be generated on save
                </span>
                <span className="grow" />
                <button className="btn" onClick={onBack}>Cancel</button>
                <button className="btn btn-primary" onClick={() => toast.push({ tone: "", title: "Preview generated", body: "Right panel updated." })}>
                  <Icon name="eye" size={13} /> Test feed
                </button>
                <button className="btn btn-brand" onClick={onSave}>
                  <Icon name="check" size={13} /> {editing ? "Save changes" : "Create feed"}
                </button>
              </div>
            </div>

            <aside className="build-side">
              <PreviewPanel state={builderState} />
              {appliedAnalysis && <AnalysisSidePanel analysis={analysis} />}
            </aside>
          </div>
        ) : phase === PHASES.ANALYZING ? (
          <div className="build-layout">
            <div className="build-main">
              <AnalysisProgress url={url} step={analyzeStep} />
            </div>
            <aside className="build-side">
              <div className="card">
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5, color: "var(--ink-3)" }}>
                  <div style={{ fontWeight: 500, color: "var(--ink)" }}>What's happening?</div>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    Mkfd fetches the source once, then runs every check in parallel: existing feeds, sitemaps, calendars, API shape, JSON-LD, repeated item links, and a sample of detail pages.
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.5 }}>
                    The same observation powers the recommendations and pre-fills whichever builder you pick.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        ) : phase === PHASES.RECOMMEND ? (
          <div className="build-layout">
            <div className="build-main">
              <RecommendationList
                analysis={analysis}
                onApply={onApply}
                onReanalyze={onReanalyze}
              />
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--ink-3)", fontSize: 12.5 }}>
                None of these fit? <button className="btn btn-ghost btn-sm" onClick={() => setPhase(PHASES.ASSISTANT)}>← Start over</button>
              </div>
            </div>
            <aside className="build-side">
              <AnalysisSidePanel analysis={analysis} />
            </aside>
          </div>
        ) : (
          // ASSISTANT (landing)
          <div className="build-layout">
            <div className="build-main">
              <SourceAssistant
                url={url}
                setUrl={setUrl}
                onAnalyze={onAnalyze}
                advancedFetch={advancedFetch}
                setAdvancedFetch={setAdvancedFetch}
                headersCookies={headersCookies}
                setHeadersCookies={setHeadersCookies}
                manualHint={manualHint}
                setManualHint={setManualHint}
                onPickType={onPickType}
              />
            </div>
            <aside className="build-side">
              <div className="card">
                <div className="card-head">
                  <span className="ic"><Icon name="info" size={14} /></span>
                  <div>
                    <h3>Tips for fast setup</h3>
                    <div className="sub">Try the source assistant first — it usually picks the right path.</div>
                  </div>
                </div>
                <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 12.5, color: "var(--ink-2)" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--brand-soft)", color: "var(--brand-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Icon name="globe" size={12} />
                    </span>
                    <div>
                      <strong style={{ fontWeight: 500 }}>News site or blog?</strong>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>The assistant prefers existing feeds, then sitemap, then Drill Chain + JSON-LD on detail pages.</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--info-soft)", color: "var(--info-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Icon name="code" size={12} />
                    </span>
                    <div>
                      <strong style={{ fontWeight: 500 }}>JSON or API endpoint?</strong>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Paste the endpoint URL directly. Add headers in the next step.</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 6, background: "var(--ok-soft)", color: "var(--ok-ink)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Icon name="lock" size={12} />
                    </span>
                    <div>
                      <strong style={{ fontWeight: 500 }}>Secrets?</strong>
                      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Every key/header field has a Plain / Encrypted / Env switch. Sensitive names default to encrypted.</div>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

window.BuildFeedPage = BuildFeedPage;
