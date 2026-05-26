import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { useState } from "react";
import { FeedFormData } from "@/types/feed";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlignLeft, CalendarDays, ExternalLink, FileCode2, Fingerprint, Info, Link, Paperclip, Type, User, Wand2 } from "lucide-react";
import { Section } from "@/components/builder/Section";
import { SelectorField } from "./SelectorField";
import { SelectorPlayground } from "./SelectorPlayground";

interface WebScrapingFormProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  feedUrl?: string;
  activeSection?: string;
}

export const WebScrapingForm = ({
  register,
  control,
  setValue,
  watch,
  feedUrl,
  activeSection,
}: WebScrapingFormProps) => {
  const dateFormat = watch("dateFormat");
  const extractionMode = watch("extractionMode") || "cssSelectors";
  const requestMode = watch("requestMode") || "simple";
  const [formDetectionStatus, setFormDetectionStatus] = useState<string>("");
  const show = (id: string) => !activeSection || activeSection === id;

  const detectForms = async () => {
    const url = watch("feedUrl");
    if (!url) return;
    setFormDetectionStatus("Checking forms...");
    try {
      const response = await fetch("/utils/detect-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Form detection failed");
      const form = body.forms?.[0];
      if (!form) {
        setFormDetectionStatus("No forms detected.");
        return;
      }
      setValue("requestMode", "form" as any);
      setValue("formMethod", form.method);
      setValue("formActionUrl", form.actionUrl);
      setValue("formEncoding", form.encoding);
      setValue("formFields" as any, (form.fields ?? []).filter((field: any) => !["submit", "button"].includes(field.type)).map((field: any) => ({ key: field.name, value: field.value ?? "" })));
      setFormDetectionStatus(`${body.forms.length} form${body.forms.length === 1 ? "" : "s"} detected. Top candidate applied.`);
    } catch (err: any) {
      setFormDetectionStatus(err?.message ?? "Form detection failed");
    }
  };

  return (
    <>
      <div className="space-y-6 mt-4">
        {/* Target URL — shown in basic section or when no section filter */}
        {show("basic") && (
          <Section
            icon={<Link className="h-4 w-4" />}
            title="Source"
            sub="Target page and selector discovery"
          >
            <div className="space-y-2">
              <Label htmlFor="feedUrl">Target URL</Label>
              <Input
                id="feedUrl"
                {...register("feedUrl")}
                placeholder="https://example.com"
              />
            </div>
            <div className="mt-4 space-y-3 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Request Mode</Label>
                  <p className="text-xs text-muted-foreground">Submit a detected form before scraping the result page.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={detectForms}>Detect forms</Button>
              </div>
              <Select value={requestMode} onValueChange={(value) => setValue("requestMode", value as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="simple">Simple fetch</SelectItem>
                  <SelectItem value="form">Submit form</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid gap-3 md:grid-cols-3">
                <Input {...register("proxyProfileId")} placeholder="Proxy profile ID" />
                <Input {...register("userAgentProfileId")} placeholder="User-agent profile ID" />
                <Input {...register("userAgentOverride")} placeholder="Per-feed User-Agent override" />
              </div>
              {requestMode === "form" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <Input {...register("formActionUrl")} placeholder="https://example.com/search" />
                  <Select value={watch("formMethod") || "GET"} onValueChange={(value) => setValue("formMethod", value as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GET">GET</SelectItem>
                      <SelectItem value="POST">POST</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={watch("formEncoding") || "application/x-www-form-urlencoded"} onValueChange={(value) => setValue("formEncoding", value as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="application/x-www-form-urlencoded">Form URL encoded</SelectItem>
                      <SelectItem value="application/json">JSON</SelectItem>
                      <SelectItem value="multipart/form-data">Multipart</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <Input {...register("formFields.0.key" as any)} placeholder="Field name" />
                    <Input {...register("formFields.0.value" as any)} placeholder="Value" />
                  </div>
                </div>
              )}
              {formDetectionStatus && <p className="text-xs text-muted-foreground">{formDetectionStatus}</p>}
            </div>
          </Section>
        )}

        {show("extract") && (
          <>
            <Section icon={<FileCode2 className="h-4 w-4" />} title="Extraction Mode" sub="Choose CSS selectors or Source Assistant JSON-LD mapping">
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Mode</Label>
                  <Select
                    value={extractionMode}
                    onValueChange={(value) => setValue("extractionMode", value as any)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cssSelectors">CSS selectors</SelectItem>
                      <SelectItem value="jsonLdPage">JSON-LD on page</SelectItem>
                      <SelectItem value="jsonLdWithCssFallback">JSON-LD with CSS fallback</SelectItem>
                      <SelectItem value="jsonLdDetailDrillChain">Drill Chain JSON-LD</SelectItem>
                      <SelectItem value="jsonLdDetailDrillChainWithCssFallback">Drill Chain JSON-LD with CSS fallback</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {extractionMode !== "cssSelectors" && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input {...register("jsonLdTitlePath")} placeholder="headline" />
                    <Input {...register("jsonLdDescriptionPath")} placeholder="description" />
                    <Input {...register("jsonLdLinkPath")} placeholder="url" />
                    <Input {...register("jsonLdDatePath")} placeholder="datePublished" />
                    <Input {...register("jsonLdAuthorPath")} placeholder="author.name" />
                    <Input {...register("jsonLdGuidPath")} placeholder="url" />
                  </div>
                )}
              </div>
            </Section>

            <h3 className="text-sm font-semibold mt-2 pb-2 border-b text-foreground flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              CSS Selectors for RSS Feed Items
              <span className="ml-auto">
                <SelectorPlayground
                  feedUrl={watch("feedUrl") as string | undefined}
                  setValue={setValue}
                  flaresolverr={watch("flaresolverr")}
                />
              </span>
            </h3>

            {/* Item Iterator */}
            <div className="space-y-2">
              <Label htmlFor="itemSelector">Item Selector (Iterator)</Label>
              <Input
                id="itemSelector"
                {...register("itemSelector")}
                placeholder=".article"
              />
            </div>
          </>
        )}

        {show("extract") && (
          <>
            <Section icon={<Type className="h-4 w-4" />} title="Title" sub="Selector for item headline" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="title"
                label="Title"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showStripHtml
                showTitleCase
                showDrillChain
                stripHtmlDefault={true}
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<AlignLeft className="h-4 w-4" />} title="Description" sub="Selector for item body text" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="description"
                label="Description"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showStripHtml
                showTitleCase
                showDrillChain
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<ExternalLink className="h-4 w-4" />} title="Link" sub="Selector for item URL" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="link"
                label="Link"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showRelativeLink
                showDrillChain
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<Paperclip className="h-4 w-4" />} title="Enclosure" sub="Image, video, or audio attachment" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="enclosure"
                label="Enclosure"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showRelativeLink
                showDrillChain
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<User className="h-4 w-4" />} title="Author" sub="Selector for item author" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="author"
                label="Author"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showStripHtml
                showTitleCase
                showDrillChain
                stripHtmlDefault={true}
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<CalendarDays className="h-4 w-4" />} title="Date" sub="Selector for publish date" collapsible defaultOpen={false}>
              <div className="space-y-4">
                <SelectorField
                  fieldName="date"
                  label="Date"
                  register={register}
                  control={control}
                  setValue={setValue}
                  watch={watch}
                  showDrillChain
                  feedUrl={feedUrl}
                />
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="dateFormat">Date Format (optional)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Most common formats (e.g., Unix timestamps, ISO) are auto-detected. Only specify if needed.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={dateFormat || "auto"}
                    onValueChange={(value) => setValue("dateFormat", value === "auto" ? "" : value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto Detect" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto Detect</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="DD.MM.YYYY">DD.MM.YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                      <SelectItem value="MM.DD.YYYY">MM.DD.YYYY</SelectItem>
                      <SelectItem value="other">Other (specify)</SelectItem>
                    </SelectContent>
                  </Select>
                  {dateFormat === "other" && (
                    <div className="space-y-2">
                      <Label htmlFor="customDateFormat">Custom Date Format</Label>
                      <Input id="customDateFormat" {...register("customDateFormat")} placeholder="e.g. YYYY/MM/DD HH:mm" />
                    </div>
                  )}
                </div>
              </div>
            </Section>

            <Section icon={<FileCode2 className="h-4 w-4" />} title="Content Encoded" sub="Full article body (CDATA)" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="contentEncoded"
                label="Content Encoded"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showStripHtml
                showTitleCase
                showDrillChain
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<AlignLeft className="h-4 w-4" />} title="Summary" sub="Short excerpt or teaser" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="summary"
                label="Summary"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showStripHtml
                showTitleCase
                showDrillChain
                stripHtmlDefault={true}
                feedUrl={feedUrl}
              />
            </Section>

            <Section icon={<Fingerprint className="h-4 w-4" />} title="GUID" sub="Unique item identifier" collapsible defaultOpen={false}>
              <SelectorField
                fieldName="guid"
                label="GUID"
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                showDrillChain
                feedUrl={feedUrl}
              />
              <div className="flex items-center space-x-2 mt-4">
                <Checkbox
                  id="guidIsPermaLink"
                  checked={watch("guidIsPermaLink")}
                  onCheckedChange={(checked) => setValue("guidIsPermaLink", checked as boolean)}
                />
                <Label htmlFor="guidIsPermaLink">Is GUID a PermaLink?</Label>
              </div>
            </Section>
          </>
        )}
      </div>
    </>
  );
};
