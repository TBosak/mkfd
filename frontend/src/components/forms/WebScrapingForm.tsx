import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info, Sparkles, Link, Wand2 } from "lucide-react";
import { SelectorField } from "./SelectorField";
import { SelectorPlayground } from "./SelectorPlayground";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface WebScrapingFormProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  feedUrl?: string;
}

export const WebScrapingForm = ({
  register,
  control,
  setValue,
  watch,
  feedUrl,
}: WebScrapingFormProps) => {
  const dateFormat = watch("dateFormat");
  const [isLoadingSelectors, setIsLoadingSelectors] = useState(false);

  const handleAutoFillSelectors = async () => {
    if (!feedUrl) {
      alert("Please enter a target URL first.");
      return;
    }

    setIsLoadingSelectors(true);
    try {
      const response = await fetch("/utils/suggest-selectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: feedUrl,
          flaresolverr: watch("flaresolverr")
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch selectors.");

      const selectors = await response.json();

      // Auto-fill all selectors
      setValue("itemSelector", selectors.iterator || "");
      setValue("titleSelector", selectors.title.selector || "");
      setValue("titleAttribute", selectors.title.attribute || "");
      setValue("descriptionSelector", selectors.description.selector || "");
      setValue("descriptionAttribute", selectors.description.attribute || "");
      setValue("linkSelector", selectors.link.selector || "");
      setValue("linkAttribute", selectors.link.attribute || "");
      setValue("linkBaseUrl", selectors.link.rootUrl || "");
      setValue("linkRelativeLink", selectors.link.relativeLink || false);
      setValue("enclosureSelector", selectors.enclosure.selector || "");
      setValue("enclosureAttribute", selectors.enclosure.attribute || "");
      setValue("dateSelector", selectors.date.selector || "");
      setValue("dateAttribute", selectors.date.attribute || "");
      setValue("authorSelector", selectors.author.selector || "");
      setValue("authorAttribute", selectors.author.attribute || "");

      alert("Selectors have been auto-filled successfully!");
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred while auto-filling selectors.");
    } finally {
      setIsLoadingSelectors(false);
    }
  };

  return (
    <>
      {isLoadingSelectors && (
        <LoadingSpinner
          fullscreen
          message="Analyzing page structure and suggesting selectors..."
        />
      )}
      <SelectorPlayground
        feedUrl={feedUrl}
        setValue={setValue}
        flaresolverr={watch("flaresolverr")}
      />
      <div className="space-y-6 mt-4">
        {/* Target URL */}
        <div className="space-y-2">
          <Label htmlFor="feedUrl" className="flex items-center gap-2">
            <Link className="h-4 w-4" />
            Target URL
          </Label>
          <Input
            id="feedUrl"
            {...register("feedUrl")}
            placeholder="https://example.com"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAutoFillSelectors}
            className="w-full"
            disabled={isLoadingSelectors}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {isLoadingSelectors ? "Analyzing..." : "Suggest Selectors"}
          </Button>
        </div>

        <h3 className="text-lg font-semibold mt-6 pb-2 border-b-2 border-gradient bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent flex items-center gap-2">
          <Wand2 className="h-5 w-5 text-blue-600" />
          CSS Selectors for RSS Feed Items
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

        {/* Title Field */}
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

        {/* Description in Accordion */}
        <Accordion type="multiple" className="w-full">
          <AccordionItem value="description">
            <AccordionTrigger>Description</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="link">
            <AccordionTrigger>Link</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="enclosure">
            <AccordionTrigger>Enclosure (Image, Video, Etc.)</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="author">
            <AccordionTrigger>Author</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="date">
            <AccordionTrigger>Date</AccordionTrigger>
            <AccordionContent>
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
                        Most common formats (e.g., Unix timestamps, ISO) are
                        auto-detected. Only specify if needed.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Select
                    value={dateFormat || "auto"}
                    onValueChange={(value) =>
                      setValue("dateFormat", value === "auto" ? "" : value)
                    }
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
                      <Label htmlFor="customDateFormat">
                        Custom Date Format
                      </Label>
                      <Input
                        id="customDateFormat"
                        {...register("customDateFormat")}
                        placeholder="e.g. YYYY/MM/DD HH:mm"
                      />
                    </div>
                  )}
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="contentEncoded">
            <AccordionTrigger>Content Encoded (CDATA)</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="summary">
            <AccordionTrigger>Summary/Excerpt</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="guid">
            <AccordionTrigger>GUID (Unique ID)</AccordionTrigger>
            <AccordionContent>
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
                  onCheckedChange={(checked) =>
                    setValue("guidIsPermaLink", checked as boolean)
                  }
                />
                <Label htmlFor="guidIsPermaLink">Is GUID a PermaLink?</Label>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Add more accordion items for other fields... */}
        </Accordion>
      </div>
    </>
  );
};
