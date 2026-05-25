import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Link, Wand2 } from "lucide-react";
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
  const show = (id: string) => !activeSection || activeSection === id;

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
          </Section>
        )}

        {show("extract") && (
          <>
            <h3 className="text-sm font-semibold mt-2 pb-2 border-b text-foreground flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-primary" />
              CSS Selectors for RSS Feed Items
              <span className="ml-auto">
                <SelectorPlayground
                  feedUrl={feedUrl}
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

        {/* Title Field */}
        {show("extract") && (
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
        )}

        {show("extract") && (
          <>
            <Section title="Description" sub="Selector for item body text" collapsible defaultOpen={false}>
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

            <Section title="Link" sub="Selector for item URL" collapsible defaultOpen={false}>
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

            <Section title="Enclosure" sub="Image, video, or audio attachment" collapsible defaultOpen={false}>
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

            <Section title="Author" sub="Selector for item author" collapsible defaultOpen={false}>
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

            <Section title="Date" sub="Selector for publish date" collapsible defaultOpen={false}>
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

            <Section title="Content Encoded" sub="Full article body (CDATA)" collapsible defaultOpen={false}>
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

            <Section title="Summary" sub="Short excerpt or teaser" collapsible defaultOpen={false}>
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

            <Section title="GUID" sub="Unique item identifier" collapsible defaultOpen={false}>
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
