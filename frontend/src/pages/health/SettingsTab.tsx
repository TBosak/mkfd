import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import type { EffectiveSetting } from "@/components/settings/SettingRow";

// ---------------------------------------------------------------------------
// API response types for GET /api/settings
// ---------------------------------------------------------------------------

type SettingsResponse = {
  settings: Record<string, EffectiveSetting>;
  meta?: {
    dbPath?: string;
  };
};

// Local state — only the retention-scoped keys shown in this tab
type RetentionState = {
  retentionDays: number;
  retentionDaysEnabled: boolean;
  retentionRuns: number;
  retentionRunsEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Switch component
// ---------------------------------------------------------------------------

function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        checked ? "bg-primary" : "bg-input"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// SettingsTab
// ---------------------------------------------------------------------------

export function SettingsTab() {
  const [retention, setRetention] = useState<RetentionState | null>(null);
  const [dbPath, setDbPath] = useState<string>("./data/runtime.db");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: SettingsResponse) => {
        const s = data.settings;
        setRetention({
          retentionDays: s.retention_days?.value as number ?? 90,
          retentionDaysEnabled: s.retention_days_enabled?.value as boolean ?? false,
          retentionRuns: s.retention_runs?.value as number ?? 1000,
          retentionRunsEnabled: s.retention_runs_enabled?.value as boolean ?? true,
        });
        setDbPath(data.meta?.dbPath ?? "./data/runtime.db");
      });
  }, []);

  const save = async () => {
    if (!retention) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retention_days: retention.retentionDays,
          retention_days_enabled: retention.retentionDaysEnabled,
          retention_runs: retention.retentionRuns,
          retention_runs_enabled: retention.retentionRunsEnabled,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? `Server error (${res.status})`);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  if (!retention) return <LoadingSpinner message="Loading settings..." />;

  return (
    <div className="space-y-6 max-w-lg">
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-base">Retention — Time-Based</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={retention.retentionDaysEnabled}
              onCheckedChange={(v) => setRetention({ ...retention, retentionDaysEnabled: v })}
            />
            <Label>Enable time-based pruning</Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              className="w-24"
              disabled={!retention.retentionDaysEnabled}
              value={retention.retentionDays}
              onChange={(e) => setRetention({ ...retention, retentionDays: Number(e.target.value) })}
            />
            <Label className="text-muted-foreground">days</Label>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-base">Retention — Count-Based</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={retention.retentionRunsEnabled}
              onCheckedChange={(v) => setRetention({ ...retention, retentionRunsEnabled: v })}
            />
            <Label>Enable count-based pruning</Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              className="w-24"
              disabled={!retention.retentionRunsEnabled}
              value={retention.retentionRuns}
              onChange={(e) => setRetention({ ...retention, retentionRuns: Number(e.target.value) })}
            />
            <Label className="text-muted-foreground">runs per feed</Label>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Database path: </span>
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{dbPath}</code>
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={saving}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
        </Button>
        {saveError && (
          <p className="text-sm text-destructive">{saveError}</p>
        )}
      </div>
    </div>
  );
}
