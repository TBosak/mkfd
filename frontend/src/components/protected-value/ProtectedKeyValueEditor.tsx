import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { StorageMode } from "./ProtectedValueInput";

export type ProtectedKVRow = {
  id: string;
  key: string;
  rawValue: string;
  storage: StorageMode;
  prefix?: string;
  isDirty: boolean;
};

type RawConfigValue = string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string };

export type ProtectedKeyValueEditorProps = {
  label: string;
  value: Record<string, RawConfigValue>;
  onChange: (value: Record<string, RawConfigValue>) => void;
  addButtonLabel?: string;
};

function recordToRows(record: Record<string, RawConfigValue>): ProtectedKVRow[] {
  return Object.entries(record).map(([key, val], i) => {
    if (typeof val === "object" && val.type === "protected") {
      return { id: String(i), key, rawValue: "********", storage: "protected" as const, isDirty: false };
    }
    if (typeof val === "object" && val.type === "env") {
      return { id: String(i), key, rawValue: val.value, storage: "env" as const, prefix: val.prefix, isDirty: false };
    }
    return { id: String(i), key, rawValue: typeof val === "string" ? val : "", storage: "plain" as const, isDirty: false };
  });
}

function rowsToRecord(rows: ProtectedKVRow[]): Record<string, RawConfigValue> {
  return Object.fromEntries(
    rows
      .filter((r) => r.key.trim())
      .map((r) => {
        if (r.storage === "protected") {
          return [r.key, { type: "protected" as const, value: r.isDirty ? r.rawValue : "********" }];
        }
        if (r.storage === "env") {
          return [r.key, { type: "env" as const, value: r.rawValue, prefix: r.prefix || undefined }];
        }
        return [r.key, r.rawValue];
      }),
  );
}

export function ProtectedKeyValueEditor({ label, value, onChange, addButtonLabel = "Add row" }: ProtectedKeyValueEditorProps) {
  const [rows, setRows] = useState<ProtectedKVRow[]>(() => recordToRows(value));

  function update(updated: ProtectedKVRow[]) {
    setRows(updated);
    onChange(rowsToRecord(updated));
  }

  function addRow() {
    update([...rows, { id: Date.now().toString(), key: "", rawValue: "", storage: "plain", isDirty: false }]);
  }

  function removeRow(id: string) {
    update(rows.filter((r) => r.id !== id));
  }

  function updateRow(id: string, patch: Partial<ProtectedKVRow>) {
    update(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <div className="space-y-3">
      <Label className="font-bold">{label}</Label>
      {rows.map((row) => (
        <div key={row.id} className="flex gap-2 items-start">
          <Input
            className="flex-1"
            placeholder="Key"
            value={row.key}
            onChange={(e) => updateRow(row.id, { key: e.target.value })}
          />
          <Input
            className="flex-1"
            placeholder={row.storage === "protected" ? "********" : row.storage === "env" ? "VAR_NAME" : "Value"}
            value={row.rawValue}
            type={row.storage === "protected" ? "password" : "text"}
            onChange={(e) => updateRow(row.id, { rawValue: e.target.value, isDirty: true })}
          />
          <Select
            value={row.storage}
            onValueChange={(v) => updateRow(row.id, { storage: v as StorageMode, isDirty: false })}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="plain">Plain</SelectItem>
              <SelectItem value="protected">Encrypted</SelectItem>
              <SelectItem value="env">Env var</SelectItem>
            </SelectContent>
          </Select>
          {row.storage === "env" && (
            <Input
              className="w-28"
              placeholder="Prefix"
              value={row.prefix ?? ""}
              onChange={(e) => updateRow(row.id, { prefix: e.target.value })}
            />
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.id)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" />
        {addButtonLabel}
      </Button>
    </div>
  );
}
