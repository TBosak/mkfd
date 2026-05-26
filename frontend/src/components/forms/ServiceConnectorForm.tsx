import { Input } from "@/components/ui/input";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { Link2 } from "lucide-react";

export function ServiceConnectorForm({ register }: any) {
  return (
    <Section icon={<Link2 className="h-4 w-4" />} title="Service Connector" sub="Jellyfin latest-items feed">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Service" htmlFor="serviceConnectorService">
          <Input id="serviceConnectorService" {...register("serviceConnectorService")} placeholder="jellyfin" />
        </Field>
        <Field label="Preset" htmlFor="serviceConnectorPreset">
          <Input id="serviceConnectorPreset" {...register("serviceConnectorPreset")} placeholder="latestItems" />
        </Field>
      </div>
      <Field label="Jellyfin Server URL" htmlFor="serviceConnectorServerUrl" required>
        <Input id="serviceConnectorServerUrl" {...register("serviceConnectorServerUrl", { required: true })} placeholder="https://jellyfin.example.com" />
      </Field>
      <Field label="API Key" htmlFor="serviceConnectorApiKey" required>
        <Input id="serviceConnectorApiKey" type="password" {...register("serviceConnectorApiKey")} placeholder="Jellyfin API key" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Library ID" htmlFor="serviceConnectorResourceId" required>
          <Input id="serviceConnectorResourceId" {...register("serviceConnectorResourceId", { required: true })} placeholder="library id" />
        </Field>
        <Field label="Limit" htmlFor="serviceConnectorLimit">
          <Input id="serviceConnectorLimit" type="number" {...register("serviceConnectorLimit", { valueAsNumber: true })} placeholder="50" />
        </Field>
      </div>
    </Section>
  );
}
