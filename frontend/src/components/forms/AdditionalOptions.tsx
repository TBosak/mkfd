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
import { Textarea } from "@/components/ui/textarea";
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
import { Info, Settings2 } from "lucide-react";
import { CookiesManager } from "./CookiesManager";
import { WebhookConfiguration } from "./WebhookConfiguration";

interface AdditionalOptionsProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  feedType?: "webScraping" | "api" | "email";
}

export const AdditionalOptions = ({
  register,
  control,
  setValue,
  watch,
  feedType,
}: AdditionalOptionsProps) => {
  const isEmailFeed = feedType === "email";
  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="additional">
        <AccordionTrigger data-accordion-trigger="additional">
          <span className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Additional Options
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-6">
            {/* Cookies - Hide for email feeds */}
            {!isEmailFeed && <CookiesManager control={control} />}

            {/* Headers - Hide for email feeds */}
            {!isEmailFeed && (
              <div className="space-y-2">
                <Label htmlFor="headers">HTTP Headers (JSON format)</Label>
                <Textarea
                  id="headers"
                  {...register("headers")}
                  placeholder="{}"
                  rows={5}
                  defaultValue="{}"
                />
              </div>
            )}

            {/* Refresh Time */}
            <div className="space-y-2">
              <Label htmlFor="refreshTime">Refresh Time (minutes)</Label>
              <Input
                id="refreshTime"
                type="number"
                {...register("refreshTime")}
                min="1"
                defaultValue="5"
              />
            </div>

            {/* Reverse Order */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="reverse"
                checked={watch("reverse")}
                onCheckedChange={(checked) =>
                  setValue("reverse", checked as boolean)
                }
              />
              <Label htmlFor="reverse">Reverse Order</Label>
            </div>

            {/* Advanced Scraping - Hide for email feeds */}
            {!isEmailFeed && (
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="advanced"
                  checked={watch("advanced")}
                  disabled={watch("flaresolverr.enabled")}
                  onCheckedChange={(checked) => {
                    setValue("advanced", checked as boolean);
                    if (checked) {
                      setValue("flaresolverr.enabled", false);
                    }
                  }}
                />
                <Label htmlFor="advanced" className={watch("flaresolverr.enabled") ? "text-muted-foreground" : ""}>
                  Use Advanced Scraping
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Use for sites that lazy-load content. Launches a headless
                    browser for deeper scraping.
                  </TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* FlareSolverr - Hide for email feeds */}
            {!isEmailFeed && (
              <div id="flaresolverr-section" className="space-y-3 transition-all">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="flaresolverr.enabled"
                    checked={watch("flaresolverr.enabled")}
                    disabled={watch("advanced")}
                    onCheckedChange={(checked) => {
                      setValue("flaresolverr.enabled", checked as boolean);
                      if (checked) {
                        setValue("advanced", false);
                      }
                    }}
                  />
                  <Label htmlFor="flaresolverr.enabled" className={watch("advanced") ? "text-muted-foreground" : ""}>
                    Use FlareSolverr
                  </Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Use FlareSolverr to bypass Cloudflare and other bot
                      protection systems.
                    </TooltipContent>
                  </Tooltip>
                </div>

                {watch("flaresolverr.enabled") && (
                  <div className="ml-6 space-y-3">
                    <div className="space-y-2">
                      <Label htmlFor="flaresolverr.serverUrl">
                        FlareSolverr Server URL
                      </Label>
                      <Input
                        id="flaresolverr.serverUrl"
                        {...register("flaresolverr.serverUrl")}
                        placeholder="http://localhost:8191"
                        type="url"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="flaresolverr.timeout">
                        Timeout (milliseconds)
                      </Label>
                      <Input
                        id="flaresolverr.timeout"
                        {...register("flaresolverr.timeout")}
                        type="number"
                        min="1000"
                        defaultValue="60000"
                        placeholder="60000"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Strict Mode */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="strict"
                checked={watch("strict")}
                onCheckedChange={(checked) =>
                  setValue("strict", checked as boolean)
                }
              />
              <Label htmlFor="strict">Strict Mode</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  Reject feed items missing expected fields.
                </TooltipContent>
              </Tooltip>
            </div>

            <hr className="my-6" />

            {/* Webhook Configuration */}
            <WebhookConfiguration
              register={register}
              control={control}
              setValue={setValue}
              watch={watch}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};
