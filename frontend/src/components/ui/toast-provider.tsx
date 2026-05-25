import React, { createContext, useCallback, useContext, useState } from "react";

type ToastTone = "ok" | "err" | "warn" | "";
type Toast = { id: string; tone: ToastTone; title: string; body?: string; action?: { label: string; onClick: () => void }; ms?: number; };
type ToastCtx = { push: (t: Omit<Toast, "id">) => string; dismiss: (id: string) => void; };

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => { setToasts((a) => a.filter((t) => t.id !== id)); }, []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((a) => [...a, { id, ...t }]);
    const ms = t.ms !== 0 ? (t.ms ?? 4200) : null;
    if (ms !== null) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);
  return (
    <Ctx.Provider value={{ push, dismiss }}>
      {children}
      <div style={{ position: "fixed", bottom: 20, right: 20, display: "flex", flexDirection: "column", gap: 10, zIndex: 100 }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, background: t.tone === "ok" ? "#166534" : t.tone === "err" ? "#991b1b" : t.tone === "warn" ? "#92400e" : "hsl(var(--foreground))", color: "#fff", padding: "12px 14px", borderRadius: 10, fontSize: 13, minWidth: 300, maxWidth: 400, boxShadow: "var(--shadow-pop)" }}>
            <div>
              <strong style={{ display: "block", marginBottom: 2 }}>{t.title}</strong>
              {t.body && <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12 }}>{t.body}</span>}
              {t.action && (<button onClick={() => { t.action!.onClick(); dismiss(t.id); }} style={{ marginTop: 6, background: "rgba(255,255,255,0.15)", border: 0, color: "#fff", fontSize: 12, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontWeight: 500 }}>{t.action.label}</button>)}
            </div>
            <button onClick={() => dismiss(t.id)} style={{ background: "transparent", border: 0, color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px", alignSelf: "start" }}>×</button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
