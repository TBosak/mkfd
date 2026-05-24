// Lighter builders for the other feed types.
// Each is a single Section with the essential fields from their plans.
// These share state with the preview through window.__builderState.

const BasicMeta = ({ state, set }) => (
  <React.Fragment>
    <FieldRow cols={2}>
      <Field label="Feed name" required>
        <input
          className="input"
          value={state.feedName || ""}
          onChange={(e) => set({ feedName: e.target.value })}
          placeholder="My feed"
        />
      </Field>
      <Field label="Category">
        <input
          className="input"
          value={state.category || ""}
          onChange={(e) => set({ category: e.target.value })}
          placeholder="news"
        />
      </Field>
    </FieldRow>
    <FieldRow cols={2}>
      <Field label="Refresh interval (minutes)">
        <input
          className="input"
          type="number"
          value={state.refreshMinutes ?? 30}
          onChange={(e) => set({ refreshMinutes: +e.target.value })}
        />
      </Field>
      <Field label="Tags">
        <input
          className="input"
          placeholder="comma-separated"
          defaultValue={(state.tags || []).join(", ")}
          onBlur={(e) =>
            set({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })
          }
        />
      </Field>
    </FieldRow>
  </React.Fragment>
);

// ---------- REST API ----------

const RestApiBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "rest",
    feedName: initial?.feedName || "",
    category: initial?.category || "developer",
    refreshMinutes: 30,
    tags: initial?.tags || [],
    baseUrl: initial?.baseUrl || "",
    method: "GET",
    route: "/releases",
    itemsPath: "$",
    titlePath: "name",
    linkPath: "html_url",
    datePath: "published_at",
    descriptionPath: "body",
    guidPath: "id",
    headers: [
      { key: "Accept", value: "application/vnd.github+json", storage: "plain" },
    ],
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>

      <Section icon="code" title="Endpoint" sub="HTTP request to the API">
        <FieldRow cols={2}>
          <Field label="Method">
            <select
              className="select"
              value={state.method}
              onChange={(e) => set({ method: e.target.value })}
            >
              {["GET", "POST", "PUT", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Base URL" required>
            <div className="input-prefix">
              <span className="pfx">https://</span>
              <input
                className="input mono"
                value={state.baseUrl.replace(/^https?:\/\//, "")}
                onChange={(e) => set({ baseUrl: "https://" + e.target.value })}
                placeholder="api.example.com"
              />
            </div>
          </Field>
        </FieldRow>
        <Field label="Route" hint="Path appended to base URL.">
          <input className="input mono" value={state.route} onChange={(e) => set({ route: e.target.value })} />
        </Field>
        <Field label="Headers" hint="Encrypt Authorization or use env vars.">
          <KVEditor rows={state.headers} onChange={(headers) => set({ headers })} />
        </Field>
      </Section>

      <Section icon="layers" title="Item mapping" sub="Map JSON paths onto feed fields">
        <div className="jsonld-map">
          <div className="jsonld-map-row" style={{ background: "var(--bg-sunken)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.06, color: "var(--ink-4)", fontFamily: "var(--font-sans)", fontWeight: 600 }}>
            <div>Feed field</div>
            <div>JSON path</div>
            <div></div>
            <div>Example value</div>
          </div>
          {[
            { id: "items", label: "items", required: true, ex: "[{...}, {...}]" },
            { id: "title", label: "title", required: true, ex: "Release v1.2.0" },
            { id: "link", label: "link", required: true, ex: "https://github.com/…/releases/tag/v1.2.0" },
            { id: "date", label: "pubDate", required: false, ex: "2026-05-22T13:42:00Z" },
            { id: "description", label: "description", required: false, ex: "Fixes a few bugs…" },
            { id: "guid", label: "guid", required: false, ex: "release-123" },
          ].map((f) => (
            <div className="jsonld-map-row" key={f.id}>
              <div className="field-name">
                {f.label}{f.required && <span className="req">*</span>}
              </div>
              <input
                value={state[f.id + "Path"] || ""}
                onChange={(e) => set({ [f.id + "Path"]: e.target.value })}
                placeholder={f.id === "items" ? "$" : "field"}
              />
              <span className="arrow"><Icon name="chev" size={11} /></span>
              <span style={{ color: "var(--ink-4)", fontSize: 11 }}>{f.ex}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};

// ---------- GraphQL ----------

const GraphQLBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "graphql",
    feedName: initial?.feedName || "",
    category: "developer",
    refreshMinutes: 30,
    tags: initial?.tags || [],
    endpoint: initial?.baseUrl || "https://api.github.com/graphql",
    query: `query Releases($owner: String!, $repo: String!) {\n  repository(owner: $owner, name: $repo) {\n    releases(first: 30, orderBy: {field: CREATED_AT, direction: DESC}) {\n      nodes { name url publishedAt description }\n    }\n  }\n}`,
    variables: `{ "owner": "TBosak", "repo": "mkfd" }`,
    itemsPath: "data.repository.releases.nodes",
    headers: [{ key: "Authorization", value: "Bearer …", storage: "protected" }],
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="graphql" title="GraphQL endpoint">
        <Field label="Endpoint" required>
          <input className="input mono" value={state.endpoint} onChange={(e) => set({ endpoint: e.target.value })} />
        </Field>
        <Field label="Headers" hint="Encrypt your token or use an env var.">
          <KVEditor rows={state.headers} onChange={(headers) => set({ headers })} />
        </Field>
      </Section>
      <Section icon="code" title="Query">
        <Field label="Query" required hint="GraphQL query — variables go below.">
          <textarea className="textarea mono" rows={8} value={state.query} onChange={(e) => set({ query: e.target.value })} />
        </Field>
        <Field label="Variables (JSON)">
          <textarea className="textarea mono" rows={3} value={state.variables} onChange={(e) => set({ variables: e.target.value })} />
        </Field>
        <Field label="Items path" required hint="Dot path to the array of items in the response.">
          <input className="input mono" value={state.itemsPath} onChange={(e) => set({ itemsPath: e.target.value })} />
        </Field>
      </Section>
    </div>
  );
};

// ---------- Email ----------

const EmailBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "email",
    feedName: initial?.feedName || "",
    category: "personal",
    refreshMinutes: 30,
    tags: initial?.tags || [],
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    user: "",
    pass: "",
    passStorage: "protected",
    folder: "INBOX",
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="mail" title="IMAP connection">
        <FieldRow cols={2}>
          <Field label="Host" required><input className="input mono" value={state.host} onChange={(e) => set({ host: e.target.value })} /></Field>
          <Field label="Port"><input className="input" type="number" value={state.port} onChange={(e) => set({ port: +e.target.value })} /></Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Username" required><input className="input mono" value={state.user} onChange={(e) => set({ user: e.target.value })} placeholder="you@example.com" /></Field>
          <Field label="Folder"><input className="input mono" value={state.folder} onChange={(e) => set({ folder: e.target.value })} /></Field>
        </FieldRow>
        <Field label="Password" required hint="Stored encrypted by default. Use an app password.">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              className="input mono"
              value={state.pass}
              onChange={(e) => set({ pass: e.target.value })}
              placeholder="app password"
              style={{ flex: 1 }}
            />
            <StorageSelect value={state.passStorage} onChange={(s) => set({ passStorage: s })} sensitive />
          </div>
        </Field>
      </Section>
    </div>
  );
};

// ---------- Calendar ----------

const CalendarBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "calendar",
    feedName: initial?.feedName || "",
    category: "civic",
    refreshMinutes: 60,
    tags: initial?.tags || [],
    url: initial?.baseUrl || "",
    windowDays: 30,
    includePastEvents: false,
    expandRecurringEvents: true,
    maxEvents: 50,
    sortOrder: "startAsc",
    dateStrategy: "start",
    linkStrategy: "eventUrl",
    timezoneFallback: "America/Chicago",
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="calendar" title="Calendar source">
        <Field label="ICS URL" required>
          <input className="input mono" value={state.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/events.ics" />
        </Field>
        <FieldRow cols={3}>
          <Field label="Window (days)"><input className="input" type="number" value={state.windowDays} onChange={(e) => set({ windowDays: +e.target.value })} /></Field>
          <Field label="Max events"><input className="input" type="number" value={state.maxEvents} onChange={(e) => set({ maxEvents: +e.target.value })} /></Field>
          <Field label="Sort">
            <select className="select" value={state.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })}>
              <option value="startAsc">Start ascending</option>
              <option value="startDesc">Start descending</option>
            </select>
          </Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Timezone fallback"><input className="input mono" value={state.timezoneFallback} onChange={(e) => set({ timezoneFallback: e.target.value })} /></Field>
          <Field label="Link strategy">
            <select className="select" value={state.linkStrategy} onChange={(e) => set({ linkStrategy: e.target.value })}>
              <option value="eventUrl">Event URL</option>
              <option value="dataUri">Embedded VEVENT</option>
            </select>
          </Field>
        </FieldRow>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.includePastEvents} onChange={(e) => set({ includePastEvents: e.target.checked })} />
            Include past events
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.expandRecurringEvents} onChange={(e) => set({ expandRecurringEvents: e.target.checked })} />
            Expand recurring events into individual occurrences
          </label>
        </div>
      </Section>
    </div>
  );
};

// ---------- Sitemap ----------

const SitemapBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "sitemap",
    feedName: initial?.feedName || "",
    category: "monitoring",
    refreshMinutes: 60,
    tags: initial?.tags || [],
    url: initial?.baseUrl || "",
    mode: "urlList",
    maxItems: 50,
    maxUrlsToScan: 500,
    sortOrder: "lastmodDesc",
    titleStrategy: "path",
    includePatterns: [],
    excludePatterns: [],
    pageMetadata: false,
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="map" title="Sitemap source">
        <Field label="Sitemap URL" required>
          <input className="input mono" value={state.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/sitemap.xml" />
        </Field>
        <FieldRow cols={3}>
          <Field label="Mode">
            <select className="select" value={state.mode} onChange={(e) => set({ mode: e.target.value })}>
              <option value="urlList">URL list</option>
              <option value="pageMetadata">Page metadata</option>
              <option value="jsonLd">JSON-LD</option>
              <option value="jsonLdWithFallback">JSON-LD + CSS fallback</option>
            </select>
          </Field>
          <Field label="Max items"><input className="input" type="number" value={state.maxItems} onChange={(e) => set({ maxItems: +e.target.value })} /></Field>
          <Field label="Max URLs to scan"><input className="input" type="number" value={state.maxUrlsToScan} onChange={(e) => set({ maxUrlsToScan: +e.target.value })} /></Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Include patterns" hint="Regex per line. Matches loc URL.">
            <textarea className="textarea mono" rows={3} placeholder="/news|/notices|/agendas" />
          </Field>
          <Field label="Exclude patterns" hint="Regex per line.">
            <textarea className="textarea mono" rows={3} placeholder="/tag/|/author/" />
          </Field>
        </FieldRow>
      </Section>
    </div>
  );
};

// ---------- Filesystem ----------

const FilesystemBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "filesystem",
    feedName: initial?.feedName || "",
    category: "civic",
    refreshMinutes: 15,
    tags: initial?.tags || [],
    rootPath: "/app/watch/agendas",
    publicBaseUrl: "/files/agendas",
    recursive: true,
    maxItems: 50,
    sortOrder: "modifiedDesc",
    include: "*.pdf, *.md, *.html",
    exclude: "*.tmp, .DS_Store",
    dateStrategy: "modifiedTime",
    titleStrategy: "filename",
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="folder" title="Filesystem source">
        <FieldRow cols={2}>
          <Field label="Root path" required hint="Mounted directory inside the container.">
            <input className="input mono" value={state.rootPath} onChange={(e) => set({ rootPath: e.target.value })} />
          </Field>
          <Field label="Public base URL" hint="URL prefix Mkfd serves files under.">
            <input className="input mono" value={state.publicBaseUrl} onChange={(e) => set({ publicBaseUrl: e.target.value })} />
          </Field>
        </FieldRow>
        <FieldRow cols={2}>
          <Field label="Include globs" hint="Comma-separated."><input className="input mono" value={state.include} onChange={(e) => set({ include: e.target.value })} /></Field>
          <Field label="Exclude globs" hint="Comma-separated."><input className="input mono" value={state.exclude} onChange={(e) => set({ exclude: e.target.value })} /></Field>
        </FieldRow>
        <FieldRow cols={3}>
          <Field label="Sort order">
            <select className="select" value={state.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })}>
              <option value="modifiedDesc">Modified (newest first)</option>
              <option value="modifiedAsc">Modified (oldest first)</option>
              <option value="nameAsc">Name A→Z</option>
            </select>
          </Field>
          <Field label="Max items"><input className="input" type="number" value={state.maxItems} onChange={(e) => set({ maxItems: +e.target.value })} /></Field>
          <Field label="Recursive">
            <select className="select" value={state.recursive ? "yes" : "no"} onChange={(e) => set({ recursive: e.target.value === "yes" })}>
              <option value="yes">Recursive</option>
              <option value="no">Top level only</option>
            </select>
          </Field>
        </FieldRow>
      </Section>
    </div>
  );
};

// ---------- Webhook ----------

const WebhookBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "webhook",
    feedName: initial?.feedName || "",
    category: "automation",
    refreshMinutes: 0,
    tags: initial?.tags || [],
    slug: "deployments",
    maxItems: 100,
    retentionDays: 90,
    duplicateStrategy: "idOrHash",
    dateStrategy: "payloadDateOrReceivedAt",
    storeRawPayload: false,
    mapping: { title: "title", description: "description", link: "url", date: "date" },
    tokenStorage: "protected",
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  const fullUrl = "https://your-mkfd.example.com/webhook-feeds/" + state.slug;

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="webhook" title="Inbound endpoint" sub="Push events to this URL to populate the feed.">
        <Field label="Slug" required hint="URL-safe identifier.">
          <input className="input mono" value={state.slug} onChange={(e) => set({ slug: e.target.value })} />
        </Field>
        <Field label="Inbound URL">
          <div className="input-prefix">
            <input className="input mono" value={fullUrl} readOnly />
            <button className="btn" style={{ borderLeft: "1px solid var(--line)", borderRadius: 0 }} onClick={() => navigator.clipboard?.writeText(fullUrl)}>
              <Icon name="copy" size={12} /> Copy
            </button>
          </div>
        </Field>
        <Field label="Token" required hint="Generated on save. Required by the worker. Encrypted by default.">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input mono" value="********-d24fe2b3e8" readOnly style={{ flex: 1 }} />
            <button className="btn btn-sm"><Icon name="refresh" size={11} /> Rotate</button>
            <StorageSelect value={state.tokenStorage} onChange={(s) => set({ tokenStorage: s })} sensitive />
          </div>
        </Field>
        <FieldRow cols={3}>
          <Field label="Max items"><input className="input" type="number" value={state.maxItems} onChange={(e) => set({ maxItems: +e.target.value })} /></Field>
          <Field label="Retention (days)"><input className="input" type="number" value={state.retentionDays} onChange={(e) => set({ retentionDays: +e.target.value })} /></Field>
          <Field label="Duplicate strategy">
            <select className="select" value={state.duplicateStrategy} onChange={(e) => set({ duplicateStrategy: e.target.value })}>
              <option value="idOrHash">ID or hash</option>
              <option value="alwaysAccept">Always accept</option>
            </select>
          </Field>
        </FieldRow>
      </Section>
    </div>
  );
};

// ---------- Existing Feed Transformer ----------

const FeedTransformerBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "feedTransformer",
    feedName: initial?.feedName || "",
    category: "news",
    refreshMinutes: 15,
    tags: initial?.tags || [],
    sourceUrl: initial?.baseUrl || "",
    sourceFormat: "auto",
    maxItems: 50,
    stripHtmlTitle: true,
    stripHtmlDescription: true,
    truncateChars: 800,
    removeTracking: true,
    forceHttps: false,
    excludes: "sponsored\nadvertisement",
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="rss" title="Source feed">
        <Field label="Source URL" required hint="RSS, Atom, or JSON Feed URL.">
          <input className="input mono" value={state.sourceUrl} onChange={(e) => set({ sourceUrl: e.target.value })} />
        </Field>
        <FieldRow cols={3}>
          <Field label="Format">
            <select className="select" value={state.sourceFormat} onChange={(e) => set({ sourceFormat: e.target.value })}>
              <option value="auto">Auto-detect</option>
              <option value="rss">RSS 2.0</option>
              <option value="atom">Atom</option>
              <option value="jsonFeed">JSON Feed</option>
            </select>
          </Field>
          <Field label="Max items"><input className="input" type="number" value={state.maxItems} onChange={(e) => set({ maxItems: +e.target.value })} /></Field>
          <Field label="Truncate description"><input className="input" type="number" value={state.truncateChars} onChange={(e) => set({ truncateChars: +e.target.value })} /></Field>
        </FieldRow>
      </Section>
      <Section icon="sliders" title="Cleanup rules" sub="Applied to each item before republish.">
        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.stripHtmlTitle} onChange={(e) => set({ stripHtmlTitle: e.target.checked })} />
            Strip HTML from titles
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.stripHtmlDescription} onChange={(e) => set({ stripHtmlDescription: e.target.checked })} />
            Strip HTML from descriptions
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.removeTracking} onChange={(e) => set({ removeTracking: e.target.checked })} />
            Remove tracking query params (utm_*, fbclid, gclid…)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <input type="checkbox" checked={state.forceHttps} onChange={(e) => set({ forceHttps: e.target.checked })} />
            Force https:// on links
          </label>
        </div>
        <Field label="Exclude items whose title or category contains" hint="One pattern per line.">
          <textarea className="textarea mono" rows={3} value={state.excludes} onChange={(e) => set({ excludes: e.target.value })} />
        </Field>
      </Section>
    </div>
  );
};

// ---------- Service Connector ----------

const SERVICES = [
  { id: "jellyfin", label: "Jellyfin", desc: "Latest movies, episodes, music." },
  { id: "sonarr", label: "Sonarr", desc: "Episode releases and queue events." },
  { id: "radarr", label: "Radarr", desc: "Movie releases and queue events." },
  { id: "linkding", label: "Linkding", desc: "Recent bookmarks." },
  { id: "miniflux", label: "Miniflux", desc: "Starred or recent entries." },
];

const ServiceConnectorBuilder = ({ initial }) => {
  const [state, setStateRaw] = useState({
    feedType: "serviceConnector",
    feedName: initial?.feedName || "",
    category: "media",
    refreshMinutes: 30,
    tags: initial?.tags || [],
    service: "jellyfin",
    baseUrl: "http://jellyfin:8096",
    apiKey: "",
    apiKeyStorage: "protected",
    resource: "movies",
    preset: "latestItems",
    maxItems: 50,
  });
  const set = (patch) => setStateRaw((s) => ({ ...s, ...patch }));
  useEffect(() => { window.__builderState = state; window.dispatchEvent(new CustomEvent("builder-state")); }, [state]);

  return (
    <div className="section">
      <Section icon="rss" title="Basic"><BasicMeta state={state} set={set} /></Section>
      <Section icon="sparkles" title="Service" sub="Pick a self-hosted service to connect.">
        <Field>
          <div className="modes" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
            {SERVICES.map((s) => (
              <ModeCard
                key={s.id}
                active={state.service === s.id}
                label={s.label}
                desc={s.desc}
                onClick={() => set({ service: s.id })}
              />
            ))}
          </div>
        </Field>
      </Section>
      <Section icon="lock" title="Connection">
        <FieldRow cols={2}>
          <Field label="Base URL" required><input className="input mono" value={state.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} /></Field>
          <Field label="Preset">
            <select className="select" value={state.preset} onChange={(e) => set({ preset: e.target.value })}>
              <option value="latestItems">Latest items</option>
              <option value="recentlyAdded">Recently added</option>
              <option value="continueWatching">Continue watching</option>
            </select>
          </Field>
        </FieldRow>
        <Field label="API key" required hint="Required for all service connectors. Encrypted by default.">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              className="input mono"
              value={state.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              style={{ flex: 1 }}
            />
            <StorageSelect value={state.apiKeyStorage} onChange={(s) => set({ apiKeyStorage: s })} sensitive />
          </div>
        </Field>
        <FieldRow cols={2}>
          <Field label="Resource">
            <select className="select" value={state.resource} onChange={(e) => set({ resource: e.target.value })}>
              <option value="movies">Movies library</option>
              <option value="shows">Shows library</option>
              <option value="music">Music library</option>
            </select>
          </Field>
          <Field label="Max items"><input className="input" type="number" value={state.maxItems} onChange={(e) => set({ maxItems: +e.target.value })} /></Field>
        </FieldRow>
      </Section>
    </div>
  );
};

// ---------- Type-to-component map ----------

window.BUILDERS = {
  scrape: window.WebScrapingBuilder,
  rest: RestApiBuilder,
  graphql: GraphQLBuilder,
  email: EmailBuilder,
  calendar: CalendarBuilder,
  sitemap: SitemapBuilder,
  filesystem: FilesystemBuilder,
  webhook: WebhookBuilder,
  feedTransformer: FeedTransformerBuilder,
  serviceConnector: ServiceConnectorBuilder,
};
