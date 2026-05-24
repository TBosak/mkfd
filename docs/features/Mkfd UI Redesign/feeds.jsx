// My Feeds page — Active Feeds redesign.

const QUICK_FILTERS = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favorites", icon: "star" },
  { id: "warnings", label: "Needs attention", icon: "alert" },
  { id: "broken", label: "Failing", icon: "x" },
  { id: "disabled", label: "Disabled", icon: "pause" },
  { id: "secrets", label: "Has secrets", icon: "lock" },
  { id: "community", label: "From catalog", icon: "cloud" },
];

const FORMATS = [
  { id: "rss",  label: "RSS",  ext: ".rss",  full: "RSS 2.0" },
  { id: "atom", label: "Atom", ext: ".atom", full: "Atom" },
  { id: "json", label: "JSON", ext: ".json", full: "JSON Feed" },
];

const formatUrl = (feed, fmtId) => {
  const ext = (FORMATS.find((f) => f.id === fmtId) || FORMATS[0]).ext;
  return feed.publicFeedUrl + ext;
};

const TYPE_CHIPS = [
  "scrape",
  "rest",
  "graphql",
  "email",
  "calendar",
  "sitemap",
  "filesystem",
  "webhook",
];

const matchesQuick = (feed, q) => {
  switch (q) {
    case "all":       return true;
    case "favorites": return !!feed.favorite;
    case "warnings":  return feed.status === "warning";
    case "broken":    return feed.status === "error";
    case "disabled":  return !feed.enabled || feed.status === "disabled";
    case "secrets":   return feed.secrets.protected || feed.secrets.env || feed.secrets.plain;
    case "community": return feed.origin?.type === "community";
    default:          return true;
  }
};

const matchesSearch = (feed, raw) => {
  if (!raw) return true;
  const q = raw.trim().toLowerCase();
  const hay = [
    feed.title,
    feed.description,
    feed.type,
    feed.category,
    feed.sourceUrl,
    feed.publicFeedUrl,
    feed.filename,
    feed.origin?.catalogId,
    ...feed.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
};

// ---------- Scrollable filter row (horizontal w/ arrow controls) ----------

const ScrollableRow = ({ label, children }) => {
  const ref = React.useRef(null);
  const [canL, setCanL] = React.useState(false);
  const [canR, setCanR] = React.useState(false);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanL(el.scrollLeft > 4);
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    // also remeasure once children settle
    const t = setTimeout(update, 50);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      clearTimeout(t);
    };
  }, [update, children]);

  const scroll = (dir) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className="filter-row-wrap">
      <span className="label">{label}</span>
      <div className={"filter-row-scroller" + (canL ? " canl" : "") + (canR ? " canr" : "")}>
        <button
          className={"filter-row-arrow l" + (canL ? " show" : "")}
          onClick={() => scroll(-1)}
          aria-label="Scroll left"
          tabIndex={canL ? 0 : -1}
        >
          <Icon name="chev" size={13} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div className="filter-row" ref={ref}>
          {children}
        </div>
        <button
          className={"filter-row-arrow r" + (canR ? " show" : "")}
          onClick={() => scroll(1)}
          aria-label="Scroll right"
          tabIndex={canR ? 0 : -1}
        >
          <Icon name="chev" size={13} />
        </button>
      </div>
    </div>
  );
};

// ---------- Tag editor ----------

const TagEditor = ({ tags, onChange }) => {
  const [editing, setEditing] = React.useState(false);
  const [val, setVal] = React.useState("");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const t = val.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setVal("");
    setEditing(false);
  };
  const remove = (t) => onChange(tags.filter((x) => x !== t));

  return (
    <div className="feedcard-tags">
      {tags.map((t) => (
        <span className="tag" key={t}>
          {t}
          <span
            className="x"
            onClick={(e) => { e.stopPropagation(); remove(t); }}
            title="Remove tag"
          >
            <Icon name="x" size={10} />
          </span>
        </span>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          className="tag-input"
          value={val}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") { setVal(""); setEditing(false); }
          }}
          onBlur={commit}
          placeholder="tag"
        />
      ) : (
        <button
          className="tag-add"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          title="Add tag"
        >
          <Icon name="plus" size={11} />
        </button>
      )}
    </div>
  );
};

// ---------- Action menu ----------

const ActionMenu = ({ feed, onAction }) => {
  const [open, setOpen] = React.useState(false);
  const ref = useClickOutside(() => setOpen(false));
  const item = (id, icon, label, opts = {}) => (
    <button
      className={opts.danger ? "danger" : ""}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        onAction(id);
      }}
    >
      <Icon name={icon} />
      {label}
      {opts.kbd && <span className="kbd">{opts.kbd}</span>}
    </button>
  );
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className="btn btn-ghost btn-icon btn-sm"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title="More actions"
      >
        <Icon name="dot3" />
      </button>
      {open && (
        <div className="menu" onClick={(e) => e.stopPropagation()}>
          {item("open", "open", "Open RSS")}
          {item("copy", "copy", "Copy feed URL", { kbd: "C" })}
          {item("preview", "eye", "Preview")}
          <hr />
          {item("edit", "edit", "Edit config", { kbd: "E" })}
          {item("duplicate", "duplicate", "Duplicate")}
          {item("export", "download", "Export YAML")}
          <hr />
          {item(
            feed.enabled ? "disable" : "enable",
            feed.enabled ? "pause" : "play",
            feed.enabled ? "Disable feed" : "Enable feed"
          )}
          {item("delete", "trash", "Delete", { danger: true })}
        </div>
      )}
    </div>
  );
};

// ---------- Feed card ----------

const FeedCard = ({ feed, format, setFormat, onUpdate, onAction, onOpenDetail }) => {
  const meta = FEED_TYPE_META[feed.type];
  const hasSecret =
    feed.secrets.protected || feed.secrets.env || feed.secrets.plain;
  return (
    <div
      className={"feedcard" + (feed.enabled ? "" : " disabled")}
      onClick={() => onOpenDetail(feed.id)}
    >
      <div className="feedcard-head">
        <TypeIcon type={feed.type} />
        <div className="feedcard-title">
          <h3>
            {feed.title}
            {feed.origin?.type === "community" && (
              <Badge tone="ghost" title="Installed from community catalog">
                <Icon name="cloud" size={10} /> catalog
              </Badge>
            )}
          </h3>
          <div className="typeline">
            <span>{meta.label}</span>
            <span className="sep" />
            <span className="cat">{feed.category || "uncategorized"}</span>
          </div>
        </div>
        <button
          className={"feedcard-star" + (feed.favorite ? " on" : "")}
          onClick={(e) => {
            e.stopPropagation();
            onUpdate(feed.id, { favorite: !feed.favorite });
          }}
          title={feed.favorite ? "Unstar" : "Star"}
        >
          <Icon name="star" />
        </button>
      </div>

      <div className="feedcard-body">
        <div className="feedcard-source" title={feed.sourceUrl}>
          {feed.sourceMethod && <span className="meth">{feed.sourceMethod}</span>}
          <span className="url">{feed.sourceUrl}</span>
        </div>

        <div className="feedcard-meta">
          <div>
            <div className="k">Status</div>
            <div className="v">
              <StatusBadge status={feed.enabled ? feed.status : "disabled"} />
            </div>
          </div>
          <div>
            <div className="k">Last run</div>
            <div className={"v " + (feed.status === "error" ? "err" : feed.status === "neverRun" ? "muted" : "")}>
              {feed.lastRunRelative || "—"}
            </div>
          </div>
          <div>
            <div className="k">Refresh</div>
            <div className="v">
              {feed.refreshMinutes
                ? feed.refreshMinutes < 60
                  ? feed.refreshMinutes + " min"
                  : (feed.refreshMinutes / 60) + " h"
                : feed.type === "webhook"
                ? "on push"
                : "—"}
            </div>
          </div>
          <div>
            <div className="k">Items</div>
            <div className={"v " + (feed.lastItemCount == null ? "muted" : "")}>
              {feed.lastItemCount == null ? "—" : feed.lastItemCount}
              {feed.lastNewItemCount > 0 && (
                <span style={{ color: "var(--ok)" }}>
                  +{feed.lastNewItemCount}
                </span>
              )}
            </div>
          </div>
        </div>

        <TagEditor
          tags={feed.tags}
          onChange={(tags) => onUpdate(feed.id, { tags })}
        />

        {hasSecret && (
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {feed.secrets.protected && (
              <Badge tone="info">
                <Icon name="lock" size={10} /> encrypted
              </Badge>
            )}
            {feed.secrets.env && (
              <Badge tone="ghost">
                <Icon name="key" size={10} /> env var
              </Badge>
            )}
            {feed.secrets.plain && (
              <Badge tone="err">
                <Icon name="alert" size={10} /> plain secret
              </Badge>
            )}
          </div>
        )}
      </div>

      <div className="feedcard-foot">
        <div className="fmt-seg" onClick={(e) => e.stopPropagation()} title="Choose output format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              className={format === f.id ? "active" : ""}
              onClick={() => setFormat(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button
          className="btn btn-sm"
          onClick={(e) => { e.stopPropagation(); onAction(feed.id, "copy", format); }}
          title={"Copy " + formatUrl(feed, format)}
        >
          <Icon name="copy" /> Copy
        </button>
        <button
          className="btn btn-sm"
          onClick={(e) => { e.stopPropagation(); onAction(feed.id, "open", format); }}
          title={"Open " + formatUrl(feed, format)}
        >
          <Icon name="open" />
        </button>
        <ActionMenu feed={feed} onAction={(id) => onAction(feed.id, id, format)} />
      </div>
    </div>
  );
};

// ---------- Table view ----------

const FeedTable = ({ feeds, onUpdate, onAction, onOpenDetail }) => {
  return (
    <div className="tbl">
      <div className="tbl-row head">
        <span></span>
        <span>Name / Source</span>
        <span>Type</span>
        <span>Status</span>
        <span>Tags</span>
        <span>Last run</span>
        <span>Items</span>
        <span></span>
      </div>
      {feeds.map((f) => (
        <div
          key={f.id}
          className="tbl-row"
          onClick={() => onOpenDetail(f.id)}
        >
          <button
            className={"feedcard-star" + (f.favorite ? " on" : "")}
            onClick={(e) => {
              e.stopPropagation();
              onUpdate(f.id, { favorite: !f.favorite });
            }}
            style={{ padding: 0 }}
          >
            <Icon name="star" size={14} />
          </button>
          <div className="tbl-name">
            <span className={"tt " + f.type}>
              <Icon name={FEED_TYPE_META[f.type].icon} size={13} />
            </span>
            <div className="nm">
              <strong>{f.title}</strong>
              <span className="src">{f.sourceUrl}</span>
            </div>
          </div>
          <span className="tbl-cell">{FEED_TYPE_META[f.type].label}</span>
          <span>
            <StatusBadge status={f.enabled ? f.status : "disabled"} />
          </span>
          <div className="tbl-tags">
            {f.tags.slice(0, 3).map((t) => (
              <span className="tag" key={t}>
                {t}
              </span>
            ))}
            {f.tags.length > 3 && (
              <span className="tag" style={{ background: "transparent" }}>
                +{f.tags.length - 3}
              </span>
            )}
          </div>
          <span
            className={
              "tbl-cell " +
              (f.status === "error" ? "err" : f.status === "neverRun" ? "muted" : "")
            }
          >
            {f.lastRunRelative || "—"}
          </span>
          <span className={"tbl-cell " + (f.lastItemCount == null ? "muted" : "")}>
            {f.lastItemCount ?? "—"}
            {f.lastNewItemCount > 0 && (
              <span style={{ color: "var(--ok)" }}> +{f.lastNewItemCount}</span>
            )}
          </span>
          <ActionMenu feed={f} onAction={(id) => onAction(f.id, id)} />
        </div>
      ))}
    </div>
  );
};

// ---------- Detail drawer ----------

const FeedDetailDrawer = ({ feed, onClose, onUpdate, onAction }) => {
  if (!feed) return null;
  const meta = FEED_TYPE_META[feed.type];
  const copy = (text) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };
  return (
    <React.Fragment>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog">
        <header className="drawer-head">
          <TypeIcon type={feed.type} size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{feed.title}</h2>
            <div className="meta">
              <span>{meta.label}</span>
              <span>·</span>
              <span style={{ textTransform: "capitalize" }}>
                {feed.category}
              </span>
              <span>·</span>
              <code style={{ fontSize: 11 }}>{feed.filename}</code>
            </div>
          </div>
          <StatusBadge status={feed.enabled ? feed.status : "disabled"} />
          <button className="close" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="drawer-body">
          {feed.statusDetail && (
            <div
              className="badge"
              style={{
                background:
                  feed.status === "error"
                    ? "var(--err-soft)"
                    : "var(--warn-soft)",
                color:
                  feed.status === "error"
                    ? "var(--err-ink)"
                    : "var(--warn-ink)",
                border: "none",
                height: "auto",
                padding: "8px 12px",
                fontFamily: "var(--font-sans)",
                fontSize: 12.5,
                lineHeight: 1.45,
                alignItems: "flex-start",
                whiteSpace: "normal",
                textAlign: "left",
              }}
            >
              <Icon name="alert" size={14} />
              {feed.statusDetail}
            </div>
          )}

          <section className="drawer-section">
            <h4>Description</h4>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--ink-2)",
                lineHeight: 1.55,
              }}
            >
              {feed.description}
            </p>
          </section>

          <section className="drawer-section">
            <h4>Endpoints</h4>
            <div className="kv">
              <div className="kv-row">
                <span className="k">Source</span>
                <span className="v">
                  {feed.sourceMethod ? feed.sourceMethod + " " : ""}
                  {feed.sourceUrl}
                  <span
                    className="copy"
                    onClick={() => { copy(feed.sourceUrl); onAction(feed.id, "copy-source"); }}
                  >
                    <Icon name="copy" size={11} />
                  </span>
                </span>
              </div>
              {FORMATS.map((fmt) => (
                <div className="kv-row" key={fmt.id}>
                  <span className="k">{fmt.full}</span>
                  <span className="v">
                    {formatUrl(feed, fmt.id)}
                    <span
                      className="copy"
                      onClick={() => onAction(feed.id, "copy", fmt.id)}
                      title={"Copy " + fmt.full + " URL"}
                    >
                      <Icon name="copy" size={11} />
                    </span>
                    <span
                      className="copy"
                      onClick={() => onAction(feed.id, "open", fmt.id)}
                      title={"Open " + fmt.full}
                    >
                      <Icon name="open" size={11} />
                    </span>
                  </span>
                </div>
              ))}
              <div className="kv-row">
                <span className="k">Refresh</span>
                <span className="v">
                  {feed.refreshMinutes
                    ? feed.refreshMinutes + " min"
                    : feed.type === "webhook"
                    ? "on push"
                    : "—"}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">Origin</span>
                <span className="v">
                  {feed.origin?.type === "community"
                    ? "Community catalog · " + feed.origin.catalogId
                    : "Local"}
                </span>
              </div>
            </div>
          </section>

          <section className="drawer-section">
            <h4>Recent activity</h4>
            <div className="kv">
              <div className="kv-row">
                <span className="k">Last run</span>
                <span className="v">{feed.lastRunRelative || "never"}</span>
              </div>
              <div className="kv-row">
                <span className="k">Items</span>
                <span className="v">
                  {feed.lastItemCount ?? "—"}
                  {feed.lastNewItemCount > 0 &&
                    " (" + feed.lastNewItemCount + " new)"}
                </span>
              </div>
              {feed.lastErrorAt && (
                <div className="kv-row">
                  <span className="k">Last error</span>
                  <span className="v" style={{ color: "var(--err)" }}>
                    {feed.statusDetail || "Failed run"}
                  </span>
                </div>
              )}
            </div>
          </section>

          <section className="drawer-section">
            <h4>Tags</h4>
            <TagEditor
              tags={feed.tags}
              onChange={(tags) => onUpdate(feed.id, { tags })}
            />
          </section>

          <section className="drawer-section">
            <h4>Settings</h4>
            <div
              className="row between"
              style={{
                padding: "10px 12px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--line)",
                borderRadius: 10,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>
                  Feed enabled
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  Skipped by the worker when off.
                </div>
              </div>
              <button
                className={"toggle" + (feed.enabled ? " on" : "")}
                onClick={() => onUpdate(feed.id, { enabled: !feed.enabled })}
              />
            </div>
          </section>
        </div>

        <footer className="drawer-foot">
          <button
            className="btn"
            onClick={() => onAction(feed.id, "preview")}
          >
            <Icon name="eye" /> Preview
          </button>
          <button
            className="btn"
            onClick={() => onAction(feed.id, "duplicate")}
          >
            <Icon name="duplicate" /> Duplicate
          </button>
          <span className="grow" />
          <button
            className="btn btn-danger"
            onClick={() => onAction(feed.id, "delete")}
          >
            <Icon name="trash" /> Delete
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onAction(feed.id, "edit")}
          >
            <Icon name="edit" /> Edit
          </button>
        </footer>
      </aside>
    </React.Fragment>
  );
};

// ---------- Main page ----------

const MyFeedsPage = () => {
  const toast = useToast();
  const [feeds, setFeeds] = React.useState(window.SAMPLE_FEEDS);
  const [search, setSearch] = React.useState("");
  const [quick, setQuick] = React.useState("all");
  const [typeFilters, setTypeFilters] = React.useState([]);
  const [tagFilters, setTagFilters] = React.useState([]);
  const [view, setView] = React.useState("cards");
  const [detailId, setDetailId] = React.useState(null);
  const [defaultFormat, setDefaultFormat] = React.useState("rss");
  const [formatPerFeed, setFormatPerFeed] = React.useState({});
  const formatFor = (id) => formatPerFeed[id] || defaultFormat;
  const setFormatFor = (id, f) =>
    setFormatPerFeed((m) => ({ ...m, [id]: f }));

  const detail = feeds.find((f) => f.id === detailId);

  // counts
  const counts = React.useMemo(() => {
    const c = { all: feeds.length };
    QUICK_FILTERS.forEach((q) => {
      if (q.id !== "all") c[q.id] = feeds.filter((f) => matchesQuick(f, q.id)).length;
    });
    return c;
  }, [feeds]);

  const allTags = React.useMemo(() => {
    const set = new Map();
    feeds.forEach((f) => f.tags.forEach((t) => set.set(t, (set.get(t) || 0) + 1)));
    return [...set.entries()].sort((a, b) => b[1] - a[1]);
  }, [feeds]);

  const visible = React.useMemo(() => {
    return feeds.filter((f) => {
      if (!matchesQuick(f, quick)) return false;
      if (typeFilters.length && !typeFilters.includes(f.type)) return false;
      if (
        tagFilters.length &&
        !tagFilters.some((t) => f.tags.includes(t))
      )
        return false;
      if (!matchesSearch(f, search)) return false;
      return true;
    });
  }, [feeds, quick, typeFilters, tagFilters, search]);

  const updateFeed = (id, patch) =>
    setFeeds((all) => all.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  const handleAction = (id, action, fmt) => {
    const feed = feeds.find((f) => f.id === id);
    if (!feed) return;
    const format = fmt || formatFor(id);
    const url = formatUrl(feed, format);
    const fmtMeta = FORMATS.find((f) => f.id === format) || FORMATS[0];
    switch (action) {
      case "open":
        toast.push({
          tone: "",
          title: "Opening " + fmtMeta.full,
          body: url,
        });
        break;
      case "copy":
        navigator.clipboard?.writeText(window.location.origin + url);
        toast.push({
          tone: "ok",
          title: fmtMeta.full + " URL copied",
          body: url,
        });
        break;
      case "copy-source":
        toast.push({ tone: "ok", title: "Source URL copied" });
        break;
      case "preview":
        toast.push({
          tone: "",
          title: "Preview opened",
          body: "Reusing the existing builder XML preview.",
        });
        break;
      case "edit":
        toast.push({
          tone: "",
          title: "Opening in builder…",
          body: "Loading " + feed.filename + " into the form.",
        });
        setTimeout(() => {
          window.location.href = "build.html?edit=" + feed.id;
        }, 350);
        break;
      case "duplicate": {
        const copy = {
          ...feed,
          id: feed.id + "-copy",
          filename: feed.filename.replace(/\.yaml$/, "-copy.yaml"),
          title: feed.title + " (copy)",
          favorite: false,
          status: "neverRun",
          lastRunRelative: "never",
          lastItemCount: null,
        };
        setFeeds((all) => [copy, ...all]);
        toast.push({
          tone: "ok",
          title: "Duplicated",
          body: copy.filename,
        });
        break;
      }
      case "export":
        toast.push({
          tone: "ok",
          title: "YAML exported",
          body: feed.filename + " downloaded.",
        });
        break;
      case "enable":
      case "disable": {
        const next = action === "enable";
        updateFeed(id, { enabled: next });
        toast.push({
          tone: next ? "ok" : "warn",
          title: next ? "Feed enabled" : "Feed disabled",
          body: feed.title,
        });
        break;
      }
      case "delete": {
        setFeeds((all) => all.filter((f) => f.id !== id));
        setDetailId(null);
        toast.push({
          tone: "err",
          title: "Feed deleted",
          body: feed.filename,
          action: {
            label: "Undo",
            onClick: () => setFeeds((all) => [feed, ...all]),
          },
          ms: 6000,
        });
        break;
      }
      default:
        toast.push({ tone: "", title: action, body: feed.title });
    }
  };

  const importYaml = () => {
    toast.push({
      tone: "",
      title: "Pick a YAML file to import",
      body: "Drop a .yaml config in /app/configs or paste contents.",
    });
  };

  const clearFilters = () => {
    setSearch("");
    setQuick("all");
    setTypeFilters([]);
    setTagFilters([]);
  };

  const filterActive =
    quick !== "all" ||
    typeFilters.length > 0 ||
    tagFilters.length > 0 ||
    search.length > 0;

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title">
          <h1>My Feeds</h1>
          <span className="sub">
            Search, tag, filter, inspect, and export every feed recipe.
          </span>
        </div>

        <div className="page-actions">
          <div className="search">
            <span className="ic">
              <Icon name="search" size={14} />
            </span>
            <input
              placeholder="Search by name, source, tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="kbd">/</span>
          </div>
          <button className="btn" onClick={importYaml}>
            <Icon name="upload" /> Import
          </button>
          <button className="btn btn-brand" onClick={() => (window.location.href = "build.html")}>
            <Icon name="plus" /> Build Feed
          </button>
        </div>
      </header>

      <div className="page-body">
        <div className="filters">
          <ScrollableRow label="Quick">
            {QUICK_FILTERS.map((q) => (
              <button
                key={q.id}
                className={"chip" + (quick === q.id ? " active" : "")}
                onClick={() => setQuick(q.id)}
              >
                {q.icon && <Icon name={q.icon} size={12} />}
                {q.label}
                <span className="count">{counts[q.id]}</span>
              </button>
            ))}
          </ScrollableRow>

          <ScrollableRow label="Type">
            {TYPE_CHIPS.map((t) => {
              const active = typeFilters.includes(t);
              const meta = FEED_TYPE_META[t];
              const count = feeds.filter((f) => f.type === t).length;
              if (count === 0) return null;
              return (
                <button
                  key={t}
                  className={"chip" + (active ? " active" : "")}
                  onClick={() =>
                    setTypeFilters((arr) =>
                      active ? arr.filter((x) => x !== t) : [...arr, t]
                    )
                  }
                >
                  <Icon name={meta.icon} size={12} />
                  {meta.label}
                  <span className="count">{count}</span>
                </button>
              );
            })}
          </ScrollableRow>

          {allTags.length > 0 && (
            <ScrollableRow label="Tags">
              {allTags.map(([t, n]) => {
                const active = tagFilters.includes(t);
                return (
                  <button
                    key={t}
                    className={"chip tag" + (active ? " active" : "")}
                    onClick={() =>
                      setTagFilters((arr) =>
                        active ? arr.filter((x) => x !== t) : [...arr, t]
                      )
                    }
                  >
                    {t}
                    <span className="count">{n}</span>
                  </button>
                );
              })}
            </ScrollableRow>
          )}
        </div>

        <div className="resultbar">
          <strong>{visible.length}</strong>
          <span>
            of {feeds.length} feed{feeds.length === 1 ? "" : "s"}
          </span>
          {filterActive && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={clearFilters}
              style={{ marginLeft: 4 }}
            >
              <Icon name="x" size={11} /> Clear filters
            </button>
          )}
          <span className="spacer" />
          <div className="seg">
            <button
              className={view === "cards" ? "active" : ""}
              onClick={() => setView("cards")}
            >
              <Icon name="grid" /> Cards
            </button>
            <button
              className={view === "table" ? "active" : ""}
              onClick={() => setView("table")}
            >
              <Icon name="list" /> Table
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="empty">
            <div className="glyph">
              <Icon name="rss" />
            </div>
            <h3>No feeds match these filters.</h3>
            <p>
              Try clearing filters or build a new feed from a webpage, REST API,
              or email folder.
            </p>
            <div className="actions">
              <button className="btn" onClick={clearFilters}>
                Clear filters
              </button>
              <button className="btn btn-brand" onClick={() => (window.location.href = "build.html")}>
                <Icon name="plus" /> Build Feed
              </button>
            </div>
          </div>
        ) : view === "cards" ? (
          <div className="cards">
            {visible.map((f) => (
              <FeedCard
                key={f.id}
                feed={f}
                format={formatFor(f.id)}
                setFormat={(fmt) => setFormatFor(f.id, fmt)}
                onUpdate={updateFeed}
                onAction={handleAction}
                onOpenDetail={setDetailId}
              />
            ))}
          </div>
        ) : (
          <FeedTable
            feeds={visible}
            onUpdate={updateFeed}
            onAction={handleAction}
            onOpenDetail={setDetailId}
          />
        )}
      </div>

      {detail && (
        <FeedDetailDrawer
          feed={detail}
          onClose={() => setDetailId(null)}
          onUpdate={updateFeed}
          onAction={handleAction}
        />
      )}
    </div>
  );
};

window.MyFeedsPage = MyFeedsPage;
