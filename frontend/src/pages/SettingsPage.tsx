import { SettingsTab } from "./health/SettingsTab";

export function SettingsPage() {
  return (
    <div className="flex h-full min-h-0 flex-col animate-in" style={{ background: "var(--wb-surface)" }}>
      <header className="flex h-12 shrink-0 items-center border-b px-6" style={{ background: "var(--wb-card)", borderColor: "var(--wb-outline)" }}>
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <SettingsTab />
      </div>
    </div>
  );
}
