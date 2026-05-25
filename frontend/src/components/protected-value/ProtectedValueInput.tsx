import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, EyeOff } from "lucide-react";

export type StorageMode = "plain" | "protected" | "env";

export type ProtectedValueInputProps = {
  label: string;
  value: string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string } | undefined;
  onChange: (value: string | { type: "protected"; value: string } | { type: "env"; value: string; prefix?: string }) => void;
  placeholder?: string;
};

function detectMode(value: ProtectedValueInputProps["value"]): StorageMode {
  if (!value || typeof value === "string") return "plain";
  return value.type === "env" ? "env" : "protected";
}

export function ProtectedValueInput({ label, value, onChange, placeholder }: ProtectedValueInputProps) {
  const [mode, setMode] = useState<StorageMode>(detectMode(value));
  const [isDirty, setIsDirty] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const displayValue =
    mode === "protected" && !isDirty
      ? typeof value === "object" && value?.type === "protected"
        ? "********"
        : ""
      : mode === "env"
      ? typeof value === "object" && value?.type === "env"
        ? value.value
        : ""
      : typeof value === "string"
      ? value
      : "";

  const prefix =
    typeof value === "object" && value?.type === "env" ? value.prefix ?? "" : "";

  function handleModeChange(newMode: StorageMode) {
    setMode(newMode);
    setIsDirty(false);
  }

  function handleValueChange(newVal: string) {
    setIsDirty(true);
    if (mode === "plain") {
      onChange(newVal);
    } else if (mode === "protected") {
      onChange({ type: "protected", value: newVal });
    } else {
      onChange({ type: "env", value: newVal, prefix: prefix || undefined });
    }
  }

  function handlePrefixChange(newPrefix: string) {
    if (mode === "env") {
      const varName = typeof value === "object" && value?.type === "env" ? value.value : "";
      onChange({ type: "env", value: varName, prefix: newPrefix || undefined });
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            className="flex-1 pr-9"
            placeholder={mode === "protected" ? "********" : placeholder}
            value={displayValue}
            type={mode === "protected" && !showValue ? "password" : "text"}
            onChange={(e) => handleValueChange(e.target.value)}
          />
          {mode === "protected" && (
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showValue ? "Hide value" : "Show value"}
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        <Select value={mode} onValueChange={(v) => handleModeChange(v as StorageMode)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="plain">Plain</SelectItem>
            <SelectItem value="protected">Encrypted</SelectItem>
            <SelectItem value="env">Env var</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "env" && (
        <Input
          placeholder="Prefix (e.g. Bearer )"
          value={prefix}
          onChange={(e) => handlePrefixChange(e.target.value)}
          className="text-sm"
        />
      )}
    </div>
  );
}
