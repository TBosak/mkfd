import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingRow } from "@/components/settings/SettingRow";
import type { EffectiveSetting } from "@/components/settings/SettingRow";
import { useToast } from "@/components/ui/toast-provider";
import { RotateCcw, Save } from "lucide-react";

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

type SettingsResponse = {
  settings: Record<string, EffectiveSetting>;
  meta?: { dbPath?: string };
};

type EditableValue = string | number | boolean | string[];

type SettingsValues = Record<string, EditableValue>;

// ---------------------------------------------------------------------------
// Key metadata
// ---------------------------------------------------------------------------

type KeyMeta = {
  label: string;
  description?: string;
  section: "security" | "storage" | "network" | "timeouts";
};

const KEY_META: Record<string, KeyMeta> = {
  // Security — class C
  encryption_key: {
    label: "Encryption Key",
    description: "Used to encrypt stored secrets (e.g., email passwords). Must be 16, 24, or 32 characters.",
    section: "security",
  },
  passkey: {
    label: "Passkey",
    description: "Authenticates API requests. Set via command-line argument or environment variable.",
    section: "security",
  },
  cookie_secret: {
    label: "Cookie Secret",
    description: "Signs session cookies. Must be at least 32 characters.",
    section: "security",
  },

  // Runtime / Storage — class A
  retention_days: {
    label: "Retention Days",
    description: "Maximum age (in days) for stored run records. Applied when time-based pruning is enabled.",
    section: "storage",
  },
  retention_days_enabled: {
    label: "Enable Time-Based Pruning",
    description: "Remove run records older than the configured number of days.",
    section: "storage",
  },
  retention_runs: {
    label: "Max Runs Per Feed",
    description: "Maximum number of run records to keep per feed. Applied when count-based pruning is enabled.",
    section: "storage",
  },
  retention_runs_enabled: {
    label: "Enable Count-Based Pruning",
    description: "Remove oldest run records when a feed exceeds the configured run count.",
    section: "storage",
  },

  // Network — class A
  allow_private_fetches: {
    label: "Allow Private Network Fetches",
    description: "Permit fetching from private IP ranges (RFC-1918). Disable in multi-tenant environments.",
    section: "network",
  },
  outbound_fetch_allowlist: {
    label: "Outbound Fetch Allowlist",
    description:
      "Restrict outbound HTTP requests to these hostnames or URL prefixes. Leave empty to allow all destinations.",
    section: "network",
  },

  // Timeouts — class B (restart required)
  feed_run_timeout_ms: {
    label: "Feed Run Timeout (ms)",
    description: "Maximum time (milliseconds) a feed run may take before it is cancelled. Requires restart.",
    section: "timeouts",
  },
};

const SECTION_ORDER: KeyMeta["section"][] = ["security", "storage", "network", "timeouts"];

const SECTION_LABELS: Record<KeyMeta["section"], { title: string; description: string }> = {
  security: {
    title: "Security",
    description: "Secrets and cryptographic keys. These are managed via environment variables or command-line arguments and cannot be changed from the UI.",
  },
  storage: {
    title: "Runtime / Storage",
    description: "Data retention policies for feed run records stored in the local database.",
  },
  network: {
    title: "Network & Fetch Policy",
    description: "Control which outbound HTTP requests are permitted when feeds are run.",
  },
  timeouts: {
    title: "Runtime Timeouts",
    description: "Timing limits for feed execution. Changes to restart-required settings take effect after restarting mkfd.",
  },
};

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage() {
  const toast = useToast();

  const [rawSettings, setRawSettings] = useState<Record<string, EffectiveSetting> | null>(null);
  const [edited, setEdited] = useState<SettingsValues>({});
  const [dbPath, setDbPath] = useState<string>("./data/runtime.db");
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Track original (server) values for dirty-state comparison
  const serverValues = useRef<SettingsValues>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data: SettingsResponse = await res.json();
      setRawSettings(data.settings);
      setDbPath(data.meta?.dbPath ?? "./data/runtime.db");

      // Initialise editable values from server response (class A + B only)
      const initial: SettingsValues = {};
      for (const [key, s] of Object.entries(data.settings)) {
        if (s.class !== "C") {
          initial[key] = s.value;
        }
      }
      serverValues.current = { ...initial };
      setEdited({ ...initial });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load settings");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Dirty state
  // ---------------------------------------------------------------------------

  const dirtyKeys = Object.keys(edited).filter((k) => {
    const orig = serverValues.current[k];
    const curr = edited[k];
    if (Array.isArray(orig) && Array.isArray(curr)) {
      return JSON.stringify(orig) !== JSON.stringify(curr);
    }
    return orig !== curr;
  });

  const isDirty = dirtyKeys.length > 0;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleChange = (key: string, value: EditableValue) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
  };

  const discard = () => {
    setEdited({ ...serverValues.current });
  };

  const save = async () => {
    if (!isDirty) return;
    setSaving(true);
    try {
      // Only send dirty keys
      const payload: Record<string, EditableValue> = {};
      for (const k of dirtyKeys) {
        payload[k] = edited[k];
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        toast.push({ tone: "err", title: "Save failed", body: body.error ?? `Server error (${res.status})` });
        return;
      }
      // Re-fetch so source badges update (e.g., default → db)
      await load();
      toast.push({ tone: "ok", title: "Settings saved" });
    } catch (err) {
      toast.push({ tone: "err", title: "Save failed", body: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  if (!rawSettings && !loadError) {
    return (
      <div className="flex h-full min-h-0 flex-col animate-in" style={{ background: "var(--wb-surface)" }}>
        <header
          className="flex h-12 shrink-0 items-center border-b px-6"
          style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}
        >
          <h1 className="text-xl font-semibold">Settings</h1>
        </header>
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner message="Loading settings..." />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full min-h-0 flex-col animate-in" style={{ background: "var(--wb-surface)" }}>
        <header
          className="flex h-12 shrink-0 items-center border-b px-6"
          style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}
        >
          <h1 className="text-xl font-semibold">Settings</h1>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" size="sm" onClick={load}>Retry</Button>
        </div>
      </div>
    );
  }

  // Group keys by section, preserving order
  const sections: Record<KeyMeta["section"], string[]> = {
    security: [],
    storage: [],
    network: [],
    timeouts: [],
  };

  for (const key of Object.keys(KEY_META)) {
    if (rawSettings && key in rawSettings) {
      sections[KEY_META[key].section].push(key);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col animate-in" style={{ background: "var(--wb-surface)" }}>
      {/* Page header */}
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b px-6"
        style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}
      >
        <h1 className="text-xl font-semibold">Settings</h1>
        {isDirty && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={discard}
              disabled={saving}
              className="h-8 gap-1.5 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
              className="h-8 gap-1.5 text-xs"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : `Save ${dirtyKeys.length} change${dirtyKeys.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {SECTION_ORDER.map((sectionId) => {
            const keys = sections[sectionId];
            if (keys.length === 0) return null;
            const { title, description } = SECTION_LABELS[sectionId];

            return (
              <SettingsSection key={sectionId} title={title} description={description}>
                {keys.map((key) => {
                  const setting = rawSettings![key];
                  const meta = KEY_META[key];
                  const currentValue = setting.class === "C" ? setting.value : (edited[key] ?? setting.value);
                  const dirty = dirtyKeys.includes(key);

                  return (
                    <SettingRow
                      key={key}
                      label={meta.label}
                      description={meta.description}
                      setting={setting}
                      currentValue={currentValue}
                      onChange={(v) => handleChange(key, v)}
                      isDirty={dirty}
                    />
                  );
                })}
              </SettingsSection>
            );
          })}

          {/* Database info */}
          <div
            className="rounded border px-4 py-2.5 text-xs text-muted-foreground"
            style={{ borderColor: "var(--wb-outline)", background: "var(--wb-card)" }}
          >
            <span className="font-medium text-foreground">Database: </span>
            <code className="rounded px-1 py-0.5 text-xs" style={{ background: "hsl(var(--muted))" }}>
              {dbPath}
            </code>
          </div>

          {/* Floating save affordance for long pages */}
          {isDirty && (
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={discard} disabled={saving} className="h-8 text-xs">
                Discard
              </Button>
              <Button size="sm" onClick={save} disabled={saving} className="h-8 text-xs">
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
