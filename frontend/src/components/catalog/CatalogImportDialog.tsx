import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TemplateImportDialog } from "./TemplateImportDialog";

type Props = {
  open: boolean;
  title: string;
  template?: { variables: Record<string, any> };
  importing: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (values?: Record<string, unknown>, secretStorage?: Record<string, "protected" | "env" | "plain">) => void;
};

export function CatalogImportDialog({ open, title, template, importing, onOpenChange, onImport }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [secretStorage, setSecretStorage] = useState<Record<string, "protected" | "env" | "plain">>({});

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import {title}</DialogTitle>
          <DialogDescription>
            Catalog imports are saved as local feed configs and can be edited after import.
          </DialogDescription>
        </DialogHeader>
        {template ? (
          <TemplateImportDialog
            template={template}
            values={values}
            secretStorage={secretStorage}
            onValuesChange={setValues}
            onSecretStorageChange={setSecretStorage}
            onImport={() => onImport(values, secretStorage)}
            submitLabel={importing ? "Importing..." : "Import"}
          />
        ) : (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={() => onImport()} disabled={importing}>{importing ? "Importing..." : "Import"}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
