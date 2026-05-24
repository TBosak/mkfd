// Web Scraping form — the deep, hi-fi builder.
//
// Sections:
//   1. Basic (feed name, refresh, tags, category)
//   2. Request setup (Simple URL / Form submission)
//   3. Headers + Cookies (collapsible)
//   4. Extraction (mode picker + mode-specific fields)
//   5. Drill Chain / JSON-LD / CSS selector blocks
//   6. Selector Playground (inline)
//   7. Advanced settings (collapsible)

const EXTRACTION_MODES = [
  {
    id: "drillChainJsonLd",
    icon: "layers",
    label: "Drill Chain + JSON-LD",
    desc: "One shared drill chain follows item links, then JSON-LD on each detail page maps every field at once.",
  },
  {
    id: "drillChainJsonLdFallback",
    icon: "layers",
    label: "Drill Chain + JSON-LD (with CSS fallback)",
    desc: "JSON-LD on detail pages, with CSS fallbacks for fields the structured data is missing.",
  },
  {
    id: "pageJsonLd",
    icon: "code",
    label: "Page JSON-LD",
    desc: "Use JSON-LD embedded on this page (ItemList or repeated entities).",
  },
  {
    id: "cssSelectors",
    icon: "target",
    label: "CSS selectors (per field)",
    desc: "Per-field selectors. Each field can drill into a detail page independently.",
  },
  {
    id: "manual",
    icon: "sliders",
    label: "Manual",
    desc: "Write the selectors and mapping yourself — no suggestions.",
  },
];

const JSONLD_FIELDS = [
  { id: "title",       label: "title",       required: true,  paths: ["headline", "name", "title"] },
  { id: "link",        label: "link",        required: true,  paths: ["url", "mainEntityOfPage", "@id"] },
  { id: "pubDate",     label: "pubDate",     required: false, paths: ["datePublished", "dateCreated", "dateModified"] },
  { id: "description", label: "description", required: false, paths: ["description", "abstract", "articleBody"] },
  { id: "author",      label: "author",      required: false, paths: ["author.name", "author[0].name", "creator.name"] },
  { id: "enclosure",   label: "enclosure",   required: false, paths: ["image.url", "image[0].url", "thumbnailUrl"] },
  { id: "guid",        label: "guid",        required: false, paths: ["@id", "url", "identifier"] },
];

const SAMPLE_DETAIL_PAGES = [
  { url: "https://example.com/news/2026-05-22-city-council-passes-budget", ok: true,  types: ["NewsArticle"], coverage: 6 },
  { url: "https://example.com/news/2026-05-21-spring-festival-announced",   ok: true,  types: ["NewsArticle"], coverage: 6 },
  { url: "https://example.com/news/2026-05-20-park-renovation-begins",      ok: true,  types: ["NewsArticle"], coverage: 5, warn: "image.url missing" },
];

const sampleHtml =
`<section class="news-list">
  <article class="card">
    <h2><a href="/news/2026-05-22-city-council">City council passes budget</a></h2>
    <time datetime="2026-05-22">May 22</time>
    <p>The council approved the 2027 fiscal year budget Thursday…</p>
  </article>
  <article class="card">
    <h2><a href="/news/2026-05-21-spring-festival">Spring festival announced</a></h2>
    <time datetime="2026-05-21">May 21</time>
    <p>The annual spring festival returns next month with…</p>
  </article>
</section>`;

const highlightHtml = (html, selector) => {
  // For prototype: just bold-highlight matches by selector roughly
  if (!selector) return html;
  if (selector.includes("article.card a") || selector === "article.card > h2 > a") {
    return html.replace(
      /<a (href="[^"]+">)([^<]+)<\/a>/g,
      (_, attrs, text) => `<a ${attrs}<mark>${text}</mark></a>`
    );
  }
  if (selector === "article.card h2") {
    return html.replace(
      /<h2>(<a[^>]+>)([^<]+)(<\/a>)<\/h2>/g,
      (_, a, t, ca) => `<h2>${a}<mark>${t}</mark>${ca}</h2>`
    );
  }
  return html;
};

const colorize = (html) =>
  html
    .replace(/(&|<)/g, (s) => (s === "<" ? "\u0001LT\u0001" : s))
    .replace(/\u0001LT\u0001(\/?\w+)([^>]*)>/g, (_, tag, rest) => {
      const attrs = rest.replace(/\s+(\w[\w-]*)(=)("[^"]*")/g, (_, k, eq, v) =>
        ` <span class="attr">${k}</span><span class="val">${eq}${v}</span>`
      );
      return `<span class="tag">&lt;${tag}</span>${attrs}<span class="tag">&gt;</span>`;
    });

// ---------- Selector playground ----------

const SelectorPlayground = ({ selector, setSelector, label = "Iterator selector", suggestionCount = 24 }) => {
  const highlighted = useMemo(() => colorize(highlightHtml(sampleHtml, selector)), [selector]);
  const match = selector
    ? selector === "article.card a" || selector === "article.card > h2 > a"
      ? { count: suggestionCount, ok: true }
      : selector === "article.card h2"
      ? { count: suggestionCount, ok: true }
      : { count: 0, ok: false }
    : { count: 0, ok: false };

  return (
    <div className="playground">
      <div className="playground-bar">
        <span style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 600, letterSpacing: 0.06, textTransform: "uppercase" }}>
          {label}
        </span>
        <input
          className="input"
          placeholder="e.g. article.card a"
          value={selector}
          onChange={(e) => setSelector(e.target.value)}
        />
        <span className="count">
          {match.ok ? (
            <><strong>{match.count}</strong> matches</>
          ) : selector ? (
            <span style={{ color: "var(--err)" }}>0 matches</span>
          ) : (
            <span style={{ color: "var(--ink-4)" }}>no selector</span>
          )}
        </span>
        <button className="btn btn-sm" title="Suggest with the existing engine">
          <Icon name="sparkles" size={11} /> Suggest
        </button>
      </div>
      <div
        className="playground-body"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    </div>
  );
};

// ---------- JSON-LD mapping editor ----------

const JSONLDMappingEditor = ({ mapping, setMapping, includeCssFallback }) => {
  return (
    <div className="jsonld-map">
      <div className="jsonld-map-row" style={{ background: "var(--bg-sunken)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--ink-4)", fontFamily: "var(--font-sans)", fontWeight: 600, gridTemplateColumns: includeCssFallback ? "100px 1fr 26px 1fr" : "100px 1fr 26px 1fr" }}>
        <div>Feed field</div>
        <div>JSON-LD path</div>
        <div></div>
        <div>{includeCssFallback ? "CSS fallback" : "Detected paths"}</div>
      </div>
      {JSONLD_FIELDS.map((f) => (
        <div className="jsonld-map-row" key={f.id}>
          <div className="field-name">
            {f.label}
            {f.required && <span className="req">*</span>}
          </div>
          <input
            value={mapping[f.id]?.path || f.paths[0]}
            placeholder={"e.g. " + f.paths[0]}
            onChange={(e) =>
              setMapping({
                ...mapping,
                [f.id]: { ...(mapping[f.id] || {}), path: e.target.value },
              })
            }
          />
          <span className="arrow"><Icon name="chev" size={11} /></span>
          {includeCssFallback ? (
            <input
              value={mapping[f.id]?.fallback || ""}
              placeholder={"e.g. " + (f.id === "title" ? ".article h1" : ".article ." + f.id)}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  [f.id]: { ...(mapping[f.id] || {}), fallback: e.target.value },
                })
              }
            />
          ) : (
            <span style={{ color: "var(--ink-4)", fontSize: 11 }}>
              {f.paths.slice(0, 2).join(", ")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

// ---------- Form submission picker ----------

const DetectedFormCard = ({ form, active, onSelect }) => (
  <button
    type="button"
    className={"mode-card" + (active ? " active" : "")}
    onClick={onSelect}
    style={{ minWidth: 0 }}
  >
    <div className="row" style={{ justifyContent: "space-between" }}>
      <strong>{form.label}</strong>
      <Badge tone={form.confidence === "high" ? "ok" : form.confidence === "low" ? "warn" : ""}>
        {form.confidence}
      </Badge>
    </div>
    <div className="desc">
      <span className="mono">{form.method} {form.action}</span>
      <br />
      Fields: {form.fields.map((f) => f.name).join(", ")}
    </div>
    {form.warning && (
      <div style={{ fontSize: 11, color: "var(--warn-ink)", marginTop: 4 }}>
        <Icon name="alert" size={10} /> {form.warning}
      </div>
    )}
  </button>
);

const MOCK_FORMS = [
  {
    id: "search",
    label: "Search form",
    method: "GET",
    action: "/search",
    confidence: "high",
    fields: [
      { name: "q", type: "search", value: "", required: true },
      { name: "category", type: "select", value: "all", options: ["all", "news", "press", "agendas"] },
      { name: "sort", type: "select", value: "newest", options: ["newest", "oldest"] },
    ],
  },
  {
    id: "newsletter",
    label: "Newsletter signup",
    method: "POST",
    action: "/subscribe",
    confidence: "low",
    warning: "Email-only forms are usually not useful feed sources.",
    fields: [{ name: "email", type: "email", value: "" }],
  },
  {
    id: "login",
    label: "Login",
    method: "POST",
    action: "/signin",
    confidence: "low",
    warning: "Login forms are not supported as feed sources.",
    fields: [{ name: "username", type: "text", value: "" }, { name: "password", type: "password", value: "" }],
  },
];

// ---------- Per-field selector rows (CSS mode) ----------

// Mirrors the existing implementation: every feed field has its own selector,
// attribute, iterator, options, AND an optional per-field drill chain.
const SCRAPING_FIELDS = [
  { id: "title",          label: "Title",       required: true,  stripHtml: true, titleCase: true },
  { id: "link",           label: "Link",        required: true,  relativeLink: true, defaultAttr: "href" },
  { id: "description",    label: "Description", stripHtml: true, titleCase: true },
  { id: "date",           label: "Pub date",    dateFormat: true },
  { id: "author",         label: "Author",      stripHtml: true, titleCase: true },
  { id: "enclosure",      label: "Enclosure (media)", relativeLink: true, defaultAttr: "src" },
  { id: "guid",           label: "GUID",        guidIsPermaLink: true },
  { id: "categories",     label: "Categories" },
  { id: "contentEncoded", label: "Content (full)", stripHtml: true, titleCase: true },
  { id: "summary",        label: "Summary",     stripHtml: true, titleCase: true },
  { id: "contributors",   label: "Contributors" },
  { id: "sourceUrl",      label: "Source URL",  relativeLink: true, defaultAttr: "href" },
  { id: "sourceTitle",    label: "Source title" },
  { id: "lat",            label: "Latitude" },
  { id: "long",           label: "Longitude" },
];
const DEFAULT_VISIBLE_FIELDS = ["title", "link", "description", "date", "author"];

const defaultFieldValue = (def) => ({
  selector: "",
  attribute: def.defaultAttr || "",
  iterator: "",
  stripHtml: false,
  titleCase: false,
  relativeLink: false,
  baseUrl: "",
  dateFormat: "",
  customDateFormat: "",
  guidIsPermaLink: false,
  drillChain: [],
});

// Inline per-field drill chain editor (compact).
// Each step can extract via CSS selector OR a JSON-LD path. If the extracted
// value is a URL, the next step fetches that URL and extracts from there.
const InlineDrillStep = ({ step, ix, onChange, onRemove, isLast }) => {
  const kind = step.kind || "css";
  return (
    <div className="drill-step">
      <span className="ix">step {ix + 1}</span>
      <div className="drill-step-head">
        <span className="seg-mini">
          <button
            className={kind === "css" ? "active" : ""}
            onClick={() => onChange({ ...step, kind: "css" })}
            title="Match a CSS selector"
          >
            CSS
          </button>
          <button
            className={kind === "jsonLd" ? "active" : ""}
            onClick={() => onChange({ ...step, kind: "jsonLd" })}
            title="Match a JSON-LD path on the current page"
          >
            JSON-LD
          </button>
        </span>
        <button className="del" onClick={onRemove} title="Remove step">
          <Icon name="x" size={13} />
        </button>
      </div>
      {kind === "css" ? (
        <div className="drill-step-grid">
          <input
            className="input mono"
            placeholder="article.card a"
            value={step.selector || ""}
            onChange={(e) => onChange({ ...step, selector: e.target.value })}
          />
          <input
            className="input mono"
            placeholder="href"
            value={step.attribute || ""}
            onChange={(e) => onChange({ ...step, attribute: e.target.value })}
            title="Attribute (leave empty for text content)"
          />
        </div>
      ) : (
        <div className="drill-step-grid full">
          <input
            className="input mono"
            placeholder="mainEntityOfPage  /  url  /  author.url"
            value={step.path || ""}
            onChange={(e) => onChange({ ...step, path: e.target.value })}
            title="JSON-LD dot path on the current page"
          />
        </div>
      )}
      <div className="drill-step-rel">
        <label>
          <input
            type="checkbox"
            checked={!!step.isRelative}
            onChange={(e) => onChange({ ...step, isRelative: e.target.checked })}
          />
          Relative URL
        </label>
        {step.isRelative && (
          <input
            className="input mono"
            placeholder="https://example.com"
            value={step.baseUrl || ""}
            onChange={(e) => onChange({ ...step, baseUrl: e.target.value })}
          />
        )}
      </div>
      <div className="drill-step-foot">
        {isLast
          ? "\u2192 extract the field value from the page reached by this step"
          : "\u2192 fetch the URL extracted here, then continue with step " + (ix + 2)}
      </div>
    </div>
  );
};

const InlineDrillChain = ({ steps, onChange, baseUrlHint }) => {
  const update = (ix, next) => onChange(steps.map((s, i) => (i === ix ? next : s)));
  const remove = (ix) => onChange(steps.filter((_, i) => i !== ix));
  const add = () =>
    onChange([
      ...steps,
      { kind: "css", selector: "", attribute: "href", isRelative: true, baseUrl: baseUrlHint || "" },
    ]);
  return (
    <div className="drill-chain">
      {steps.length === 0 && (
        <div className="drill-disc-empty">
          No drill steps. Add one to follow links to a detail page before extracting this field.
        </div>
      )}
      {steps.map((step, ix) => (
        <React.Fragment key={ix}>
          {ix > 0 && <div className="drill-arrow"><Icon name="chevd" size={14} /></div>}
          <InlineDrillStep
            step={step}
            ix={ix}
            onChange={(next) => update(ix, next)}
            onRemove={() => remove(ix)}
            isLast={ix === steps.length - 1}
          />
        </React.Fragment>
      ))}
      <button className="btn btn-sm" onClick={add} style={{ alignSelf: "flex-start" }}>
        <Icon name="plus" size={11} /> Add drill step
      </button>
    </div>
  );
};

// Per-feed-field row
const FieldSelectorRow = ({ def, value, onChange, onRemove, baseUrlHint, allFieldValues }) => {
  const [open, setOpen] = useState(def.required && !value.selector);
  const [drillOpen, setDrillOpen] = useState((value.drillChain || []).length > 0);
  const stepCt = (value.drillChain || []).length;
  const hasValue = !!value.selector;
  return (
    <div className={"field-row-card" + (open ? " open" : "") + (hasValue ? " has-value" : "")}>
      <div className="field-row-head" onClick={() => setOpen((o) => !o)}>
        <span className="nm">
          {def.label}
          {def.required && <span className="req">*</span>}
        </span>
        <span className={"sel" + (hasValue ? "" : " empty")}>
          {hasValue ? value.selector : "Not set"}
        </span>
        {stepCt > 0 && (
          <Badge tone="brand">
            <Icon name="layers" size={10} /> drill {stepCt}
          </Badge>
        )}
        <Icon name="chev" size={12} className="chev" />
      </div>
      {open && (
        <div className="field-row-body" onClick={(e) => e.stopPropagation()}>
          <FieldRow cols={2}>
            <Field label="Selector" required={def.required} hint="CSS selector relative to the iterator item.">
              <input
                className="input mono"
                placeholder={"." + def.id}
                value={value.selector || ""}
                onChange={(e) => onChange({ ...value, selector: e.target.value })}
              />
            </Field>
            <Field label="Attribute" optional hint="Leave empty for text content.">
              <input
                className="input mono"
                placeholder={def.defaultAttr || "(text content)"}
                value={value.attribute || ""}
                onChange={(e) => onChange({ ...value, attribute: e.target.value })}
              />
            </Field>
          </FieldRow>

          <Field label="Parent iterator override" optional hint="Use this iterator instead of the default for this field.">
            <input
              className="input mono"
              placeholder=".article-body"
              value={value.iterator || ""}
              onChange={(e) => onChange({ ...value, iterator: e.target.value })}
            />
          </Field>

          {(def.stripHtml || def.titleCase || def.relativeLink || def.guidIsPermaLink) && (
            <div className="field-opts">
              {def.stripHtml && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!value.stripHtml}
                    onChange={(e) => onChange({ ...value, stripHtml: e.target.checked })}
                  />
                  Strip HTML
                </label>
              )}
              {def.titleCase && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!value.titleCase}
                    onChange={(e) => onChange({ ...value, titleCase: e.target.checked })}
                  />
                  Title case
                </label>
              )}
              {def.relativeLink && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!value.relativeLink}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        relativeLink: e.target.checked,
                        baseUrl: e.target.checked && !value.baseUrl ? baseUrlHint || "" : value.baseUrl,
                      })
                    }
                  />
                  Relative link
                </label>
              )}
              {def.guidIsPermaLink && (
                <label>
                  <input
                    type="checkbox"
                    checked={!!value.guidIsPermaLink}
                    onChange={(e) => onChange({ ...value, guidIsPermaLink: e.target.checked })}
                  />
                  GUID is permalink
                </label>
              )}
            </div>
          )}

          {def.relativeLink && value.relativeLink && (
            <Field label="Base URL" hint="Prepended to relative href values.">
              <input
                className="input mono"
                placeholder="https://example.com"
                value={value.baseUrl || ""}
                onChange={(e) => onChange({ ...value, baseUrl: e.target.value })}
              />
            </Field>
          )}

          {def.dateFormat && (
            <FieldRow cols={2}>
              <Field label="Date format" optional>
                <select
                  className="select"
                  value={value.dateFormat || "auto"}
                  onChange={(e) => onChange({ ...value, dateFormat: e.target.value })}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="iso">ISO 8601</option>
                  <option value="rfc">RFC 822</option>
                  <option value="unix">Unix timestamp</option>
                  <option value="custom">Custom…</option>
                </select>
              </Field>
              {value.dateFormat === "custom" && (
                <Field label="Custom format" hint="e.g. YYYY-MM-DD HH:mm">
                  <input
                    className="input mono"
                    value={value.customDateFormat || ""}
                    onChange={(e) => onChange({ ...value, customDateFormat: e.target.value })}
                  />
                </Field>
              )}
            </FieldRow>
          )}

          {/* Per-field drill chain */}
          <div className="drill-disc">
            <button
              className={"drill-disc-head" + (drillOpen ? " open" : "")}
              onClick={() => setDrillOpen((o) => !o)}
            >
              <Icon name="chev" size={11} className="ic" />
              <Icon name="layers" size={12} style={{ color: "var(--ink-3)" }} />
              Drill into detail page
              {stepCt > 0 && <span className="stepct">{stepCt} step{stepCt > 1 ? "s" : ""}</span>}
            </button>
            {drillOpen && (
              <div className="drill-disc-body">
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  Follow item links to a detail page, then extract this field from there.
                  Each field can have its own drill chain.
                </div>
                <InlineDrillChain
                  steps={value.drillChain || []}
                  onChange={(dc) => onChange({ ...value, drillChain: dc })}
                  baseUrlHint={baseUrlHint}
                />
                {/* Copy from another field */}
                {Object.keys(allFieldValues || {}).some(
                  (k) => k !== def.id && (allFieldValues[k]?.drillChain || []).length > 0
                ) && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-3)" }}>
                    Copy from 
                    <select
                      className="select"
                      style={{ height: 24, fontSize: 11.5, padding: "0 6px", width: "auto" }}
                      value=""
                      onChange={(e) => {
                        const src = allFieldValues[e.target.value];
                        if (src && src.drillChain) {
                          onChange({ ...value, drillChain: JSON.parse(JSON.stringify(src.drillChain)) });
                        }
                      }}
                    >
                      <option value="">another field…</option>
                      {Object.entries(allFieldValues || {})
                        .filter(([k, v]) => k !== def.id && (v?.drillChain || []).length > 0)
                        .map(([k, v]) => {
                          const meta = SCRAPING_FIELDS.find((f) => f.id === k);
                          return (
                            <option key={k} value={k}>
                              {(meta?.label || k) + " (" + v.drillChain.length + ")"}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {!def.required && (
            <div style={{ textAlign: "right", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <button className="btn btn-ghost btn-sm btn-danger" onClick={onRemove}>
                <Icon name="trash" size={11} /> Remove field
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ---------- Main Web Scraping form ----------

const WebScrapingBuilder = ({ initial, appliedAnalysis, activeSection = "basic", onSavedNotice }) => {
  // ---------- state ----------
  const [feedName, setFeedName] = useState(initial?.feedName || "");
  const [category, setCategory] = useState(initial?.category || "");
  const [tags, setTags] = useState(initial?.tags || []);
  const [refreshMinutes, setRefreshMinutes] = useState(initial?.refreshMinutes ?? 30);

  const [requestMode, setRequestMode] = useState(appliedAnalysis?.request?.mode || "simple");
  const [baseUrl, setBaseUrl] = useState(appliedAnalysis?.request?.url || initial?.baseUrl || "");
  const [selectedFormId, setSelectedFormId] = useState("search");
  const [formFields, setFormFields] = useState(() => {
    const f = MOCK_FORMS[0].fields;
    return f.map((x) => ({ ...x, include: true, storage: "plain" }));
  });

  const [headers, setHeaders] = useState(initial?.headers || []);
  const [cookies, setCookies] = useState(initial?.cookies || []);

  const recommendedMode = appliedAnalysis?.extraction?.mode || (appliedAnalysis ? "drillChainJsonLd" : "cssSelectors");
  const [extractionMode, setExtractionMode] = useState(recommendedMode);

  // Drill chain (shared, used by Drill Chain + JSON-LD modes).
  // Each step is CSS-or-JSON-LD; limit/concurrency apply to the chain as a whole.
  const [drillSteps, setDrillSteps] = useState([
    {
      kind: "css",
      selector: appliedAnalysis?.drillChain?.selector || "article.card a",
      attribute: "href",
      isRelative: true,
      baseUrl: "https://example.com",
    },
  ]);
  const [drillLimit, setDrillLimit] = useState(25);
  const [drillConcurrency, setDrillConcurrency] = useState(3);
  const [drillTimeoutMs, setDrillTimeoutMs] = useState(15000);

  // JSON-LD mapping
  const [jsonLdMapping, setJsonLdMapping] = useState(
    Object.fromEntries(JSONLD_FIELDS.map((f) => [f.id, { path: f.paths[0], fallback: "" }]))
  );

  // Per-field selectors (each can have its own drill chain).
  // Initialized with reasonable defaults from the sample.
  const [iteratorSelector, setIteratorSelector] = useState("article.card");
  const [fieldValues, setFieldValues] = useState(() => {
    const init = Object.fromEntries(
      SCRAPING_FIELDS.map((f) => [f.id, defaultFieldValue(f)])
    );
    init.title.selector = "h2";
    init.title.stripHtml = true;
    init.link.selector = "a";
    init.link.attribute = "href";
    init.link.relativeLink = true;
    init.link.baseUrl = "https://example.com";
    init.description.selector = "p";
    init.description.stripHtml = true;
    init.date.selector = "time";
    init.date.attribute = "datetime";
    return init;
  });
  const [visibleFieldIds, setVisibleFieldIds] = useState(DEFAULT_VISIBLE_FIELDS);
  const setFieldValue = (id, next) =>
    setFieldValues((v) => ({ ...v, [id]: next }));
  const addField = (id) => {
    if (!visibleFieldIds.includes(id)) setVisibleFieldIds([...visibleFieldIds, id]);
  };
  const removeField = (id) => {
    setVisibleFieldIds(visibleFieldIds.filter((x) => x !== id));
    setFieldValues((v) => ({ ...v, [id]: defaultFieldValue(SCRAPING_FIELDS.find((f) => f.id === id)) }));
  };

  // Advanced
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [userAgent, setUserAgent] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [flareSolverr, setFlareSolverr] = useState(false);
  const [flareServerUrl, setFlareServerUrl] = useState("http://flaresolverr:8191");
  const [flareTimeout, setFlareTimeout] = useState(60000);
  const [retryCount, setRetryCount] = useState(2);
  const [reverse, setReverse] = useState(false);
  const [strict, setStrict] = useState(false);

  // Channel-level (feed/channel metadata). Each can be a typed value OR a CSS selector scraped from the page.
  const [channel, setChannel] = useState({
    title: "",            titleSelector: "",
    description: "",      descriptionSelector: "",
    link: "",             linkSelector: "",
    language: "",         languageSelector: "",
    copyright: "",        copyrightSelector: "",
    managingEditor: "",   managingEditorSelector: "",
    webMaster: "",        webMasterSelector: "",
    categories: "",       categoriesSelector: "",
    ttl: "",              ttlSelector: "",
    skipDays: "",         skipDaysSelector: "",
    skipHours: "",        skipHoursSelector: "",
    imageUrl: "",         imageUrlSelector: "",
  });
  const setChannelField = (k, v) => setChannel((c) => ({ ...c, [k]: v }));

  // Outbound webhook
  const [webhook, setWebhook] = useState({
    enabled: false,
    url: "",
    urlStorage: "protected",
    format: "xml",
    newItemsOnly: true,
    headers: [],
    customPayload: "",
  });
  const setWebhookField = (k, v) => setWebhook((w) => ({ ...w, [k]: v }));

  const includeFallback = extractionMode === "drillChainJsonLdFallback";
  const showDrillChain = extractionMode === "drillChainJsonLd" || extractionMode === "drillChainJsonLdFallback";
  const showJsonLd = extractionMode !== "cssSelectors" && extractionMode !== "manual";
  const showCss = extractionMode === "cssSelectors" || extractionMode === "manual" || includeFallback;

  // ---------- expose state for preview ----------
  useEffect(() => {
    window.__builderState = {
      feedType: "scrape",
      feedName: feedName || "Untitled feed",
      baseUrl,
      tags,
      category,
      refreshMinutes,
      requestMode,
      extractionMode,
      drillSteps,
      jsonLdMapping,
      iteratorSelector,
      fieldValues,
      visibleFieldIds,
    };
    window.dispatchEvent(new CustomEvent("builder-state"));
  }, [feedName, baseUrl, tags, category, refreshMinutes, requestMode, extractionMode, drillSteps, jsonLdMapping, iteratorSelector, fieldValues, visibleFieldIds]);

  return (
    <div className="section">
      {appliedAnalysis && (
        <div className="applied-banner">
          <span className="ic"><Icon name="sparkles" size={14} /></span>
          <div className="body">
            <strong>Analysis applied — {appliedAnalysis.modeLabel || "Drill Chain + JSON-LD"}</strong>
            <span>{appliedAnalysis.summary || "Request, extraction, and mapping pre-filled from sampled detail pages."}</span>
          </div>
          <div className="actions">
            <button className="btn btn-sm">View analysis</button>
            <button className="btn btn-sm">
              <Icon name="refresh" size={11} /> Re-analyze
            </button>
          </div>
        </div>
      )}

      {/* 1. Basic */}
      {activeSection === "basic" && (
      <Section icon="rss" title="Basic" sub="Identity and refresh schedule">
        <FieldRow cols={2}>
          <Field label="Feed name" required hint="Stored as feedName. Used for display only.">
            <input
              className="input"
              value={feedName}
              onChange={(e) => setFeedName(e.target.value)}
              placeholder="Cape County Notices"
            />
          </Field>
          <Field label="Category" hint="One of civic, news, developer, personal, automation…">
            <input
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="civic"
            />
          </Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Refresh interval (minutes)" hint="0 = on demand only.">
            <input
              className="input"
              type="number"
              value={refreshMinutes}
              onChange={(e) => setRefreshMinutes(+e.target.value)}
            />
          </Field>
          <Field label="Tags" hint="Press Enter to add — used for filtering in My Feeds.">
            <input
              className="input"
              placeholder="government, local, notices"
              defaultValue={tags.join(", ")}
              onBlur={(e) => setTags(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
            />
          </Field>
        </FieldRow>
      </Section>
      )}

      {/* 2. Request setup */}
      {activeSection === "source" && (
      <Section icon="globe" title="Request setup" sub="How Mkfd fetches this page on every refresh">
        <Field label="Mode">
          <div className="modes" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <ModeCard
              active={requestMode === "simple"}
              icon="globe"
              label="Simple URL"
              desc="Fetch the URL directly on each refresh."
              onClick={() => setRequestMode("simple")}
            />
            <ModeCard
              active={requestMode === "form"}
              icon="sliders"
              label="Submit a form first"
              desc="POST/GET a form, then scrape the result page."
              onClick={() => setRequestMode("form")}
            />
          </div>
        </Field>
        <Field label="URL" required>
          <div className="input-prefix">
            <span className="pfx">https://</span>
            <input
              className="input mono"
              value={baseUrl.replace(/^https?:\/\//, "")}
              onChange={(e) => setBaseUrl("https://" + e.target.value)}
              placeholder="example.com/news"
            />
          </div>
        </Field>

        {requestMode === "form" && (
          <div className="section">
            <Field
              label="Detected forms"
              hint="Mkfd scanned the page and ranked likely useful forms first."
            >
              <div className="modes" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {MOCK_FORMS.map((f) => (
                  <DetectedFormCard
                    key={f.id}
                    form={f}
                    active={selectedFormId === f.id}
                    onSelect={() => {
                      setSelectedFormId(f.id);
                      setFormFields(f.fields.map((x) => ({ ...x, include: true, storage: "plain" })));
                    }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Form fields" hint="Edit values, exclude fields, or store sensitive ones encrypted.">
              <div className="kv-edit">
                <div className="kv-edit-row head">
                  <div>Name</div>
                  <div>Value</div>
                  <div>Storage</div>
                  <div></div>
                </div>
                {formFields.map((row, i) => (
                  <div className="kv-edit-row" key={i}>
                    <div className="cell">
                      <input
                        className="input"
                        value={row.name}
                        onChange={(e) =>
                          setFormFields(formFields.map((r, ix) => (ix === i ? { ...r, name: e.target.value } : r)))
                        }
                      />
                    </div>
                    <div className="cell">
                      {row.type === "select" ? (
                        <select
                          className="select"
                          value={row.value}
                          onChange={(e) =>
                            setFormFields(formFields.map((r, ix) => (ix === i ? { ...r, value: e.target.value } : r)))
                          }
                          style={{ border: 0, borderRadius: 0, height: 34, background: "transparent", fontFamily: "var(--font-mono)", fontSize: 12 }}
                        >
                          {(row.options || []).map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="input"
                          value={row.value}
                          placeholder={row.type === "search" ? "search term" : row.type}
                          onChange={(e) =>
                            setFormFields(formFields.map((r, ix) => (ix === i ? { ...r, value: e.target.value } : r)))
                          }
                        />
                      )}
                    </div>
                    <div className="cell storage">
                      <StorageSelect
                        value={row.storage}
                        onChange={(s) => setFormFields(formFields.map((r, ix) => (ix === i ? { ...r, storage: s } : r)))}
                        sensitive={looksSensitive(row.name)}
                      />
                    </div>
                    <div className="cell" style={{ justifyContent: "center" }}>
                      <button
                        className="del"
                        title="Remove field"
                        onClick={() => setFormFields(formFields.filter((_, ix) => ix !== i))}
                      >
                        <Icon name="x" size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Field>
          </div>
        )}
      </Section>
      )}

      {/* 3. Headers + cookies (collapsible) */}
      {activeSection === "source" && (
      <details className="card disclosure" style={{ borderTop: 0 }}>
        <summary>
          <Icon name="chev" size={12} />
          Headers & cookies
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--ink-4)", fontWeight: 400 }}>
            {headers.length + cookies.length === 0
              ? "None"
              : (headers.length ? headers.length + " headers" : "") +
                (headers.length && cookies.length ? " · " : "") +
                (cookies.length ? cookies.length + " cookies" : "")}
          </span>
        </summary>
        <div className="disclosure-body">
          <div className="section">
            <Field label="Headers" hint="Custom request headers. Encrypt or use env vars for Authorization.">
              <KVEditor
                rows={headers}
                onChange={setHeaders}
                keyPlaceholder="Authorization"
                valuePlaceholder="Bearer …"
                addLabel="Add header"
              />
            </Field>
            <Field label="Cookies" hint="Per-request cookies. Encrypt session values.">
              <KVEditor
                rows={cookies}
                onChange={setCookies}
                keyPlaceholder="session"
                valuePlaceholder="cookie value"
                addLabel="Add cookie"
              />
            </Field>
          </div>
        </div>
      </details>
      )}

      {/* 4. Extraction */}
      {activeSection === "items" && (
      <Section
        icon="layers"
        title="Extraction"
        sub="How items are pulled from the page"
        right={appliedAnalysis && (
          <Badge tone="brand">
            <Icon name="sparkles" size={10} />
            Auto-picked
          </Badge>
        )}
      >
        <Field>
          <div className="modes">
            {EXTRACTION_MODES.map((m) => (
              <ModeCard
                key={m.id}
                active={extractionMode === m.id}
                recommended={m.id === recommendedMode && !!appliedAnalysis}
                icon={m.icon}
                label={m.label}
                desc={m.desc}
                onClick={() => setExtractionMode(m.id)}
              />
            ))}
          </div>
        </Field>

        {/* Drill chain block */}
        {showDrillChain && (
          <React.Fragment>
            <Field
              label="Drill chain"
              hint="Mkfd follows item links to detail pages, then extracts from each. Each step can use a CSS selector or a JSON-LD path."
            >
              <InlineDrillChain
                steps={drillSteps}
                onChange={setDrillSteps}
                baseUrlHint={baseUrl}
              />
            </Field>
            <FieldRow cols={3}>
              <Field label="Limit" hint="Max links per refresh.">
                <input
                  className="input"
                  type="number"
                  value={drillLimit}
                  onChange={(e) => setDrillLimit(+e.target.value)}
                />
              </Field>
              <Field label="Concurrency" hint="Parallel detail fetches.">
                <input
                  className="input"
                  type="number"
                  value={drillConcurrency}
                  onChange={(e) => setDrillConcurrency(+e.target.value)}
                />
              </Field>
              <Field label="Per-page timeout (ms)">
                <input
                  className="input"
                  type="number"
                  value={drillTimeoutMs}
                  onChange={(e) => setDrillTimeoutMs(+e.target.value)}
                />
              </Field>
            </FieldRow>
          </React.Fragment>
        )}

        {/* JSON-LD section */}
        {showJsonLd && (
          <React.Fragment>
            <Field
              label="Sampled detail pages"
              hint={"Mkfd fetched " + SAMPLE_DETAIL_PAGES.length + " detail pages and analyzed their JSON-LD."}
            >
              <div className="samples">
                {SAMPLE_DETAIL_PAGES.map((p) => (
                  <div className={"sample" + (p.warn ? " warn" : "")} key={p.url}>
                    <span className="ic"><Icon name={p.warn ? "alert" : "check"} size={9} /></span>
                    <span className="url" title={p.url}>{p.url}</span>
                    <span className="types">
                      {p.types.map((t) => (
                        <span className="typebadge" key={t}>{t}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </Field>

            <Field
              label="Field mapping"
              hint="Map JSON-LD paths from sampled detail pages onto feed fields."
            >
              <JSONLDMappingEditor
                mapping={jsonLdMapping}
                setMapping={setJsonLdMapping}
                includeCssFallback={includeFallback}
              />
            </Field>
          </React.Fragment>
        )}

        {/* CSS selector block — per-field rows */}
        {showCss && extractionMode !== "drillChainJsonLdFallback" && (
          <React.Fragment>
            <Field label="Item iterator" required hint="One selector matching each item card on the page. Every field is extracted relative to this.">
              <SelectorPlayground
                selector={iteratorSelector}
                setSelector={setIteratorSelector}
                label="Iterator"
              />
            </Field>

            <Field
              label="Field selectors"
              hint="Each feed field has its own selector, attribute, and an optional drill chain that follows links to a detail page."
            >
              <div className="field-rows">
                {visibleFieldIds.map((id) => {
                  const def = SCRAPING_FIELDS.find((f) => f.id === id);
                  if (!def) return null;
                  return (
                    <FieldSelectorRow
                      key={id}
                      def={def}
                      value={fieldValues[id]}
                      onChange={(next) => setFieldValue(id, next)}
                      onRemove={() => removeField(id)}
                      baseUrlHint={baseUrl}
                      allFieldValues={fieldValues}
                    />
                  );
                })}
              </div>
              <div className="add-field-bar">
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>Add field:</span>
                {SCRAPING_FIELDS.filter((f) => !visibleFieldIds.includes(f.id)).map((f) => (
                  <button key={f.id} className="btn btn-sm" onClick={() => addField(f.id)}>
                    <Icon name="plus" size={11} /> {f.label}
                  </button>
                ))}
              </div>
            </Field>
          </React.Fragment>
        )}
      </Section>
      )}

      {/* 4.5 Channel (RSS channel-level metadata) */}
      {activeSection === "channel" && (
      <Section
        icon="tag"
        title="Channel metadata"
        sub="RSS channel fields. Type a value or scrape from the page."
      >
        <Field hint="Each row stores a static value OR a CSS selector to scrape from the source. Leave both blank to omit.">
          <div>
            <div className="channel-row" style={{ background: "var(--bg-sunken)", borderRadius: 6, padding: "6px 8px", margin: "-4px -4px 4px", border: "1px solid var(--line)" }}>
              <span className="nm" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--ink-4)", fontWeight: 600 }}>Field</span>
              <span className="nm" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--ink-4)", fontWeight: 600 }}>Static value</span>
              <span className="nm" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--ink-4)", fontWeight: 600 }}>OR — CSS selector</span>
            </div>
            {[
              { id: "title", label: "title" },
              { id: "description", label: "description" },
              { id: "link", label: "link" },
              { id: "language", label: "language" },
              { id: "copyright", label: "copyright" },
              { id: "managingEditor", label: "managingEditor" },
              { id: "webMaster", label: "webMaster" },
              { id: "categories", label: "categories" },
              { id: "ttl", label: "ttl" },
              { id: "skipDays", label: "skipDays" },
              { id: "skipHours", label: "skipHours" },
              { id: "imageUrl", label: "image url" },
            ].map((f) => (
              <div className="channel-row" key={f.id}>
                <span className="nm">{f.label}</span>
                <input
                  className="input mono"
                  placeholder=""
                  value={channel[f.id]}
                  onChange={(e) => setChannelField(f.id, e.target.value)}
                  disabled={!!channel[f.id + "Selector"]}
                />
                <input
                  className="input mono"
                  placeholder="CSS selector"
                  value={channel[f.id + "Selector"]}
                  onChange={(e) => setChannelField(f.id + "Selector", e.target.value)}
                  disabled={!!channel[f.id]}
                />
              </div>
            ))}
          </div>
        </Field>
      </Section>
      )}

      {/* 4.6 Output (sort, strictness, outbound webhook) */}
      {activeSection === "output" && (
      <Section icon="upload" title="Output" sub="How the feed publishes and what side-effects to trigger">
        <div className="toggle-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Reverse item order</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              Stored as <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>reverse: true</code>. Useful when the source lists oldest-first.
            </div>
          </div>
          <button className={"toggle" + (reverse ? " on" : "")} onClick={() => setReverse(!reverse)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Strict mode</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              Stored as <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>strict: true</code>. Skip items missing any required field instead of emitting partial entries.
            </div>
          </div>
          <button className={"toggle" + (strict ? " on" : "")} onClick={() => setStrict(!strict)} />
        </div>

        <div style={{ height: 1, background: "var(--line)", margin: "4px 0 8px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Outbound webhook</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              POST the generated feed (or just new items) to an external URL on every refresh.
            </div>
          </div>
          <button className={"toggle" + (webhook.enabled ? " on" : "")} onClick={() => setWebhookField("enabled", !webhook.enabled)} />
        </div>
        {webhook.enabled && (
          <div className="section" style={{ paddingLeft: 4 }}>
            <FieldRow cols={2}>
              <Field label="URL" required>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input mono"
                    value={webhook.url}
                    onChange={(e) => setWebhookField("url", e.target.value)}
                    placeholder="https://hooks.example.com/feed"
                    style={{ flex: 1 }}
                  />
                  <StorageSelect
                    value={webhook.urlStorage}
                    onChange={(s) => setWebhookField("urlStorage", s)}
                    sensitive
                  />
                </div>
              </Field>
              <Field label="Format">
                <select
                  className="select"
                  value={webhook.format}
                  onChange={(e) => setWebhookField("format", e.target.value)}
                >
                  <option value="xml">RSS XML</option>
                  <option value="json">JSON Feed</option>
                </select>
              </Field>
            </FieldRow>
            <div className="row" style={{ gap: 14, fontSize: 12.5, color: "var(--ink-2)" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <input
                  type="checkbox"
                  checked={webhook.newItemsOnly}
                  onChange={(e) => setWebhookField("newItemsOnly", e.target.checked)}
                />
                New items only (skip on refreshes with no changes)
              </label>
            </div>
            <Field label="Headers" hint="Custom headers for the outbound request.">
              <KVEditor
                rows={webhook.headers}
                onChange={(hs) => setWebhookField("headers", hs)}
                keyPlaceholder="X-Signature"
                valuePlaceholder="value"
                addLabel="Add header"
              />
            </Field>
            <Field label="Custom payload" optional hint="Override the body. Use placeholders like {{item.title}}, {{feed.url}}.">
              <textarea
                className="textarea mono"
                rows={4}
                value={webhook.customPayload}
                onChange={(e) => setWebhookField("customPayload", e.target.value)}
                placeholder="Leave empty to send the full feed."
              />
            </Field>
          </div>
        )}
      </Section>
      )}

      {/* 5. Advanced settings */}
      {activeSection === "advanced" && (
      <Section icon="sliders" title="Advanced" sub="Power-user knobs — leave defaults unless you have a reason">
        <FieldRow cols={2}>
          <Field label="Timeout (ms)" hint="Aborts the request if it takes longer.">
            <input
              className="input"
              type="number"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(+e.target.value)}
            />
          </Field>
          <Field label="Retry count">
            <input
              className="input"
              type="number"
              value={retryCount}
              onChange={(e) => setRetryCount(+e.target.value)}
            />
          </Field>
        </FieldRow>
        <Field label="User-Agent override" optional>
          <input
            className="input mono"
            placeholder="Mozilla/5.0 …"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
          />
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>Advanced browser rendering</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              Use Playwright (Patchright) to render JS before scraping. Stored as <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>advanced: true</code>.
            </div>
          </div>
          <button className={"toggle" + (advanced ? " on" : "")} onClick={() => setAdvanced(!advanced)} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: 13 }}>FlareSolverr fallback</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
              Route blocked requests through a configured FlareSolverr instance.
            </div>
          </div>
          <button className={"toggle" + (flareSolverr ? " on" : "")} onClick={() => setFlareSolverr(!flareSolverr)} />
        </div>
        {flareSolverr && (
          <FieldRow cols={2}>
            <Field label="FlareSolverr server URL" required>
              <input
                className="input mono"
                value={flareServerUrl}
                onChange={(e) => setFlareServerUrl(e.target.value)}
                placeholder="http://flaresolverr:8191"
              />
            </Field>
            <Field label="FlareSolverr timeout (ms)">
              <input
                className="input"
                type="number"
                value={flareTimeout}
                onChange={(e) => setFlareTimeout(+e.target.value)}
              />
            </Field>
          </FieldRow>
        )}
      </Section>
      )}
    </div>
  );
};

WebScrapingBuilder.sections = [
  { id: "basic",    label: "Basic",    icon: "rss" },
  { id: "source",   label: "Source",   icon: "globe" },
  { id: "items",    label: "Items",    icon: "layers" },
  { id: "channel",  label: "Channel",  icon: "tag" },
  { id: "output",   label: "Output",   icon: "upload" },
  { id: "advanced", label: "Advanced", icon: "sliders" },
];

window.WebScrapingBuilder = WebScrapingBuilder;
