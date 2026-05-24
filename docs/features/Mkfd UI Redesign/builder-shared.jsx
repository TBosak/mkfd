// Shared builder primitives: layout, sections, fields, key-value editor, protected-value cell, type cards.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ---------- Feed type catalog (richer than the My Feeds list — adds Existing/Connector) ----------

const FEED_TYPES_FULL = [
  { id: "scrape",      label: "Web Scraping",     icon: "globe",    desc: "Turn any webpage into a feed" },
  { id: "rest",        label: "REST API",         icon: "code",     desc: "Map JSON endpoints to feed items" },
  { id: "graphql",     label: "GraphQL",          icon: "graphql",  desc: "Query a GraphQL endpoint" },
  { id: "email",       label: "Email",            icon: "mail",     desc: "Watch an IMAP folder" },
  { id: "calendar",    label: "Calendar",         icon: "calendar", desc: "Subscribe to an ICS feed" },
  { id: "sitemap",     label: "Sitemap",          icon: "map",      desc: "Track URLs from sitemap.xml" },
  { id: "filesystem",  label: "Filesystem",       icon: "folder",   desc: "Watch a local directory" },
  { id: "webhook",     label: "Webhook",          icon: "webhook",  desc: "Receive events via inbound URL" },
  { id: "feedTransformer", label: "Existing feed", icon: "rss",     desc: "Clean & republish an RSS/Atom" },
  { id: "serviceConnector", label: "Connector",   icon: "sparkles", desc: "Jellyfin, Sonarr, etc." },
];

// ---------- Section card ----------

const Section = ({ icon, title, sub, right, children, defaultOpen = true, collapsible = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card">
      <div
        className="card-head"
        onClick={collapsible ? () => setOpen((o) => !o) : undefined}
        style={collapsible ? { cursor: "pointer" } : {}}
      >
        {icon && <span className="ic"><Icon name={icon} size={14} /></span>}
        <div>
          <h3>{title}</h3>
          {sub && <div className="sub">{sub}</div>}
        </div>
        <div className="right">
          {right}
          {collapsible && (
            <Icon name="chev" size={14} style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.16s", color: "var(--ink-3)" }} />
          )}
        </div>
      </div>
      {(!collapsible || open) && <div className="card-body">{children}</div>}
    </div>
  );
};

// ---------- Basic field wrappers ----------

const Field = ({ label, hint, required, optional, children, span }) => (
  <div className="field" style={span ? { gridColumn: "1 / -1" } : undefined}>
    {label && (
      <label className="field-label">
        {label}
        {required && <span className="req">*</span>}
        {optional && <span className="opt">Optional</span>}
      </label>
    )}
    {children}
    {hint && <div className="field-hint">{hint}</div>}
  </div>
);

const FieldRow = ({ cols = 2, children }) => (
  <div className={"field-row" + (cols === 3 ? " thirds" : "")}>{children}</div>
);

// ---------- Storage select (Plain / Encrypted / Env) ----------

const STORAGE_OPTS = [
  { id: "plain",     label: "Plain",  short: "Plain"  },
  { id: "protected", label: "Encrypt", short: "ENC"   },
  { id: "env",       label: "Env var", short: "ENV"   },
];

const StorageSelect = ({ value, onChange, sensitive }) => {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const cur = STORAGE_OPTS.find((o) => o.id === value) || STORAGE_OPTS[0];
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className={"stor-select " + value}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={
          value === "protected"
            ? "Encrypted in YAML"
            : value === "env"
            ? "Environment variable reference"
            : sensitive
            ? "This value looks sensitive — consider encrypting"
            : "Plain text in YAML"
        }
      >
        {value === "protected" && <Icon name="lock" size={10} />}
        {value === "env" && <Icon name="key" size={10} />}
        {cur.short}
        <Icon name="chevd" size={10} />
      </button>
      {open && (
        <div className="menu" style={{ minWidth: 180 }}>
          {STORAGE_OPTS.map((o) => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={value === o.id ? { background: "var(--bg-sunken)", fontWeight: 500 } : {}}
            >
              {o.id === "protected" && <Icon name="lock" size={12} />}
              {o.id === "env" && <Icon name="key" size={12} />}
              {o.id === "plain" && <Icon name="edit" size={12} />}
              {o.label}
              {value === o.id && <Icon name="check" size={12} style={{ marginLeft: "auto", color: "var(--ok)" }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------- Protected key-value editor (headers, cookies, form fields) ----------

const SENSITIVE_KEYS = [
  "authorization", "cookie", "x-api-key", "api-key", "apikey",
  "token", "secret", "password", "session", "csrf", "bearer",
];
const looksSensitive = (k) => {
  const s = (k || "").toLowerCase();
  return SENSITIVE_KEYS.some((p) => s.includes(p));
};

const KVEditor = ({ rows, onChange, keyPlaceholder = "Header name", valuePlaceholder = "Value", showStorage = true, addLabel = "Add header" }) => {
  const setRow = (i, patch) => onChange(rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, ix) => ix !== i));
  const add = () => onChange([...rows, { key: "", value: "", storage: "plain" }]);
  return (
    <div>
      <div className="kv-edit">
        <div className="kv-edit-row head">
          <div>Name</div>
          <div>Value</div>
          {showStorage && <div>Storage</div>}
          <div></div>
        </div>
        {rows.map((row, i) => {
          const sensitive = looksSensitive(row.key);
          return (
            <div className="kv-edit-row" key={i}>
              <div className="cell">
                <input
                  className="input"
                  placeholder={keyPlaceholder}
                  value={row.key}
                  onChange={(e) => setRow(i, { key: e.target.value })}
                />
              </div>
              <div className="cell">
                <input
                  className="input"
                  placeholder={row.storage === "env" ? "ENV_VAR_NAME" : row.storage === "protected" && row.encrypted ? "********" : valuePlaceholder}
                  value={row.value}
                  type={row.storage === "protected" && !row.editing ? "password" : "text"}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                />
              </div>
              {showStorage && (
                <div className="cell storage">
                  <StorageSelect
                    value={row.storage}
                    onChange={(s) => setRow(i, { storage: s })}
                    sensitive={sensitive}
                  />
                </div>
              )}
              <div className="cell" style={{ justifyContent: "center" }}>
                <button className="del" onClick={() => remove(i)} title="Remove">
                  <Icon name="x" size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="kv-edit-row" style={{ gridTemplateColumns: "1fr" }}>
            <div style={{ padding: "12px 14px", color: "var(--ink-4)", fontSize: 12.5, textAlign: "center" }}>
              None yet.
            </div>
          </div>
        )}
      </div>
      <div className="kv-edit-add">
        <button className="btn btn-sm" onClick={add}>
          <Icon name="plus" size={12} /> {addLabel}
        </button>
        {rows.some((r) => looksSensitive(r.key) && r.storage === "plain") && (
          <span style={{ fontSize: 11.5, color: "var(--warn-ink)", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="alert" size={12} />
            Some values look sensitive but are stored plain.
          </span>
        )}
      </div>
    </div>
  );
};

// ---------- Mode card (radio cards for extraction mode, request mode etc) ----------

const ModeCard = ({ active, recommended, icon, label, desc, onClick }) => (
  <button type="button" className={"mode-card" + (active ? " active" : "")} onClick={onClick}>
    {recommended && <span className="reco">Recommended</span>}
    <div className="row">
      {icon && <Icon name={icon} size={14} />}
      <strong>{label}</strong>
    </div>
    {desc && <div className="desc">{desc}</div>}
  </button>
);

// ---------- Type icon with bg ----------

const TypeBg = ({ type, size = 28 }) => {
  const meta = FEED_TYPES_FULL.find((t) => t.id === type) || FEED_TYPES_FULL[0];
  return (
    <span className={"tt " + type} style={{ width: size, height: size, borderRadius: Math.round(size * 0.25) }}>
      <Icon name={meta.icon} size={Math.round(size * 0.55)} />
    </span>
  );
};

// ---------- Section navigator ----------

const SectionNav = ({ sections, active, onChange, collapsed, onToggleCollapsed }) => {
  return (
    <nav className={"section-nav" + (collapsed ? " collapsed" : "")} aria-label="Section navigator">
      <div className="section-nav-head">
        <span className="lbl">Sections</span>
        <button
          className="collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name="chev" size={12} style={{ transform: collapsed ? "" : "rotate(180deg)" }} />
        </button>
      </div>
      {sections.map((s, ix) => (
        <button
          key={s.id}
          className={"section-nav-item" + (active === s.id ? " active" : "")}
          onClick={() => onChange(s.id)}
          title={s.label}
        >
          <Icon name={s.icon || "chev"} size={14} />
          <span className="label">{s.label}</span>
          {typeof s.count === "number" && s.count > 0 && (
            <span className="ct">{s.count}</span>
          )}
        </button>
      ))}
    </nav>
  );
};

// Section header rendered at the top of each section body
const SectionHeader = ({ title, sub, ix, total, onPrev, onNext }) => (
  <div className="section-title-bar">
    <div>
      <h2>{title}</h2>
      {sub && <div className="sub">{sub}</div>}
    </div>
    {typeof ix === "number" && <span className="pageix">{ix + 1} / {total}</span>}
  </div>
);

const SectionPager = ({ sections, active, onChange }) => {
  const ix = sections.findIndex((s) => s.id === active);
  if (ix < 0) return null;
  const prev = sections[ix - 1];
  const next = sections[ix + 1];
  return (
    <div className="section-pager">
      {prev ? (
        <button className="btn" onClick={() => onChange(prev.id)}>
          <Icon name="chev" size={12} style={{ transform: "rotate(180deg)" }} />
          {prev.label}
        </button>
      ) : <span />}
      <span className="grow" />
      {next ? (
        <button className="btn btn-primary" onClick={() => onChange(next.id)}>
          {next.label}
          <Icon name="chev" size={12} />
        </button>
      ) : <span />}
    </div>
  );
};

// ---------- exports ----------
Object.assign(window, {
  FEED_TYPES_FULL,
  Section, Field, FieldRow,
  StorageSelect, KVEditor, ModeCard, TypeBg,
  SectionNav, SectionHeader, SectionPager,
  looksSensitive,
});
