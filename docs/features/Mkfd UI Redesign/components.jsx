// Icons + primitives + toast host.

const Icon = ({ name, size = 16, ...props }) => {
  const paths = {
    rss: (
      <g>
        <path d="M4 11a9 9 0 019 9" />
        <path d="M4 4a16 16 0 0116 16" />
        <circle cx="5" cy="19" r="1.5" fill="currentColor" />
      </g>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    minus: <path d="M5 12h14" />,
    search: (
      <g>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </g>
    ),
    star: (
      <path d="M12 3.6l2.7 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.9l-5.5 2.9 1.1-6.2-4.5-4.4 6.2-.9z" />
    ),
    play: <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />,
    pause: (
      <path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor" stroke="none" />
    ),
    refresh: (
      <g>
        <path d="M4 4v6h6" />
        <path d="M20 20v-6h-6" />
        <path d="M4 10a8 8 0 0114-4l2 2M20 14a8 8 0 01-14 4l-2-2" />
      </g>
    ),
    chev: <path d="M9 6l6 6-6 6" />,
    chevd: <path d="M6 9l6 6 6-6" />,
    dot3: (
      <g fill="currentColor" stroke="none">
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </g>
    ),
    copy: (
      <g>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
      </g>
    ),
    download: <path d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />,
    upload: <path d="M12 20V8m0 0l-4 4m4-4l4 4M4 4h16" />,
    open: (
      <g>
        <path d="M14 4h6v6" />
        <path d="M20 4l-9 9" />
        <path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" />
      </g>
    ),
    globe: (
      <g>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
      </g>
    ),
    code: <path d="M16 18l6-6-6-6M8 6l-6 6 6 6M14 4l-4 16" />,
    graphql: (
      <g>
        <path d="M12 3l9 5.25v7.5L12 21l-9-5.25v-7.5L12 3z" />
        <path d="M3 8.25L12 21M21 8.25L12 21M3 8.25h18" />
      </g>
    ),
    mail: (
      <g>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </g>
    ),
    calendar: (
      <g>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </g>
    ),
    map: (
      <g>
        <path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z" />
        <path d="M9 4v14M15 6v14" />
      </g>
    ),
    folder: (
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    ),
    webhook: (
      <g>
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 18h7M16.5 8l-4 7M9 16l-1-4 4-3" />
      </g>
    ),
    check: <path d="M5 12l5 5L20 7" />,
    x: <path d="M6 6l12 12M18 6L6 18" />,
    alert: (
      <g>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9l-8.2 14a2 2 0 001.7 3h16.4a2 2 0 001.7-3l-8.2-14a2 2 0 00-3.4 0z" />
      </g>
    ),
    info: (
      <g>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8h.01M11 12h1v5h1" />
      </g>
    ),
    tag: (
      <g>
        <path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z" />
        <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
      </g>
    ),
    edit: <path d="M11 4H4v16h16v-7M18.5 2.5a2.1 2.1 0 113 3L12 15l-4 1 1-4z" />,
    trash: (
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
    ),
    eye: (
      <g>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    ),
    duplicate: (
      <g>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 012-2h9" />
      </g>
    ),
    power: (
      <g>
        <path d="M12 4v8" />
        <path d="M18 7a8 8 0 11-12 0" />
      </g>
    ),
    lock: (
      <g>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </g>
    ),
    key: (
      <g>
        <circle cx="8" cy="16" r="3.5" />
        <path d="M11 13l9-9M16 8l3 3" />
      </g>
    ),
    shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
    cloud: <path d="M7 18a4 4 0 010-8 6 6 0 0111-3 5 5 0 012 9.6" />,
    bell: <path d="M6 9a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 004 0" />,
    grid: (
      <g>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </g>
    ),
    list: (
      <g>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="4" cy="6" r="1" fill="currentColor" />
        <circle cx="4" cy="12" r="1" fill="currentColor" />
        <circle cx="4" cy="18" r="1" fill="currentColor" />
      </g>
    ),
    filter: <path d="M3 5h18l-7 9v6l-4-2v-4L3 5z" />,
    clock: (
      <g>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </g>
    ),
    inbox: (
      <g>
        <path d="M22 13H16l-2 3h-4l-2-3H2" />
        <path d="M5 5l-3 8v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3-8a2 2 0 00-1.8-1.2H6.8A2 2 0 005 5z" />
      </g>
    ),
    sliders: (
      <g>
        <path d="M4 6h13M4 12h7M4 18h9" />
        <circle cx="19" cy="6" r="2" />
        <circle cx="13" cy="12" r="2" />
        <circle cx="15" cy="18" r="2" />
      </g>
    ),
    github: (
      <path d="M12 2a10 10 0 00-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.7-1.4-2.2-.3-4.5-1.1-4.5-5 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 015 0c2-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.5 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0012 2z" />
    ),
    sparkles: (
      <g>
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </g>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name] || null}
    </svg>
  );
};

const FEED_TYPE_META = {
  scrape:     { label: "Web Scraping", icon: "globe" },
  rest:       { label: "REST API",     icon: "code" },
  graphql:    { label: "GraphQL",      icon: "graphql" },
  email:      { label: "Email",        icon: "mail" },
  calendar:   { label: "Calendar",     icon: "calendar" },
  sitemap:    { label: "Sitemap",      icon: "map" },
  filesystem: { label: "Filesystem",   icon: "folder" },
  webhook:    { label: "Webhook",      icon: "webhook" },
};

const STATUS_META = {
  healthy:  { tone: "ok",   label: "Healthy" },
  warning:  { tone: "warn", label: "Warning" },
  error:    { tone: "err",  label: "Failing" },
  disabled: { tone: "",     label: "Disabled" },
  neverRun: { tone: "info", label: "Never run" },
  running:  { tone: "info", label: "Running" },
};

const Badge = ({ tone = "", mono = false, children, ...rest }) => (
  <span className={"badge " + tone + (mono ? " mono" : "")} {...rest}>
    {children}
  </span>
);

const StatusBadge = ({ status }) => {
  const cfg = STATUS_META[status] || STATUS_META.healthy;
  return (
    <Badge tone={cfg.tone}>
      <span className="dot" />
      {cfg.label}
    </Badge>
  );
};

const TypeIcon = ({ type, size = 16, className = "" }) => {
  const meta = FEED_TYPE_META[type] || { icon: "rss" };
  return (
    <span className={"feedcard-type " + type + " " + className}>
      <Icon name={meta.icon} size={size} />
    </span>
  );
};

// Toast host
const ToastCtx = React.createContext(null);

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = React.useState([]);
  const push = React.useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((arr) => [...arr, { id, ...t }]);
    if (t.ms !== 0) {
      setTimeout(
        () => setToasts((arr) => arr.filter((x) => x.id !== id)),
        t.ms || 4200
      );
    }
    return id;
  }, []);
  const dismiss = React.useCallback(
    (id) => setToasts((arr) => arr.filter((x) => x.id !== id)),
    []
  );
  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + (t.tone || "")}>
            <span className="icon">
              <Icon
                name={
                  t.tone === "ok"
                    ? "check"
                    : t.tone === "err"
                    ? "alert"
                    : t.tone === "warn"
                    ? "alert"
                    : "info"
                }
              />
            </span>
            <div className="body">
              <strong>{t.title}</strong>
              {t.body && <span>{t.body}</span>}
              {t.action && (
                <button onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button className="close" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
};

const useToast = () => React.useContext(ToastCtx);

// Click-outside helper
const useClickOutside = (onClose) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", (e) => e.key === "Escape" && onClose());
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
};

Object.assign(window, {
  Icon,
  Badge,
  StatusBadge,
  TypeIcon,
  ToastProvider,
  useToast,
  useClickOutside,
  FEED_TYPE_META,
  STATUS_META,
});
