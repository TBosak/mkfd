import { Input } from "@/components/ui/input";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { Map } from "lucide-react";

export function SitemapForm({ register }: any) {
  return (
    <Section icon={<Map className="h-4 w-4" />} title="Sitemap" sub="Turn sitemap URLs into feed items">
      <Field label="Sitemap URL" htmlFor="sitemapUrl" required>
        <Input id="sitemapUrl" {...register("sitemapUrl", { required: true })} placeholder="https://example.com/sitemap.xml" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Max Items" htmlFor="sitemapMaxItems">
          <Input id="sitemapMaxItems" type="number" {...register("sitemapMaxItems", { valueAsNumber: true })} placeholder="50" />
        </Field>
        <Field label="Max URLs To Scan" htmlFor="sitemapMaxUrlsToScan">
          <Input id="sitemapMaxUrlsToScan" type="number" {...register("sitemapMaxUrlsToScan", { valueAsNumber: true })} placeholder="500" />
        </Field>
      </div>
    </Section>
  );
}
