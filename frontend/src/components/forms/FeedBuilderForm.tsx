import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useFeedDraft } from "@/hooks/useFeedDraft";
import { DraftRestoreDialog } from "./DraftRestoreDialog";
import { FeedFormData } from "@/types/feed";
import { buildFeedConfigFromFormData } from "@/lib/feed-config-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { WebScrapingForm } from "./WebScrapingForm";
import { APIForm } from "./APIForm";
import { EmailForm } from "./EmailForm";
import { AdditionalOptions } from "./AdditionalOptions";
import { FeedPreview } from "./FeedPreview";
import { FlareSolverrIndicator } from "./FlareSolverrIndicator";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Eye, Rocket, Globe, Code, Mail, Tag, Pencil, Lock, Save } from "lucide-react";

export interface FeedBuilderFormHandle {
  submit: () => void;
}

export interface FeedBuilderFormProps {
  mode?: "create" | "edit";
  feedId?: string;
  initialData?: Partial<FeedFormData>;
  selectedType?: FeedFormData["feedType"];
  activeSection?: string;
  onValuesChange?: (v: Partial<FeedFormData>) => void;
}

export const FeedBuilderForm = forwardRef<FeedBuilderFormHandle, FeedBuilderFormProps>(
  function FeedBuilderForm({ mode = "create", feedId, initialData, selectedType, activeSection, onValuesChange }, ref) {
    const navigate = useNavigate();
    const [feedType, setFeedType] = useState<"webScraping" | "api" | "email">(
      (selectedType as "webScraping" | "api" | "email" | undefined)
        ?? (initialData?.feedType as "webScraping" | "api" | "email")
        ?? "webScraping"
    );
    const [showPreview, setShowPreview] = useState(false);
    const [previewXml, setPreviewXml] = useState<string | undefined>();
    const [previewFeedConfig, setPreviewFeedConfig] = useState<Record<string, unknown> | undefined>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

    const defaultValues: Partial<FeedFormData> = {
      feedType: (selectedType as "webScraping" | "api" | "email" | undefined) ?? "webScraping",
      refreshTime: 5,
      emailCount: 10,
      reverse: false,
      advanced: false,
      strict: false,
      titleStripHtml: true,
      authorStripHtml: true,
      summaryStripHtml: true,
      webhook: {
        enabled: false,
        newItemsOnly: true,
      },
    };

    const {
      register,
      handleSubmit,
      watch,
      setValue,
      control,
      getValues,
      reset,
      formState: { errors },
    } = useForm<FeedFormData>({
      defaultValues: mode === "edit" && initialData
        ? { ...defaultValues, ...initialData }
        : defaultValues,
    });

    const feedUrl = watch("feedUrl");

    const activeFeedType = watch("feedType") ?? "webScraping";
    const show = (id: string) => !activeSection || activeSection === id;

    useEffect(() => {
      if (!selectedType || selectedType === feedType) return;
      setFeedType(selectedType as "webScraping" | "api" | "email");
      setValue("feedType", selectedType);
    }, [feedType, selectedType, setValue]);

    const draftKey = mode === "edit" && feedId
      ? `mkfd:draft:${feedId}`
      : `mkfd:draft:new:${activeFeedType}`;
    const { draft, saveDraft, clearDraft } = useFeedDraft(draftKey);
    const formValues = watch();
    useEffect(() => {
      saveDraft(formValues, activeFeedType, mode ?? "create", feedId);
    }, [formValues, activeFeedType, mode, feedId, saveDraft]);

    // Notify parent of value changes for preview
    useEffect(() => {
      onValuesChange?.(formValues);
    }, [formValues, onValuesChange]);

    const onSubmit = async (data: FeedFormData) => {
      setIsSubmitting(true);
      try {
        const url = mode === "edit" && feedId ? `/api/feeds/${feedId}` : "/";
        const method = mode === "edit" ? "PUT" : "POST";
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildFeedConfigFromFormData(data)),
        });

        if (response.ok) {
          const responseBody = await response.json().catch(() => null);
          const feedUrls = responseBody?.feedUrls;
          clearDraft();
          if (mode === "edit") {
            const msg = feedUrls
              ? `Feed updated successfully!\n\nFeed URLs:\nRSS 2.0: ${feedUrls.rss2}\nAtom: ${feedUrls.atom}\nJSON Feed: ${feedUrls.json}`
              : "Feed updated successfully!";
            alert(msg);
            navigate("/feeds");
          } else {
            const msg = feedUrls
              ? `Feed created successfully!\n\nFeed URLs:\nRSS 2.0: ${feedUrls.rss2}\nAtom: ${feedUrls.atom}\nJSON Feed: ${feedUrls.json}`
              : "Feed created successfully!";
            alert(msg);
            window.location.reload();
          }
        } else {
          const errorBody = await response.json().catch(() => null);
          const msg = errorBody?.errors?.map((e: { message: string }) => e.message).join("\n")
            ?? (mode === "edit" ? "Error updating feed" : "Error creating feed");
          alert(msg);
          return;
        }
      } catch (error) {
        console.error("Error:", error);
        alert(mode === "edit" ? "Error updating feed" : "Error creating feed");
      } finally {
        setIsSubmitting(false);
      }
    };

    // Expose submit handle
    useImperativeHandle(ref, () => ({
      submit: () => handleSubmit(onSubmit)(),
    }));

    const handlePreview = async () => {
      const formData = getValues();
      const data = {
        ...formData,
        descriptionSelector: formData.descriptionSelector || "",
        descriptionAttribute: formData.descriptionAttribute || "",
        linkSelector: formData.linkSelector || "",
        linkAttribute: formData.linkAttribute || "",
        enclosureSelector: formData.enclosureSelector || "",
        enclosureAttribute: formData.enclosureAttribute || "",
        authorSelector: formData.authorSelector || "",
        authorAttribute: formData.authorAttribute || "",
        dateSelector: formData.dateSelector || "",
        dateAttribute: formData.dateAttribute || "",
        contentEncodedSelector: formData.contentEncodedSelector || "",
        summarySelector: formData.summarySelector || "",
        guidSelector: formData.guidSelector || "",
        categoriesSelector: formData.categoriesSelector || "",
        contributorsSelector: formData.contributorsSelector || "",
        latSelector: formData.latSelector || "",
        longSelector: formData.longSelector || "",
        sourceUrlSelector: formData.sourceUrlSelector || "",
        sourceTitleSelector: formData.sourceTitleSelector || "",
      };

      setIsGeneratingPreview(true);
      try {
        const response = await fetch("/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (response.ok) {
          const rssFeedXml = await response.text();
          setPreviewXml(rssFeedXml);
          setPreviewFeedConfig(data as Record<string, unknown>);
          setShowPreview(true);
        } else {
          const errorText = await response.text();
          console.error("Preview error:", errorText);
          alert("Error generating preview");
        }
      } catch (error) {
        console.error("Error:", error);
        alert("Error generating preview");
      } finally {
        setIsGeneratingPreview(false);
      }
    };

    return (
      <>
        <DraftRestoreDialog
          draft={draft}
          onRestore={() => { reset(draft!.data as FeedFormData); clearDraft(); }}
          onDiscard={clearDraft}
        />
        {/* Loading Overlays */}
        {isSubmitting && (
          <LoadingSpinner
            message={mode === "edit" ? "Updating your feed..." : "Creating your feed..."}
            fullscreen
          />
        )}
        {isGeneratingPreview && (
          <LoadingSpinner message="Generating preview..." fullscreen />
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 animate-in">
          {/* Edit Mode Banner */}
          {mode === "edit" && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3">
              <Pencil className="h-5 w-5 text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-foreground">
                  Editing Existing Feed
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                  {feedId}
                </p>
              </div>
            </div>
          )}

          {show("basic") && (
            <Section
              icon={<Tag className="h-4 w-4" />}
              title="Basic"
              sub="Name and source type"
              right={
                <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                  {feedType === "webScraping" && <Globe className="h-3.5 w-3.5" />}
                  {feedType === "api" && <Code className="h-3.5 w-3.5" />}
                  {feedType === "email" && <Mail className="h-3.5 w-3.5" />}
                  {feedType === "webScraping" ? "Web Scraping" : feedType === "api" ? "REST API" : "Email"}
                  {mode === "edit" && <Lock className="h-3 w-3 opacity-70" />}
                </span>
              }
            >
              <Field label="Feed Name" htmlFor="feedName" required>
                <Input
                  id="feedName"
                  {...register("feedName", { required: true })}
                  placeholder="Enter feed name"
                />
                {errors.feedName && (
                  <p className="mt-1 text-sm text-destructive">Feed name is required</p>
                )}
              </Field>
            </Section>
          )}

          {feedType === "webScraping" && (
            <WebScrapingForm
              register={register}
              control={control}
              setValue={setValue}
              watch={watch}
              feedUrl={feedUrl}
              activeSection={activeSection}
            />
          )}

          {feedType === "api" && (
            <APIForm
              register={register}
              control={control}
              setValue={setValue}
              watch={watch}
              activeSection={activeSection}
            />
          )}

          {feedType === "email" && (
            <EmailForm
              register={register}
              control={control}
              setValue={setValue}
              watch={watch}
              activeSection={activeSection}
            />
          )}

          {/* Additional Options */}
          <AdditionalOptions
            register={register}
            control={control}
            setValue={setValue}
            watch={watch}
            feedType={feedType}
            activeSection={activeSection}
          />

          {/* Submit Buttons */}
          {show("output") && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handlePreview}
              className="flex-1"
              disabled={isGeneratingPreview || isSubmitting}
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isSubmitting || isGeneratingPreview}
            >
              {mode === "edit" ? (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Update Feed
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Submit
                </>
              )}
            </Button>
          </div>
          )}

          {/* Feed Preview Dialog */}
          <FeedPreview
            open={showPreview}
            onOpenChange={setShowPreview}
            previewXml={previewXml}
            feedConfig={previewFeedConfig}
          />
        </form>

        {/* FlareSolverr Status Indicator */}
        <FlareSolverrIndicator watch={watch} feedType={feedType} />
      </>
    );
  }
);
