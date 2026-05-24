// Source Assistant — landing view + analysis progress + recommendation cards.

const ANALYSIS_STEPS = [
  "Fetching source",
  "Checking for existing feeds",
  "Checking for sitemaps",
  "Checking for calendars",
  "Checking API/JSON shape",
  "Detecting forms",
  "Reading page-level JSON-LD",
  "Detecting repeated item links",
  "Sampling Drill Chain detail pages",
  "Reading detail-page JSON-LD",
  "Suggesting CSS selectors",
  "Building recommendations",
];

// Mock observations for a recognizable URL pattern. In a real app the backend
// returns this. We synthesize a plausible response per URL prefix so the
// prototype shows different shapes.
const synthAnalysis = (url) => {
  const u = (url || "").toLowerCase();
  // Default: news-style page that benefits from Drill Chain + JSON-LD
  let recs = [
    {
      id: "rec-scrape",
      routeType: "scrape",
      label: "Web scraping",
      confidence: 91,
      confidenceBand: "goodOption",
      summary: "Drill Chain + JSON-LD",
      summaryDetail: "Sample article detail pages contain NewsArticle JSON-LD with consistent fields.",
      reasons: [
        { code: "listing_links", message: "Listing page has 24 repeated article links matching <article> > h2 > a." },
        { code: "page_jsonld_weak", message: "Page-level JSON-LD only describes the website (Organization, BreadcrumbList)." },
        { code: "detail_jsonld_strong", message: "3 sampled detail pages contain NewsArticle JSON-LD." },
        { code: "consistent_mapping", message: "Detail JSON-LD includes title, datePublished, author, description, and image." },
      ],
      warnings: [],
      evidence: [
        { k: "url", v: "https://example.com/news" },
        { k: "selector", v: "article.card a[href]" },
        { k: "type", v: "NewsArticle" },
        { k: "fields", v: "headline, datePublished, author.name, image.url" },
      ],
      cta: "Configure web scraping",
      action: "open-scrape",
    },
    {
      id: "rec-sitemap",
      routeType: "sitemap",
      label: "Sitemap feed",
      confidence: 78,
      confidenceBand: "goodOption",
      summary: "sitemap.xml lists recent article URLs",
      reasons: [
        { code: "sitemap_found", message: "robots.txt declares /sitemap.xml — 312 URLs parsed." },
        { code: "recent_lastmod", message: "92 URLs have <lastmod> within the past 30 days." },
      ],
      warnings: [{ code: "no_titles", message: "Sitemap URLs lack title metadata — pageMetadata fetch will be needed.", severity: "warning" }],
      evidence: [
        { k: "sitemap", v: "https://example.com/sitemap.xml" },
        { k: "urls", v: "312 (article-like: 92)" },
      ],
      cta: "Configure sitemap",
      action: "open-sitemap",
    },
    {
      id: "rec-existing",
      routeType: "feedTransformer",
      label: "Existing feed",
      confidence: 42,
      confidenceBand: "fallback",
      summary: "A stale RSS feed is published, but last item is from 2023.",
      reasons: [
        { code: "rss_found", message: "<link rel=\"alternate\" type=\"application/rss+xml\"> points to /feed.xml." },
        { code: "stale", message: "Latest item date is 2023-08-14 — likely abandoned." },
      ],
      warnings: [{ code: "stale_feed", message: "Existing feed appears stale.", severity: "warning" }],
      evidence: [
        { k: "feed", v: "https://example.com/feed.xml" },
        { k: "format", v: "RSS 2.0" },
        { k: "last", v: "2023-08-14" },
      ],
      cta: "Transform existing feed",
      action: "open-existing",
    },
    {
      id: "rec-manual",
      routeType: "manual",
      label: "Configure manually",
      confidence: 0,
      confidenceBand: "fallback",
      summary: "Pick a feed type and configure every field yourself.",
      reasons: [],
      warnings: [],
      evidence: [],
      cta: "Configure manually",
      action: "open-picker",
    },
  ];

  if (u.endsWith(".ics") || u.includes("calendar") || u.includes("events")) {
    recs = [
      {
        id: "rec-cal",
        routeType: "calendar",
        label: "Calendar feed",
        confidence: 96,
        confidenceBand: "veryLikely",
        summary: "Valid ICS calendar with 18 upcoming events.",
        reasons: [
          { code: "content_type", message: "Content-Type is text/calendar." },
          { code: "vcalendar", message: "Response begins with BEGIN:VCALENDAR." },
          { code: "events", message: "Found 18 VEVENT entries within 30 days." },
        ],
        warnings: [],
        evidence: [
          { k: "url", v: url },
          { k: "tz", v: "America/Chicago" },
          { k: "events", v: "18 upcoming" },
        ],
        cta: "Configure calendar",
        action: "open-calendar",
      },
      ...recs.slice(-1),
    ];
  } else if (u.includes("api.") || u.endsWith(".json") || u.includes("/api/")) {
    recs = [
      {
        id: "rec-rest",
        routeType: "rest",
        label: "REST API",
        confidence: 88,
        confidenceBand: "goodOption",
        summary: "JSON array of items detected — needs field mapping.",
        reasons: [
          { code: "json", message: "Response is application/json." },
          { code: "array", message: "Root is an array of 30 objects." },
          { code: "shape", message: "Items have title-like, link-like, and date-like fields." },
        ],
        warnings: [],
        evidence: [
          { k: "endpoint", v: url },
          { k: "items", v: "30" },
          { k: "fields", v: "name, html_url, published_at, body" },
        ],
        cta: "Map API fields",
        action: "open-rest",
      },
      ...recs.slice(-1),
    ];
  } else if (u.includes("graphql")) {
    recs = [
      {
        id: "rec-gql",
        routeType: "graphql",
        label: "GraphQL",
        confidence: 84,
        confidenceBand: "goodOption",
        summary: "Endpoint returns a GraphQL error shape — query setup required.",
        reasons: [
          { code: "endpoint", message: "URL ends in /graphql and returns a GraphQL error envelope." },
        ],
        warnings: [],
        evidence: [
          { k: "endpoint", v: url },
        ],
        cta: "Configure GraphQL",
        action: "open-graphql",
      },
      ...recs.slice(-1),
    ];
  } else if (u.endsWith(".xml") && u.includes("sitemap")) {
    recs = [
      {
        id: "rec-sm",
        routeType: "sitemap",
        label: "Sitemap feed",
        confidence: 94,
        confidenceBand: "veryLikely",
        summary: "Valid sitemap with 312 URLs.",
        reasons: [
          { code: "sitemap", message: "Valid <urlset> with 312 entries." },
          { code: "lastmod", message: "All entries include <lastmod>." },
        ],
        warnings: [],
        evidence: [{ k: "url", v: url }, { k: "count", v: "312" }],
        cta: "Configure sitemap",
        action: "open-sitemap",
      },
      ...recs.slice(-1),
    ];
  }

  return { url, recs };
};

// ---------- Source Assistant landing ----------

const SourceAssistant = ({ url, setUrl, onAnalyze, advancedFetch, setAdvancedFetch, headersCookies, setHeadersCookies, manualHint, setManualHint, onPickType }) => {
  return (
    <div className="card assistant">
      <div className="assistant-hero">
        <h2>What do you want to turn into a feed?</h2>
        <p>Paste a URL — Mkfd will check for an existing feed, sitemap, calendar, API, JSON-LD, and scrapeable content, then recommend the best path.</p>
        <div className="assistant-input-row">
          <input
            className="input lg"
            placeholder="https://example.com/news"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && onAnalyze()}
          />
          <button className="btn btn-brand" disabled={!url} onClick={onAnalyze}>
            <Icon name="sparkles" size={14} /> Analyze source
          </button>
        </div>
        <div className="assistant-options">
          <label className="check">
            <input
              type="checkbox"
              checked={headersCookies}
              onChange={(e) => setHeadersCookies(e.target.checked)}
            />
            This source needs headers or cookies
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={advancedFetch}
              onChange={(e) => setAdvancedFetch(e.target.checked)}
            />
            Try advanced browser rendering
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={manualHint}
              onChange={(e) => setManualHint(e.target.checked)}
            />
            I already know what type of feed this is
          </label>
        </div>
      </div>

      <div className="assistant-divider">
        <span className="line" />
        Or pick a feed type
        <span className="line" />
      </div>

      <div className="type-grid">
        {FEED_TYPES_FULL.map((t) => (
          <button key={t.id} className="type-card" onClick={() => onPickType(t.id)}>
            <div className="row">
              <TypeBg type={t.id} size={26} />
              <strong>{t.label}</strong>
            </div>
            <div className="desc">{t.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

// ---------- Analysis progress ----------

const AnalysisProgress = ({ url, step }) => {
  return (
    <div className="progress">
      <div className="progress-head">
        <div className="spin" />
        <div style={{ minWidth: 0 }}>
          <h3>Analyzing source…</h3>
          <div className="url">{url}</div>
        </div>
      </div>
      <div className="progress-steps">
        {ANALYSIS_STEPS.map((s, i) => {
          const state = i < step ? "done" : i === step ? "run" : "";
          return (
            <div key={s} className={"progress-step " + state}>
              <span className="ic">
                {i < step ? <Icon name="check" size={9} /> : i === step ? "" : ""}
              </span>
              {s}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------- Recommendation card ----------

const ConfidenceBand = ({ band, confidence }) => {
  const labels = {
    veryLikely: "Very likely",
    goodOption: "Good option",
    possible: "Possible",
    fallback: "Fallback",
    notRecommended: "Not recommended",
  };
  return (
    <div className="confidence">
      <div className={"meter " + band}>
        <span style={{ width: confidence + "%" }} />
      </div>
      <span className="pct">{confidence}%</span>
      <span className="band">{labels[band] || ""}</span>
    </div>
  );
};

const RecommendationCard = ({ rec, rank, isTop, onApply }) => {
  const [open, setOpen] = useState(isTop);
  const typeIcon = rec.routeType === "scrape" ? "globe"
    : rec.routeType === "sitemap" ? "map"
    : rec.routeType === "calendar" ? "calendar"
    : rec.routeType === "rest" ? "code"
    : rec.routeType === "graphql" ? "graphql"
    : rec.routeType === "feedTransformer" ? "rss"
    : rec.routeType === "serviceConnector" ? "sparkles"
    : rec.routeType === "manual" ? "sliders"
    : "rss";
  const showDetails = rec.reasons.length > 0 || rec.evidence.length > 0 || rec.warnings.length > 0;
  return (
    <div className={"rec-card" + (isTop ? " top" : "")}>
      <div className="rec-card-head">
        <span className="rank">{rank}</span>
        <div>
          <h3>
            <Icon name={typeIcon} size={15} style={{ color: "var(--ink-3)" }} />
            {rec.label}
            {rec.summary && (
              <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: 13 }}>
                · {rec.summary}
              </span>
            )}
          </h3>
          {rec.summaryDetail && <div className="summary">{rec.summaryDetail}</div>}
        </div>
        <ConfidenceBand band={rec.confidenceBand} confidence={rec.confidence} />
      </div>
      {showDetails && open && (
        <div className="rec-card-details">
          <div className="rec-detail-grid">
            {rec.reasons.length > 0 && (
              <div className="rec-detail">
                <h5>Why</h5>
                <ul>
                  {rec.reasons.map((r, i) => (
                    <li key={i}>{r.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {rec.evidence.length > 0 && (
              <div className="rec-detail">
                <h5>Evidence</h5>
                <ul className="evidence" style={{ listStyle: "none" }}>
                  {rec.evidence.map((e, i) => (
                    <li key={i}>
                      <span className="k">{e.k}</span>
                      <span className="v">{e.v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {rec.warnings.length > 0 && (
            <div className="rec-detail">
              <h5>Warnings</h5>
              <ul>
                {rec.warnings.map((w, i) => (
                  <li key={i} className={w.severity === "error" ? "err" : "warn"}>
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div className="rec-card-foot">
        {showDetails && (
          <button
            className={"rec-disclose" + (open ? " open" : "")}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"} details
            <Icon name="chevd" size={12} />
          </button>
        )}
        <span className="grow" />
        <button
          className={isTop ? "btn btn-brand" : "btn"}
          onClick={() => onApply(rec)}
        >
          {rec.cta} <Icon name="chev" size={12} />
        </button>
      </div>
    </div>
  );
};

const RecommendationList = ({ analysis, onApply, onReanalyze }) => {
  return (
    <div className="card">
      <div className="card-head">
        <span className="ic"><Icon name="sparkles" size={14} /></span>
        <div>
          <h3>Recommended approaches</h3>
          <div className="sub">Analyzed {analysis.url}</div>
        </div>
        <div className="right">
          <button className="btn btn-ghost btn-sm" onClick={onReanalyze}>
            <Icon name="refresh" size={12} /> Re-analyze
          </button>
        </div>
      </div>
      <div className="card-body" style={{ background: "var(--bg-sunken)" }}>
        <div className="recs">
          {analysis.recs.map((r, i) => (
            <RecommendationCard
              key={r.id}
              rec={r}
              rank={i + 1}
              isTop={i === 0}
              onApply={onApply}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  ANALYSIS_STEPS,
  synthAnalysis,
  SourceAssistant,
  AnalysisProgress,
  RecommendationList,
});
