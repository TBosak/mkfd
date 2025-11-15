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
        <AccordionTrigger>
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
                  onCheckedChange={(checked) =>
                    setValue("advanced", checked as boolean)
                  }
                />
                <Label htmlFor="advanced">Use Advanced Scraping</Label>
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
