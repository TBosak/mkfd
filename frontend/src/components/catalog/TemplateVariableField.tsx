import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

type Variable = {
  label: string;
  description?: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

type Props = {
  name: string;
  variable: Variable;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
};

export function TemplateVariableField({ name, variable, value, onChange }: Props) {
  const fieldId = `template-${name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={fieldId}>{variable.label}{variable.required ? " *" : ""}</Label>
      {variable.type === "textarea" ? (
        <Textarea
          id={fieldId}
          value={String(value ?? "")}
          placeholder={variable.placeholder}
          onChange={(event) => onChange(name, event.target.value)}
          rows={3}
        />
      ) : variable.type === "select" ? (
        <Select value={String(value ?? "")} onValueChange={(next) => onChange(name, next)}>
          <SelectTrigger id={fieldId}>
            <SelectValue placeholder={variable.placeholder ?? "Select value"} />
          </SelectTrigger>
          <SelectContent>
            {(variable.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : variable.type === "boolean" ? (
        <div className="flex h-9 items-center gap-2 rounded-md border px-3">
          <Checkbox
            id={fieldId}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(name, checked === true)}
          />
          <span className="text-sm text-muted-foreground">{variable.placeholder ?? "Enabled"}</span>
        </div>
      ) : (
        <Input
          id={fieldId}
          type={variable.type === "number" ? "number" : variable.type === "secret" ? "password" : "text"}
          value={String(value ?? "")}
          placeholder={variable.placeholder}
          onChange={(event) => onChange(name, variable.type === "number" ? Number(event.target.value) : event.target.value)}
        />
      )}
      {variable.description && <p className="text-xs text-muted-foreground">{variable.description}</p>}
    </div>
  );
}
