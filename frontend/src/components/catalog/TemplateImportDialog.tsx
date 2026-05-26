import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TemplateVariableField } from "./TemplateVariableField";
import { SecretTemplateVariableField } from "./SecretTemplateVariableField";

type Template = {
  variables: Record<string, { label: string; type: string; required?: boolean; description?: string; placeholder?: string }>;
};

type Props = {
  template: Template;
  values?: Record<string, unknown>;
  secretStorage?: Record<string, "protected" | "env" | "plain">;
  onValuesChange?: (values: Record<string, unknown>) => void;
  onSecretStorageChange?: (storage: Record<string, "protected" | "env" | "plain">) => void;
  onImport: (values: Record<string, unknown>, secretStorage: Record<string, "protected" | "env" | "plain">) => void;
  submitLabel?: string;
};

export function TemplateImportDialog({
  template,
  values: controlledValues,
  secretStorage: controlledSecretStorage,
  onValuesChange,
  onSecretStorageChange,
  onImport,
  submitLabel = "Import Template",
}: Props) {
  const [localValues, setLocalValues] = useState<Record<string, unknown>>({});
  const [localSecretStorage, setLocalSecretStorage] = useState<Record<string, "protected" | "env" | "plain">>({});
  const values = controlledValues ?? localValues;
  const secretStorage = controlledSecretStorage ?? localSecretStorage;
  const setValues = (next: Record<string, unknown>) => {
    setLocalValues(next);
    onValuesChange?.(next);
  };
  const setSecretStorage = (next: Record<string, "protected" | "env" | "plain">) => {
    setLocalSecretStorage(next);
    onSecretStorageChange?.(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {Object.entries(template.variables).map(([name, variable]) => (
          variable.type === "secret" ? (
            <SecretTemplateVariableField
              key={name}
              name={name}
              variable={variable}
              value={values[name]}
              storage={secretStorage[name] ?? "protected"}
              onChange={(key, value) => setValues({ ...values, [key]: value })}
              onStorageChange={(key, storage) => setSecretStorage({ ...secretStorage, [key]: storage })}
            />
          ) : (
            <TemplateVariableField
              key={name}
              name={name}
              variable={variable}
              value={values[name]}
              onChange={(key, value) => setValues({ ...values, [key]: value })}
            />
          )
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={() => onImport(values, secretStorage)}>{submitLabel}</Button>
      </div>
    </div>
  );
}
