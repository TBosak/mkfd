import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { Webhook } from "lucide-react";

export function WebhookFeedForm({ register, setValue, watch }: any) {
  const slug = watch("webhookSlug") || "my-events";
  return (
    <Section icon={<Webhook className="h-4 w-4" />} title="Incoming Webhook" sub="Receive JSON events and publish them as a feed">
      <Field label="Slug" htmlFor="webhookSlug" required>
        <Input id="webhookSlug" {...register("webhookSlug", { required: true })} placeholder="my-events" />
      </Field>
      <Field label="Bearer Token" htmlFor="webhookToken" required>
        <Input id="webhookToken" {...register("webhookToken")} placeholder="Leave blank to generate at save time" />
      </Field>
      <pre className="overflow-auto rounded-md border bg-muted/30 p-3 text-xs">
        {`curl -X POST /webhook-feeds/${slug} -H "Authorization: Bearer $TOKEN" -d '{"title":"Hello"}'`}
      </pre>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={Boolean(watch("webhookStoreRawPayload"))} onCheckedChange={(v) => setValue("webhookStoreRawPayload", v === true)} />
        Store raw payload
      </label>
    </Section>
  );
}
