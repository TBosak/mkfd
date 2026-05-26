import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { FolderOpen } from "lucide-react";

export function FilesystemForm({ register, setValue, watch }: any) {
  return (
    <Section icon={<FolderOpen className="h-4 w-4" />} title="Filesystem" sub="Scan a mounted folder for matching files">
      <Field label="Root Path" htmlFor="filesystemRootPath" required>
        <Input id="filesystemRootPath" {...register("filesystemRootPath", { required: true })} placeholder="/data/documents" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Include Patterns" htmlFor="filesystemInclude">
          <Input id="filesystemInclude" {...register("filesystemInclude")} placeholder="*.pdf,*.md" />
        </Field>
        <Field label="Exclude Patterns" htmlFor="filesystemExclude">
          <Input id="filesystemExclude" {...register("filesystemExclude")} placeholder="*.tmp" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={watch("filesystemRecursive") !== false} onCheckedChange={(v) => setValue("filesystemRecursive", v === true)} />
        Scan recursively
      </label>
    </Section>
  );
}
