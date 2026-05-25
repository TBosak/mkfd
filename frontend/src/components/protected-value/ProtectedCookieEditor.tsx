import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type { StorageMode } from "./ProtectedValueInput";

type RawCookieValue = string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string };

export type ProtectedCookieRow = {
  id: string;
  name: string;
  rawValue: string;
  storage: StorageMode;
  prefix?: string;
  isDirty: boolean;
  originalValue?: string; // ciphertext for undirty protected values
  domain?: string;
  path?: string;
  secure: boolean;
  httpOnly: boolean;
};

export type CookieConfig = {
  name: string;
  value: RawCookieValue;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
};

export type ProtectedCookieEditorProps = {
  value: CookieConfig[];
  onChange: (value: CookieConfig[]) => void;
};

function cookiesToRows(cookies: CookieConfig[]): ProtectedCookieRow[] {
  return cookies.map((c, i) => {
    const val = c.value;
    let rawValue = "";
    let storage: StorageMode = "plain";
    let prefix: string | undefined;
    const isDirty = false;

    let originalValue: string | undefined;
    if (typeof val === "object" && val.type === "protected") {
      rawValue = "********"; storage = "protected"; originalValue = val.value;
    } else if (typeof val === "object" && val.type === "env") {
      rawValue = val.value; storage = "env"; prefix = val.prefix;
    } else {
      rawValue = typeof val === "string" ? val : "";
    }

    return {
      id: String(i),
      name: c.name,
      rawValue,
      storage,
      prefix,
      isDirty,
      originalValue,
      domain: c.domain,
      path: c.path,
      secure: c.secure ?? false,
      httpOnly: c.httpOnly ?? false,
    };
  });
}

function rowsToCookies(rows: ProtectedCookieRow[]): CookieConfig[] {
  return rows.filter((r) => r.name.trim()).map((r) => {
    let value: RawCookieValue;
    if (r.storage === "protected") {
      // If dirty, use the new raw value (backend will encrypt it). If not dirty, restore original ciphertext.
      value = { type: "protected", value: r.isDirty ? r.rawValue : (r.originalValue ?? "********") };
    } else if (r.storage === "env") {
      value = { type: "env", value: r.rawValue, prefix: r.prefix || undefined };
    } else {
      value = r.rawValue;
    }
    return { name: r.name, value, domain: r.domain, path: r.path, secure: r.secure, httpOnly: r.httpOnly };
  });
}

export function ProtectedCookieEditor({ value, onChange }: ProtectedCookieEditorProps) {
  const [rows, setRows] = useState<ProtectedCookieRow[]>(() => cookiesToRows(value));

  function update(updated: ProtectedCookieRow[]) {
    setRows(updated);
    onChange(rowsToCookies(updated));
  }

  function addRow() {
    update([...rows, { id: Date.now().toString(), name: "", rawValue: "", storage: "plain", isDirty: false, secure: false, httpOnly: false }]);
  }

  function updateRow(id: string, patch: Partial<ProtectedCookieRow>) {
    update(rows.map((r) => {
      if (r.id !== id) return r;
      const updated = { ...r, ...patch };
      // When switching storage mode to protected with isDirty=false, clear any stale originalValue
      if (patch.storage !== undefined && patch.storage !== r.storage && patch.storage === "protected" && patch.isDirty === false) {
        updated.originalValue = undefined;
      }
      return updated;
    }));
  }

  return (
    <div className="space-y-3">
      <Label className="font-bold">Cookies</Label>
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto_auto_auto_auto_auto] gap-2 items-center">
          <Input placeholder="Name" value={row.name} onChange={(e) => updateRow(row.id, { name: e.target.value })} />
          <Input
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
              className="w-24"
              placeholder="Prefix"
              value={row.prefix ?? ""}
              onChange={(e) => updateRow(row.id, { prefix: e.target.value })}
            />
          )}
          <div className="flex items-center gap-1">
            <Checkbox
              id={`secure-${row.id}`}
              checked={row.secure}
              onCheckedChange={(v) => updateRow(row.id, { secure: !!v })}
            />
            <Label htmlFor={`secure-${row.id}`} className="text-xs">Secure</Label>
          </div>
          <div className="flex items-center gap-1">
            <Checkbox
              id={`http-${row.id}`}
              checked={row.httpOnly}
              onCheckedChange={(v) => updateRow(row.id, { httpOnly: !!v })}
            />
            <Label htmlFor={`http-${row.id}`} className="text-xs">HttpOnly</Label>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => update(rows.filter((r) => r.id !== row.id))}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" />Add cookie
      </Button>
    </div>
  );
}
