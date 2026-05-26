import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CatalogMetadataForm } from "./CatalogMetadataForm";
import { CatalogSanitizedYamlPreview } from "./CatalogSanitizedYamlPreview";

type Props = {
  open: boolean;
  feedId: string;
  onOpenChange: (open: boolean) => void;
};

export function CatalogSubmissionDialog({ open, feedId, onOpenChange }: Props) {
  const [meta, setMeta] = useState({ title: "", description: "", category: "", tags: "", sourceHomepage: "" });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function preview() {
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/submission/${feedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...meta, tags: meta.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }),
      });
      setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Submit to Community Catalog</DialogTitle>
          <DialogDescription>Preview the sanitized catalog recipe before opening a pull request.</DialogDescription>
        </DialogHeader>
        <CatalogMetadataForm value={meta} onChange={setMeta} />
        <div className="flex justify-end">
          <Button type="button" onClick={preview} disabled={loading}>{loading ? "Checking..." : "Preview"}</Button>
        </div>
        <CatalogSanitizedYamlPreview yaml={result?.sanitizedYaml} errors={result?.errors} warnings={result?.warnings} />
      </DialogContent>
    </Dialog>
  );
}
