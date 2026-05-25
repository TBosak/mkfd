import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import type { HealthSettings } from "@/types/health";

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

export function SettingsTab() {
  const [settings, setSettings] = useState<HealthSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/health/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    await fetch("/api/health/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!settings) return <LoadingSpinner message="Loading settings..." />;

  return (
    <div className="space-y-6 max-w-lg">
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <h3 className="font-semibold text-base">Retention — Time-Based</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.retentionDaysEnabled}
              onCheckedChange={(v) => setSettings({ ...settings, retentionDaysEnabled: v })}
            />
            <Label>Enable time-based pruning</Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              className="w-24"
              disabled={!settings.retentionDaysEnabled}
              value={settings.retentionDays}
              onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) })}
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
              checked={settings.retentionRunsEnabled}
              onCheckedChange={(v) => setSettings({ ...settings, retentionRunsEnabled: v })}
            />
            <Label>Enable count-based pruning</Label>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              className="w-24"
              disabled={!settings.retentionRunsEnabled}
              value={settings.retentionRuns}
              onChange={(e) => setSettings({ ...settings, retentionRuns: Number(e.target.value) })}
            />
            <Label className="text-muted-foreground">runs per feed</Label>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border/50">
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Database path: </span>
            <code className="text-xs bg-muted px-1 py-0.5 rounded">{settings.dbPath}</code>
          </p>
        </CardContent>
      </Card>

      <Button
        onClick={save}
        disabled={saving}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {saving ? "Saving…" : saved ? "Saved!" : "Save Settings"}
      </Button>
    </div>
  );
}
