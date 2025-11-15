import { useState } from "react";
import { useForm } from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WebScrapingForm } from "./WebScrapingForm";
import { APIForm } from "./APIForm";
import { EmailForm } from "./EmailForm";
import { AdditionalOptions } from "./AdditionalOptions";
import { FeedPreview } from "./FeedPreview";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Eye, Rocket, Globe, Code, Mail, Tag, Settings } from "lucide-react";

export const FeedBuilderForm = () => {
  const [feedType, setFeedType] = useState<"webScraping" | "api" | "email">(
    "webScraping",
  );
  const [showPreview, setShowPreview] = useState(false);
  const [previewXml, setPreviewXml] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    control,
    getValues,
    formState: { errors },
  } = useForm<FeedFormData>({
    defaultValues: {
      feedType: "webScraping",
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
    },
  });

  const feedUrl = watch("feedUrl");

  const onSubmit = async (data: FeedFormData) => {
    console.log("Form data being submitted:", data);
    setIsSubmitting(true);
    try {
      const response = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        alert("Feed created successfully!");
        window.location.reload();
      } else {
        alert("Error creating feed");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Error creating feed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    // Get all form values, including unregistered fields (they'll be undefined)
    const formData = getValues();

    // Ensure all fields exist in the data object, even if empty
    const data = {
      ...formData,
      // Fill in any missing fields with empty strings/arrays
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

    console.log("Preview data being sent:", data);
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
      {/* Loading Overlays */}
      {isSubmitting && (
        <LoadingSpinner message="Creating your feed..." fullscreen />
      )}
      {isGeneratingPreview && (
        <LoadingSpinner message="Generating preview..." fullscreen />
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 animate-in">
        {/* Feed Name */}
        <div className="space-y-2 p-4 rounded-lg bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20">
          <Label htmlFor="feedName" className="flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Feed Name
          </Label>
          <Input
            id="feedName"
            {...register("feedName", { required: true })}
            placeholder="Enter feed name"
          />
          {errors.feedName && (
            <p className="text-sm text-destructive">Feed name is required</p>
          )}
        </div>

        {/* Feed Type Tabs */}
        <div className="space-y-2 p-4 rounded-lg bg-slate-50 dark:bg-slate-900/50">
          <Label className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Feed Type
          </Label>
          <Tabs
            value={feedType}
            onValueChange={(value) => {
              setFeedType(value as typeof feedType);
              setValue("feedType", value as typeof feedType);
            }}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger
                value="webScraping"
                className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-500 data-[state=active]:text-white"
              >
                <Globe className="mr-2 h-4 w-4" />
                Web Scraping
              </TabsTrigger>
              <TabsTrigger
                value="api"
                className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-500 data-[state=active]:text-white"
              >
                <Code className="mr-2 h-4 w-4" />
                REST API
              </TabsTrigger>
              <TabsTrigger
                value="email"
                className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-violet-500 data-[state=active]:text-white"
              >
                <Mail className="mr-2 h-4 w-4" />
                Email
              </TabsTrigger>
            </TabsList>

            <TabsContent value="webScraping">
              <WebScrapingForm
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
                feedUrl={feedUrl}
              />
            </TabsContent>

            <TabsContent value="api">
              <APIForm
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
              />
            </TabsContent>

            <TabsContent value="email">
              <EmailForm
                register={register}
                control={control}
                setValue={setValue}
                watch={watch}
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Additional Options */}
        <AdditionalOptions
          register={register}
          control={control}
          setValue={setValue}
          watch={watch}
          feedType={feedType}
        />

        {/* Submit Buttons */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePreview}
            className="flex-1 border-2 border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
            disabled={isGeneratingPreview || isSubmitting}
          >
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button
            type="submit"
            className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700"
            disabled={isSubmitting || isGeneratingPreview}
          >
            <Rocket className="mr-2 h-4 w-4" />
            Submit
          </Button>
        </div>

        {/* Feed Preview Dialog */}
        <FeedPreview
          open={showPreview}
          onOpenChange={setShowPreview}
          previewXml={previewXml}
        />
      </form>
    </>
  );
};
