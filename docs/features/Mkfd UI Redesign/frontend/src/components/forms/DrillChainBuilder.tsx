import {
  useFieldArray,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Plus, X, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useEffect } from "react";

interface DrillChainBuilderProps {
  fieldName: string;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  feedUrl?: string;
}

interface DrillChainItemProps {
  fieldName: string;
  index: number;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  feedUrl?: string;
  onRemove: () => void;
}

const DrillChainItem = ({
  fieldName,
  index,
  control,
  setValue,
  watch,
  feedUrl,
  onRemove,
}: DrillChainItemProps) => {
  const isRelative = watch(`${fieldName}DrillChain.${index}.isRelative` as any);
  const currentBaseUrl = watch(
    `${fieldName}DrillChain.${index}.baseUrl` as any,
  );

  // Auto-fill base URL when relative is enabled and feedUrl is available
  useEffect(() => {
    if (isRelative && feedUrl && !currentBaseUrl) {
      try {
        const url = new URL(feedUrl);
        const rootUrl = `${url.protocol}//${url.host}`;
        setValue(`${fieldName}DrillChain.${index}.baseUrl` as any, rootUrl);
      } catch (e) {
        // Invalid URL, don't auto-fill
      }
    }
  }, [isRelative, feedUrl, currentBaseUrl, fieldName, index, setValue]);

  return (
    <Card className="relative border-l-4 border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20">
      <CardContent className="pt-10 pb-4 px-4 space-y-3">
        {/* Step Number Badge */}
        <div className="absolute top-2 left-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold text-sm shadow-md">
          {index + 1}
        </div>

        {/* Step Label */}
        <div className="absolute top-3 left-12 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
          Step {index + 1}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 hover:bg-destructive/10 hover:text-destructive"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="space-y-2">
          <Label htmlFor={`${fieldName}DrillChain.${index}.selector`}>
            Selector
          </Label>
          <Input
            id={`${fieldName}DrillChain.${index}.selector`}
            {...control.register(
              `${fieldName}DrillChain.${index}.selector` as any,
            )}
            placeholder=".selector"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${fieldName}DrillChain.${index}.attribute`}>
            Attribute
          </Label>
          <Input
            id={`${fieldName}DrillChain.${index}.attribute`}
            {...control.register(
              `${fieldName}DrillChain.${index}.attribute` as any,
            )}
            placeholder="href, src, etc."
          />
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${fieldName}DrillChain.${index}.stripHtml`}
            checked={watch(`${fieldName}DrillChain.${index}.stripHtml` as any)}
            onCheckedChange={(checked) =>
              setValue(
                `${fieldName}DrillChain.${index}.stripHtml` as any,
                checked as boolean,
              )
            }
          />
          <Label htmlFor={`${fieldName}DrillChain.${index}.stripHtml`}>
            Strip HTML?
          </Label>
        </div>

        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${fieldName}DrillChain.${index}.isRelative`}
            checked={isRelative}
            onCheckedChange={(checked) =>
              setValue(
                `${fieldName}DrillChain.${index}.isRelative` as any,
                checked as boolean,
              )
            }
          />
          <Label htmlFor={`${fieldName}DrillChain.${index}.isRelative`}>
            Relative?
          </Label>
        </div>

        {isRelative && (
          <div className="space-y-2">
            <Label htmlFor={`${fieldName}DrillChain.${index}.baseUrl`}>
              Base URL
            </Label>
            <Input
              id={`${fieldName}DrillChain.${index}.baseUrl`}
              {...control.register(
                `${fieldName}DrillChain.${index}.baseUrl` as any,
              )}
              placeholder="https://example.com"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const DrillChainBuilder = ({
  fieldName,
  control,
  setValue,
  watch,
  feedUrl,
}: DrillChainBuilderProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `${fieldName}DrillChain` as any,
  });

  const handleAddStep = () => {
    append({
      selector: "",
      attribute: "",
      isRelative: false,
      baseUrl: "",
      stripHtml: false,
    } as any);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center gap-2">
        <Label className="font-bold">
          {fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Drill Chain
          (Optional)
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground" />
          </TooltipTrigger>
          <TooltipContent>
            Use this to extract content that requires following links. Each step
            selects an element and (optionally) follows it to fetch the next
            layer.
          </TooltipContent>
        </Tooltip>
      </div>

      {fields.map((field, index) => (
        <div key={field.id} className="relative">
          <DrillChainItem
            fieldName={fieldName}
            index={index}
            control={control}
            setValue={setValue}
            watch={watch}
            feedUrl={feedUrl}
            onRemove={() => remove(index)}
          />
          {/* Connecting Arrow */}
          {index < fields.length - 1 && (
            <div className="flex items-center justify-center py-2">
              <div className="text-blue-500 font-bold text-2xl">↓</div>
            </div>
          )}
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={handleAddStep}
        className="w-full border-2 border-dashed border-blue-400 text-blue-600 hover:bg-blue-50 hover:border-blue-600 dark:hover:bg-blue-950"
      >
        <Plus className="mr-2 h-4 w-4" />
        Add Chain Step
      </Button>
    </div>
  );
};
