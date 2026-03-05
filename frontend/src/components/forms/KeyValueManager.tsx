import { useFieldArray, Control, FieldArrayPath } from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X } from "lucide-react";

interface KeyValueManagerProps {
  control: Control<FeedFormData>;
  name: FieldArrayPath<FeedFormData>;
  label: string;
  addButtonLabel: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export const KeyValueManager = ({
  control,
  name,
  label,
  addButtonLabel,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
}: KeyValueManagerProps) => {
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <div className="space-y-4">
      <Label className="font-bold">{label}</Label>

      {fields.map((field, index) => (
        <Card key={field.id} className="relative">
          <CardContent className="pt-10 pb-4 px-4">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => remove(index)}
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${name}.${index}.key`}>Key</Label>
                <Input
                  id={`${name}.${index}.key`}
                  {...control.register(`${name}.${index}.key` as any)}
                  placeholder={keyPlaceholder}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${name}.${index}.value`}>Value</Label>
                <Input
                  id={`${name}.${index}.value`}
                  {...control.register(`${name}.${index}.value` as any)}
                  placeholder={valuePlaceholder}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() => append({ key: "", value: "" } as any)}
        className="w-full"
      >
        <Plus className="mr-2 h-4 w-4" />
        {addButtonLabel}
      </Button>
    </div>
  );
};
