import React, { useState, useRef, useEffect } from "react";

export type StorageMode = "plain" | "encrypted" | "env";

interface StorageSelectProps {
  value: StorageMode;
  onChange: (mode: StorageMode) => void;
  sensitiveKey?: boolean;
}


export const StorageSelect: React.FC<StorageSelectProps> = ({ value, onChange, sensitiveKey = false }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentMeta = {
    plain:     { label: "Plain", bg: sensitiveKey ? "#fadcd9" : "#f8fafc", color: sensitiveKey ? "#b91c1c" : "#64748b", border: sensitiveKey ? "#fca5a5" : "#e2e8f0" },
    encrypted: { label: "Encrypted", bg: "#dde6fb", color: "#1e40af", border: "#bfdbfe" },
    env:       { label: "Env var", bg: "#fdecc8", color: "#78350f", border: "#fde68a" },
  }[value];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "2px 8px", borderRadius: 6, border: `1px solid ${currentMeta.border}`,
          background: currentMeta.bg, color: currentMeta.color, fontSize: 11, fontWeight: 600,
          cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        {currentMeta.label} ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "hsl(var(--background))", border: "1px solid hsl(var(--border))",
          borderRadius: 8, boxShadow: "var(--shadow-pop, 0 8px 24px rgba(0,0,0,0.12))",
          minWidth: 130, padding: "4px",
        }}>
          {(["plain", "encrypted", "env"] as StorageMode[]).map((mode) => {
            const meta = {
              plain:     { label: "Plain",     desc: "Stored as text" },
              encrypted: { label: "Encrypted", desc: "AES encrypted" },
              env:       { label: "Env var",   desc: "From environment" },
            }[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => { onChange(mode); setOpen(false); }}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
                  background: value === mode ? "hsl(var(--muted))" : "transparent",
                  border: 0, cursor: "pointer", borderRadius: 5,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</div>
                <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>{meta.desc}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
