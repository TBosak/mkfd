import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  value: {
    title: string;
    description: string;
    category: string;
    tags: string;
    sourceHomepage: string;
  };
  onChange: (value: Props["value"]) => void;
};

export function CatalogMetadataForm({ value, onChange }: Props) {
  const set = (key: keyof Props["value"], next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="catalog-title">Title</Label>
        <Input id="catalog-title" value={value.title} onChange={(event) => set("title", event.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="catalog-description">Description</Label>
        <Textarea id="catalog-description" value={value.description} onChange={(event) => set("description", event.target.value)} rows={3} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="catalog-category">Category</Label>
          <Input id="catalog-category" value={value.category} onChange={(event) => set("category", event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="catalog-tags">Tags</Label>
          <Input id="catalog-tags" value={value.tags} onChange={(event) => set("tags", event.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="catalog-homepage">Source Homepage</Label>
        <Input id="catalog-homepage" value={value.sourceHomepage} onChange={(event) => set("sourceHomepage", event.target.value)} />
      </div>
    </div>
  );
}
