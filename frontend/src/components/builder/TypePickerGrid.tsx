import React from "react";

type FeedTypeOption = {
  id: string;
  label: string;
  description: string;
  active: boolean;
  icon: React.ReactNode;
  bg: string;
  color: string;
  border: string;
};

const FEED_TYPES: FeedTypeOption[] = [
  {
    id: "webScraping",
    label: "Web Scraping",
    description: "Extract RSS from any webpage",
    active: true,
    bg: "#dde6fb", color: "#1e40af", border: "#bfdbfe",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    id: "api",
    label: "REST API",
    description: "Map JSON responses to RSS",
    active: true,
    bg: "#dcf3e3", color: "#14532d", border: "#bbf7d0",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
  },
  {
    id: "email",
    label: "Email / IMAP",
    description: "Turn your inbox into a feed",
    active: true,
    bg: "#fdecc8", color: "#78350f", border: "#fde68a",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
    ),
  },
  {
    id: "graphql",
    label: "GraphQL",
    description: "Query GraphQL APIs",
    active: false,
    bg: "#ede4fc", color: "#4c1d95", border: "#ddd6fe",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      </svg>
    ),
  },
  {
    id: "sitemap",
    label: "Sitemap",
    description: "Parse XML sitemaps",
    active: false,
    bg: "#e0f2fe", color: "#0c4a6e", border: "#bae6fd",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      </svg>
    ),
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "iCal / CalDAV to RSS",
    active: false,
    bg: "#fadcd9", color: "#7f1d1d", border: "#fca5a5",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: "filesystem",
    label: "Filesystem",
    description: "Watch a folder for new files",
    active: false,
    bg: "#f1f5f9", color: "#334155", border: "#cbd5e1",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: "webhook",
    label: "Webhook",
    description: "Receive pushes, emit RSS",
    active: false,
    bg: "#fef9c3", color: "#713f12", border: "#fef08a",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: "feedTransformer",
    label: "Feed Transformer",
    description: "Re-process an existing feed",
    active: false,
    bg: "#f0f9ff", color: "#075985", border: "#bae6fd",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3" />
      </svg>
    ),
  },
  {
    id: "serviceConnector",
    label: "Service Connector",
    description: "OAuth-connected services",
    active: false,
    bg: "#f5f3ff", color: "#4c1d95", border: "#ddd6fe",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    id: "sourceAssistant",
    label: "Source Assistant",
    description: "AI-guided feed setup",
    active: false,
    bg: "#f0fdf4", color: "#14532d", border: "#bbf7d0",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z" />
        <path d="M12 16v-4" /><path d="M12 8h.01" />
      </svg>
    ),
  },
];

interface TypePickerGridProps {
  onSelect: (type: string) => void;
}

export const TypePickerGrid: React.FC<TypePickerGridProps> = ({ onSelect }) => {
  return (
    <div style={{ padding: "32px 24px", maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 24 }}>
        <div className="workbench-label">Builder</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 4px" }}>Build a New Feed</h1>
        <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", margin: 0 }}>
          Choose the source type for your feed
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
        {FEED_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            onClick={() => type.active && onSelect(type.id)}
            disabled={!type.active}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 10,
              padding: 16,
              borderRadius: 8,
              border: `1px solid ${type.active ? "var(--wb-outline)" : "hsl(var(--border))"}`,
              borderTop: `4px solid ${type.active ? type.color : "hsl(var(--border))"}`,
              background: type.active ? "var(--wb-card)" : "hsl(var(--muted) / 0.4)",
              color: type.active ? "var(--wb-ink)" : "hsl(var(--muted-foreground))",
              cursor: type.active ? "pointer" : "not-allowed",
              textAlign: "left",
              transition: "transform 0.1s, box-shadow 0.1s",
              opacity: type.active ? 1 : 0.6,
            }}
            onMouseEnter={(e) => {
              if (type.active) (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-2, 0 4px 12px rgba(0,0,0,0.1))";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = "none";
            }}
          >
            {!type.active && (
              <span style={{
                position: "absolute", top: 8, right: 8,
                fontSize: 9, fontWeight: 700, padding: "1px 5px",
                background: "hsl(var(--muted-foreground))", color: "hsl(var(--background))",
                borderRadius: 20,
              }}>
                SOON
              </span>
            )}
            <div
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: type.active ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {type.icon}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 3 }}>{type.label}</div>
              <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.4 }}>{type.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
