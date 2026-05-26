import { useState } from "react";
import { Control, UseFormRegister, UseFormSetValue, UseFormWatch, useFieldArray } from "react-hook-form";
import { Filter, Plus, Rss, Settings2, Sparkles, Trash2 } from "lucide-react";
import { FeedFormData } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { FieldRow } from "@/components/builder/FieldRow";

type Props = {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  activeSection?: string;
};

export function ExistingFeedTransformerForm({ register, control, setValue, watch, activeSection }: Props) {
  const show = (id: string) => !activeSection || activeSection === id;
  const { fields, append, remove } = useFieldArray({ control, name: "transformerSources" as any });
  const includeRules = useFieldArray({ control, name: "transformerFilterInclude" as any });
  const excludeRules = useFieldArray({ control, name: "transformerFilterExclude" as any });
  const [probeState, setProbeState] = useState<Record<number, string>>({});

  const appendRule = (mode: "include" | "exclude") => {
    const rule = { field: "title", type: "contains", value: "", caseSensitive: false };
    if (mode === "include") includeRules.append(rule as any);
    else excludeRules.append(rule as any);
  };

  const probeSource = async (index: number) => {
    const source = watch(`transformerSources.${index}` as any) as { url?: string; format?: string } | undefined;
    if (!source?.url) {
      setProbeState((current) => ({ ...current, [index]: "Add a source URL first." }));
      return;
    }
    setProbeState((current) => ({ ...current, [index]: "Checking..." }));
    try {
      const response = await fetch("/api/feeds/transformer/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url, format: source.format ?? "auto" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProbeState((current) => ({ ...current, [index]: body?.error ?? "Probe failed." }));
        return;
      }
      setProbeState((current) => ({
        ...current,
        [index]: `${body.detectedFormat ?? "feed"} source, ${body.itemCount ?? 0} items found.`,
      }));
    } catch {
      setProbeState((current) => ({ ...current, [index]: "Probe failed." }));
    }
  };

  const renderRules = (mode: "include" | "exclude") => {
    const array = mode === "include" ? includeRules : excludeRules;
    const baseName = mode === "include" ? "transformerFilterInclude" : "transformerFilterExclude";
    return (
      <div className="space-y-2">
        {array.fields.map((field, index) => (
          <div key={field.id} className="grid grid-cols-[130px_150px_1fr_92px_36px] gap-2">
            <Select
              value={watch(`${baseName}.${index}.field` as any) || "title"}
              onValueChange={(value) => setValue(`${baseName}.${index}.field` as any, value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="link">Link</SelectItem>
                <SelectItem value="description">Description</SelectItem>
                <SelectItem value="content">Content</SelectItem>
                <SelectItem value="author">Author</SelectItem>
                <SelectItem value="categories">Categories</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={watch(`${baseName}.${index}.type` as any) || "contains"}
              onValueChange={(value) => setValue(`${baseName}.${index}.type` as any, value)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">Contains</SelectItem>
                <SelectItem value="notContains">Does not contain</SelectItem>
                <SelectItem value="equals">Equals</SelectItem>
                <SelectItem value="startsWith">Starts with</SelectItem>
                <SelectItem value="endsWith">Ends with</SelectItem>
                <SelectItem value="regex">Regex</SelectItem>
              </SelectContent>
            </Select>
            <Input {...register(`${baseName}.${index}.value` as any)} placeholder="Match value" />
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${baseName}-${index}-case`}
                checked={Boolean(watch(`${baseName}.${index}.caseSensitive` as any))}
                onCheckedChange={(checked) => setValue(`${baseName}.${index}.caseSensitive` as any, Boolean(checked))}
              />
              <Label htmlFor={`${baseName}-${index}-case`} className="text-xs">Case</Label>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => array.remove(index)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" onClick={() => appendRule(mode)}>
          <Plus className="mr-2 h-4 w-4" />
          Add {mode} rule
        </Button>
      </div>
    );
  };

  return (
    <div className="mt-4 space-y-6">
      {show("sources") && (
        <Section icon={<Rss className="h-4 w-4" />} title="Sources" sub="Existing RSS, Atom, or JSON Feed URLs">
          <div className="space-y-3">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-[1fr_150px_112px_36px] gap-2">
                <Input
                  {...register(`transformerSources.${index}.url` as any)}
                  placeholder="https://example.com/feed.xml"
                />
                <Select
                  value={watch(`transformerSources.${index}.format` as any) || "auto"}
                  onValueChange={(value) => setValue(`transformerSources.${index}.format` as any, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="rss">RSS</SelectItem>
                    <SelectItem value="atom">Atom</SelectItem>
                    <SelectItem value="jsonFeed">JSON Feed</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={() => probeSource(index)}>
                  Preview
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                {probeState[index] && (
                  <p className="col-span-4 text-xs text-muted-foreground">{probeState[index]}</p>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => append({ url: "", format: "auto" } as any)}>
              <Plus className="mr-2 h-4 w-4" />
              Add source
            </Button>
          </div>
        </Section>
      )}

      {show("merge") && (
        <Section icon={<Settings2 className="h-4 w-4" />} title="Merge" sub="Ordering, deduplication, and item limits">
          <FieldRow>
            <Field label="Merge Strategy">
              <Select
                value={watch("transformerMergeStrategy") || "dateDesc"}
                onValueChange={(value) => setValue("transformerMergeStrategy", value as any)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dateDesc">Newest first</SelectItem>
                  <SelectItem value="dateAsc">Oldest first</SelectItem>
                  <SelectItem value="preserveOrder">Preserve source order</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Max Items" htmlFor="transformerMaxItems">
              <Input id="transformerMaxItems" type="number" min="1" {...register("transformerMaxItems" as any)} />
            </Field>
          </FieldRow>
          <div className="flex items-center gap-2">
            <Checkbox
              id="transformerDedupeAcrossSources"
              checked={watch("transformerDedupeAcrossSources") ?? true}
              onCheckedChange={(checked) => setValue("transformerDedupeAcrossSources", checked as boolean)}
            />
            <Label htmlFor="transformerDedupeAcrossSources">Dedupe items across sources</Label>
          </div>
        </Section>
      )}

      {show("transform") && (
        <Section icon={<Sparkles className="h-4 w-4" />} title="Transform" sub="Cleanup rules applied before publishing">
          <FieldRow>
            <Field label="GUID Strategy">
              <Select
                value={watch("transformerGuidStrategy") || "existingOrLinkHash"}
                onValueChange={(value) => setValue("transformerGuidStrategy", value as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">Existing GUID</SelectItem>
                  <SelectItem value="link">Link</SelectItem>
                  <SelectItem value="existingOrLinkHash">Existing or link hash</SelectItem>
                  <SelectItem value="titleLinkDateHash">Title/link/date hash</SelectItem>
                  <SelectItem value="contentHash">Content hash</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date Strategy">
              <Select
                value={watch("transformerDateStrategy") || "publishedOrUpdatedOrFetched"}
                onValueChange={(value) => setValue("transformerDateStrategy", value as any)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="publishedOrUpdated">Published or updated</SelectItem>
                  <SelectItem value="publishedOrUpdatedOrFetched">Published, updated, or fetched</SelectItem>
                  <SelectItem value="fetched">Fetched time</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldRow>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["transformerStripDescriptionHtml", "Strip description HTML"],
              ["transformerNormalizeWhitespace", "Normalize whitespace"],
              ["transformerForceHttps", "Force HTTPS links"],
              ["transformerRemoveTrackingParams", "Remove tracking parameters"],
              ["transformerNormalizeCategories", "Normalize categories"],
            ].map(([name, label]) => (
              <div key={name} className="flex items-center gap-2">
                <Checkbox
                  id={name}
                  checked={Boolean(watch(name as any))}
                  onCheckedChange={(checked) => setValue(name as any, Boolean(checked))}
                />
                <Label htmlFor={name}>{label}</Label>
              </div>
            ))}
          </div>
        </Section>
      )}

      {show("filters") && (
        <Section icon={<Filter className="h-4 w-4" />} title="Filters" sub="Include only relevant items and remove unwanted matches">
          <Field label="Exclude Rules">
            {renderRules("exclude")}
          </Field>
          <Field label="Include Rules">
            {renderRules("include")}
          </Field>
        </Section>
      )}

      {show("feed") && (
        <Section icon={<Rss className="h-4 w-4" />} title="Feed Metadata" sub="Optional output feed overrides">
          <Field label="Output Title">
            <Input {...register("transformerFeedTitle" as any)} placeholder="Merged feed title" />
          </Field>
          <Field label="Description">
            <Input {...register("transformerFeedDescription" as any)} placeholder="Description shown in generated feed" />
          </Field>
          <Field label="Link">
            <Input {...register("transformerFeedLink" as any)} placeholder="https://example.com" />
          </Field>
        </Section>
      )}
    </div>
  );
}
