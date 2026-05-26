import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsSection } from "./SettingsSection";

type Profiles = {
  proxyProfiles: Array<{ id: string; name: string; host: string; port: number; protocol: string; enabled: boolean }>;
  userAgentProfiles: Array<{ id: string; name: string; userAgent: string; enabled: boolean }>;
};

export function RequestProfilesPanel() {
  const [profiles, setProfiles] = useState<Profiles>({ proxyProfiles: [], userAgentProfiles: [] });
  const [uaName, setUaName] = useState("");
  const [uaValue, setUaValue] = useState("");

  const load = async () => {
    const res = await fetch("/api/settings/request-profiles");
    if (res.ok) setProfiles(await res.json());
  };

  useEffect(() => { load(); }, []);

  const addUserAgent = async () => {
    if (!uaName.trim() || !uaValue.trim()) return;
    const res = await fetch("/api/settings/request-profiles/user-agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: uaName, userAgent: uaValue, enabled: true }),
    });
    if (res.ok) {
      setUaName("");
      setUaValue("");
      await load();
    }
  };

  return (
    <SettingsSection
      title="Request Profiles"
      description="Reusable request identities for feeds. A proxy can observe outbound traffic for feeds that use it."
    >
      <div className="space-y-3">
        <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
          <Input value={uaName} onChange={(event) => setUaName(event.target.value)} placeholder="Profile name" />
          <Input value={uaValue} onChange={(event) => setUaValue(event.target.value)} placeholder="User-Agent string" />
          <Button type="button" variant="outline" onClick={addUserAgent}>Add</Button>
        </div>
        <div className="space-y-2 text-xs">
          {profiles.userAgentProfiles.map((profile) => (
            <div key={profile.id} className="rounded border border-border bg-card p-2">
              <div className="font-medium text-foreground">{profile.name} <span className="text-muted-foreground">({profile.id})</span></div>
              <div className="truncate text-muted-foreground">{profile.userAgent}</div>
            </div>
          ))}
          {profiles.proxyProfiles.map((profile) => (
            <div key={profile.id} className="rounded border border-border bg-card p-2">
              <div className="font-medium text-foreground">{profile.name} <span className="text-muted-foreground">({profile.id})</span></div>
              <div className="text-muted-foreground">{profile.protocol}://{profile.host}:{profile.port}</div>
            </div>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
