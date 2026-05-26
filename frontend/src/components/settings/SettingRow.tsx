import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingSource = "db" | "env" | "default";
export type SettingClass = "A" | "B" | "C";

export type EffectiveSetting = {
  value: string | number | boolean | string[];
  source: SettingSource;
  restartRequired: boolean;
  class: SettingClass;
  masked: boolean;
};

// ---------------------------------------------------------------------------
// Source badge
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: SettingSource }) {
  const label = source === "db" ? "DB" : source === "env" ? "ENV" : "Default";

  const style: React.CSSProperties =
    source === "db"
      ? { background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.3)" }
      : source === "env"
      ? { background: "color-mix(in srgb, var(--wb-warning) 15%, transparent)", color: "var(--wb-warning)", border: "1px solid color-mix(in srgb, var(--wb-warning) 40%, transparent)" }
      : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "1px solid hsl(var(--border))" };

  return (
    <span
      style={{
        ...style,
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 4,
        letterSpacing: "0.04em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Restart badge
// ---------------------------------------------------------------------------

function RestartBadge() {
  return (
    <span
      style={{
        background: "hsl(var(--destructive) / 0.1)",
        color: "hsl(var(--destructive))",
        border: "1px solid hsl(var(--destructive) / 0.3)",
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 6px",
        borderRadius: 4,
        whiteSpace: "nowrap",
      }}
    >
      Restart required
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inline toggle switch
// ---------------------------------------------------------------------------

function InlineSwitch({
  id,
  checked,
  onChange,
  disabled,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
// SettingRow props
// ---------------------------------------------------------------------------

export type SettingRowProps = {
  /** Human-readable label */
  label: string;
  /** Optional description shown below the label */
  description?: string;
  /** The resolved setting from the API */
  setting: EffectiveSetting;
  /** Current (possibly edited) value */
  currentValue: string | number | boolean | string[];
  /** Called when the user changes the value */
  onChange?: (value: string | number | boolean | string[]) => void;
  /** Whether the row has unsaved changes */
  isDirty?: boolean;
};

// ---------------------------------------------------------------------------
// SettingRow
// ---------------------------------------------------------------------------

export function SettingRow({
  label,
  description,
  setting,
  currentValue,
  onChange,
  isDirty = false,
}: SettingRowProps) {
  const [revealed, setRevealed] = useState(false);

  const isReadOnly = setting.class === "C";
  const isMasked = setting.masked;

  // Class C: env-managed, read-only masked display
  if (isReadOnly) {
    return (
      <div
        className={cn(
          "flex items-start justify-between gap-4 py-3",
          "opacity-60"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <Label className="text-sm font-medium">{label}</Label>
            <SourceBadge source={setting.source} />
            {setting.restartRequired && <RestartBadge />}
            <span
              style={{
                background: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
                border: "1px solid hsl(var(--border))",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                whiteSpace: "nowrap",
              }}
            >
              Env-managed
            </span>
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isMasked ? (
            <>
              <code
                className="rounded border px-2 py-1 text-xs font-mono"
                style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))", letterSpacing: "0.15em" }}
              >
                {revealed ? String(setting.value) : "•••••••••"}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={revealed ? "Hide value" : "Reveal value"}
              >
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </>
          ) : (
            <code
              className="rounded border px-2 py-1 text-xs font-mono"
              style={{ background: "hsl(var(--muted))", borderColor: "hsl(var(--border))" }}
            >
              {String(setting.value)}
            </code>
          )}
        </div>
      </div>
    );
  }

  // Boolean toggles
  if (typeof currentValue === "boolean") {
    return (
      <div
        className={cn(
          "flex items-start justify-between gap-4 py-3",
          isDirty && "bg-amber-50/40 rounded px-2 -mx-2"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
            <Label className="text-sm font-medium cursor-pointer" htmlFor={`setting-${label}`}>
              {label}
            </Label>
            <SourceBadge source={setting.source} />
            {setting.restartRequired && <RestartBadge />}
            {isDirty && (
              <span
                style={{
                  background: "hsl(var(--primary) / 0.1)",
                  color: "hsl(var(--primary))",
                  border: "1px solid hsl(var(--primary) / 0.3)",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                Modified
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        <div className="shrink-0 pt-0.5">
          <InlineSwitch
            id={`setting-${label}`}
            checked={currentValue}
            onChange={(v) => onChange?.(v)}
          />
        </div>
      </div>
    );
  }

  // String array (outbound_fetch_allowlist)
  if (Array.isArray(currentValue)) {
    const textValue = currentValue.join("\n");
    return (
      <div
        className={cn(
          "py-3",
          isDirty && "bg-amber-50/40 rounded px-2 -mx-2"
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <Label className="text-sm font-medium" htmlFor={`setting-${label}`}>
            {label}
          </Label>
          <SourceBadge source={setting.source} />
          {setting.restartRequired && <RestartBadge />}
          {isDirty && (
            <span
              style={{
                background: "hsl(var(--primary) / 0.1)",
                color: "hsl(var(--primary))",
                border: "1px solid hsl(var(--primary) / 0.3)",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              Modified
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mb-1.5">{description}</p>
        )}
        <Textarea
          id={`setting-${label}`}
          rows={3}
          className="text-xs font-mono resize-none"
          placeholder="One entry per line (or leave blank to allow all)"
          value={textValue}
          onChange={(e) => {
            const lines = e.target.value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            onChange?.(lines);
          }}
        />
        <p className="mt-1 text-xs text-muted-foreground">One hostname or URL prefix per line.</p>
      </div>
    );
  }

  // Number / string inputs
  const isNumber = typeof setting.value === "number";
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-3",
        isDirty && "bg-amber-50/40 rounded px-2 -mx-2"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          <Label className="text-sm font-medium" htmlFor={`setting-${label}`}>
            {label}
          </Label>
          <SourceBadge source={setting.source} />
          {setting.restartRequired && <RestartBadge />}
          {isDirty && (
            <span
              style={{
                background: "hsl(var(--primary) / 0.1)",
                color: "hsl(var(--primary))",
                border: "1px solid hsl(var(--primary) / 0.3)",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
              }}
            >
              Modified
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="shrink-0 w-36">
        <Input
          id={`setting-${label}`}
          type={isNumber ? "number" : "text"}
          min={isNumber ? 0 : undefined}
          className="h-8 text-sm w-full"
          value={String(currentValue)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return; // don't update state when field is cleared
            onChange?.(isNumber ? Number(raw) : raw);
          }}
        />
      </div>
    </div>
  );
}
