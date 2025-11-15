import { useFieldArray, Control } from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, X, Cookie } from "lucide-react";

interface CookiesManagerProps {
  control: Control<FeedFormData>;
}

export const CookiesManager = ({ control }: CookiesManagerProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "cookies",
  });

  const handleAddCookie = () => {
    append({ name: "", value: "" });
  };

  return (
    <div className="space-y-4">
      <Label className="font-bold">Cookies</Label>

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
                <Label htmlFor={`cookies.${index}.name`}>Cookie Name</Label>
                <Input
                  id={`cookies.${index}.name`}
                  {...control.register(`cookies.${index}.name`)}
                  placeholder="cookie_name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor={`cookies.${index}.value`}>Cookie Value</Label>
                <Input
                  id={`cookies.${index}.value`}
                  {...control.register(`cookies.${index}.value`)}
                  placeholder="cookie_value"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={handleAddCookie}
        className="w-full"
      >
        <Plus className="mr-2 h-4 w-4" />
        <Cookie className="mr-2 h-4 w-4" />
        Add Cookie
      </Button>
    </div>
  );
};
