import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Section } from "@/components/builder/Section";
import { Field } from "@/components/builder/Field";
import { Boxes } from "lucide-react";

export function GraphQLForm({ register }: any) {
  return (
    <Section icon={<Boxes className="h-4 w-4" />} title="GraphQL" sub="Query GraphQL APIs and map arrays to feed items">
      <Field label="Endpoint" htmlFor="graphqlEndpoint" required>
        <Input id="graphqlEndpoint" {...register("graphqlEndpoint", { required: true })} placeholder="https://api.example.com/graphql" />
      </Field>
      <Field label="Query" htmlFor="graphqlQuery" required>
        <Textarea id="graphqlQuery" {...register("graphqlQuery", { required: true })} rows={7} placeholder="query { posts { nodes { title url publishedAt } } }" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Item Path" htmlFor="graphqlItemPath">
          <Input id="graphqlItemPath" {...register("graphqlItemPath")} placeholder="data.posts.nodes" />
        </Field>
        <Field label="Title Path" htmlFor="graphqlTitlePath">
          <Input id="graphqlTitlePath" {...register("graphqlTitlePath")} placeholder="title" />
        </Field>
      </div>
    </Section>
  );
}
