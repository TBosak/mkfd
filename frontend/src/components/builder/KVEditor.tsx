import React, { useState } from "react";
import { StorageSelect, type StorageMode } from "./StorageSelect";

const SENSITIVE_KEY_PATTERN = /authorization|cookie|x-api-key|token|secret|password|bearer/i;

export interface KVRow {
  key: string;
  value: string;
  storage?: StorageMode;
}

interface KVEditorProps {
  rows: KVRow[];
  onChange: (rows: KVRow[]) => void;
  showStorage?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}

export const KVEditor: React.FC<KVEditorProps> = ({
  rows,
  onChange,
  showStorage = false,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  addLabel = "Add row",
}) => {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newStorage, setNewStorage] = useState<StorageMode>("plain");

  const update = (index: number, field: keyof KVRow, value: string) => {
    const updated = rows.map((r, i) =>
      i === index ? { ...r, [field]: value } : r
    );
    onChange(updated);
  };

  const updateStorage = (index: number, storage: StorageMode) => {
    const updated = rows.map((r, i) =>
      i === index ? { ...r, storage } : r
    );
    onChange(updated);
  };

  const remove = (index: number) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const add = () => {
    const key = newKey.trim();
    const value = newValue.trim();
    if (!key) return;
    onChange([...rows, { key, value, storage: newStorage }]);
    setNewKey("");
    setNewValue("");
    setNewStorage("plain");
  };

  const hasPlainSensitive = rows.some(
    (r) => (!r.storage || r.storage === "plain") && SENSITIVE_KEY_PATTERN.test(r.key) && r.value.length > 0
  );

  return (
    <div>
      {hasPlainSensitive && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
          background: "#fadcd9", borderRadius: 6, marginBottom: 8, fontSize: 12, color: "#7f1d1d",
        }}>
          ⚠ Some sensitive keys are stored as plain text. Consider using Encrypted or Env var.
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", padding: "2px 6px 4px", textTransform: "uppercase" }}>Key</th>
              <th style={{ textAlign: "left", fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", padding: "2px 6px 4px", textTransform: "uppercase" }}>Value</th>
              {showStorage && <th style={{ textAlign: "left", fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", padding: "2px 6px 4px", textTransform: "uppercase" }}>Storage</th>}
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isSensitive = SENSITIVE_KEY_PATTERN.test(row.key);
              return (
                <tr key={i}>
                  <td style={{ padding: "3px 4px" }}>
                    <input
                      value={row.key}
                      onChange={(e) => update(i, "key", e.target.value)}
                      style={{ width: "100%", padding: "4px 6px", border: "1px solid hsl(var(--border))", borderRadius: 5, fontSize: 12, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                      placeholder={keyPlaceholder}
                    />
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <input
                      value={row.value}
                      onChange={(e) => update(i, "value", e.target.value)}
                      type={row.storage === "encrypted" || (isSensitive && row.storage !== "plain") ? "password" : "text"}
                      style={{ width: "100%", padding: "4px 6px", border: "1px solid hsl(var(--border))", borderRadius: 5, fontSize: 12, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                      placeholder={valuePlaceholder}
                    />
                  </td>
                  {showStorage && (
                    <td style={{ padding: "3px 4px", whiteSpace: "nowrap" }}>
                      <StorageSelect
                        value={row.storage ?? "plain"}
                        onChange={(mode) => updateStorage(i, mode)}
                        sensitiveKey={isSensitive}
                      />
                    </td>
                  )}
                  <td style={{ padding: "3px 4px", textAlign: "center" }}>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      style={{ background: "transparent", border: 0, cursor: "pointer", color: "hsl(var(--muted-foreground))", fontSize: 14 }}
                      aria-label="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {/* Add row */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={keyPlaceholder}
          style={{ flex: 1, padding: "4px 8px", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={valuePlaceholder}
          style={{ flex: 2, padding: "4px 8px", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12, background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
        />
        {showStorage && (
          <StorageSelect
            value={newStorage}
            onChange={setNewStorage}
            sensitiveKey={SENSITIVE_KEY_PATTERN.test(newKey)}
          />
        )}
        <button
          type="button"
          onClick={add}
          style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid hsl(var(--border))", background: "transparent", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
};
