import { TemplateVariableField } from "./TemplateVariableField";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type BaseProps = Parameters<typeof TemplateVariableField>[0];

type Props = BaseProps & {
  storage: "protected" | "env" | "plain";
  onStorageChange: (name: string, storage: "protected" | "env" | "plain") => void;
};

export function SecretTemplateVariableField(props: Props) {
  const { name, storage, onStorageChange, ...fieldProps } = props;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <TemplateVariableField {...fieldProps} name={name} />
      <div className="grid gap-1.5">
        <Label htmlFor={`template-${name}-storage`}>Secret storage</Label>
        <Select value={storage} onValueChange={(next) => onStorageChange(name, next as Props["storage"])}>
          <SelectTrigger id={`template-${name}-storage`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="protected">Encrypted</SelectItem>
            <SelectItem value="env">Environment variable name</SelectItem>
            <SelectItem value="plain">Plain text</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
