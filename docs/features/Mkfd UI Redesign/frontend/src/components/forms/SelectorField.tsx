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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { DrillChainBuilder } from "./DrillChainBuilder";
import { useEffect } from "react";

interface SelectorFieldProps {
  fieldName: string;
  label: string;
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  showStripHtml?: boolean;
  showTitleCase?: boolean;
  showRelativeLink?: boolean;
  showDrillChain?: boolean;
  stripHtmlDefault?: boolean;
  tooltip?: string;
  feedUrl?: string;
}

export const SelectorField = ({
  fieldName,
  label,
  register,
  control,
  setValue,
  watch,
  showStripHtml = false,
  showTitleCase = false,
  showRelativeLink = false,
  showDrillChain = false,
  stripHtmlDefault = false,
  tooltip,
  feedUrl,
}: SelectorFieldProps) => {
  const isRelative = watch(`${fieldName}RelativeLink` as any);
  const currentBaseUrl = watch(`${fieldName}BaseUrl` as any);

  // Auto-fill base URL when relative link is enabled and feedUrl is available
  useEffect(() => {
    if (isRelative && feedUrl && !currentBaseUrl) {
      try {
        const url = new URL(feedUrl);
        const rootUrl = `${url.protocol}//${url.host}`;
        setValue(`${fieldName}BaseUrl` as any, rootUrl);
      } catch (e) {
        // Invalid URL, don't auto-fill
      }
    }
  }, [isRelative, feedUrl, currentBaseUrl, fieldName, setValue]);

  return (
    <div className="space-y-4">
      {/* Selector */}
      <div className="space-y-2">
        <Label htmlFor={`${fieldName}Selector`}>{label} Selector</Label>
        <Input
          id={`${fieldName}Selector`}
          {...register(`${fieldName}Selector` as any)}
          placeholder=".selector"
        />
      </div>

      {/* Attribute */}
      <div className="space-y-2">
        <Label htmlFor={`${fieldName}Attribute`}>{label} Attribute</Label>
        <Input
          id={`${fieldName}Attribute`}
          {...register(`${fieldName}Attribute` as any)}
          placeholder="href, src, etc."
        />
      </div>

      {/* Iterator */}
      <div className="space-y-2">
        <Label htmlFor={`${fieldName}Iterator`}>
          {label} Parent Iterator (optional)
        </Label>
        <Input
          id={`${fieldName}Iterator`}
          {...register(`${fieldName}Iterator` as any)}
        />
      </div>

      {/* Strip HTML */}
      {showStripHtml && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${fieldName}StripHtml`}
            checked={watch(`${fieldName}StripHtml` as any)}
            onCheckedChange={(checked) =>
              setValue(`${fieldName}StripHtml` as any, checked as boolean)
            }
            defaultChecked={stripHtmlDefault}
          />
          <Label htmlFor={`${fieldName}StripHtml`}>Strip HTML in {label}</Label>
          {tooltip && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Title Case */}
      {showTitleCase && (
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${fieldName}TitleCase`}
            checked={watch(`${fieldName}TitleCase` as any)}
            onCheckedChange={(checked) =>
              setValue(`${fieldName}TitleCase` as any, checked as boolean)
            }
          />
          <Label htmlFor={`${fieldName}TitleCase`}>
            Convert {label} to Title Case
          </Label>
        </div>
      )}

      {/* Relative Link */}
      {showRelativeLink && (
        <>
          <div className="flex items-center space-x-2">
            <Checkbox
              id={`${fieldName}RelativeLink`}
              checked={isRelative}
              onCheckedChange={(checked) =>
                setValue(`${fieldName}RelativeLink` as any, checked as boolean)
              }
            />
            <Label htmlFor={`${fieldName}RelativeLink`}>Relative Link?</Label>
          </div>

          {isRelative && (
            <div className="space-y-2">
              <Label htmlFor={`${fieldName}BaseUrl`}>Base URL</Label>
              <Input
                id={`${fieldName}BaseUrl`}
                {...register(`${fieldName}BaseUrl` as any)}
                placeholder="https://example.com"
              />
            </div>
          )}
        </>
      )}

      {/* Drill Chain */}
      {showDrillChain && (
        <DrillChainBuilder
          fieldName={fieldName}
          control={control}
          setValue={setValue}
          watch={watch}
          feedUrl={feedUrl}
        />
      )}
    </div>
  );
};
