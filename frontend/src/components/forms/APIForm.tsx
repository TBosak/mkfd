import { useState } from "react";
import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
  Controller,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, Server, Globe } from "lucide-react";
import { Section } from "@/components/builder/Section";
import { KeyValueManager } from "./KeyValueManager";
import { ProtectedKeyValueEditor } from "@/components/protected-value/ProtectedKeyValueEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type RawConfigValue =
  | string
  | { type: "protected"; value: string }
  | { type: "env"; value: string; prefix?: string };

function kvArrayToRecord(arr: { key: string; value: string }[] | undefined): Record<string, RawConfigValue> {
  if (!arr) return {};
  return Object.fromEntries(arr.map((item) => [item.key, item.value]));
}

function recordToKvArray(record: Record<string, RawConfigValue>): { key: string; value: string }[] {
  return Object.entries(record).map(([key, val]) => ({
    key,
    value: typeof val === "string" ? val : val.value,
  }));
}

function APIHeadersEditor({
  field,
  label,
  addButtonLabel,
}: {
  field: { value: { key: string; value: string }[] | undefined; onChange: (v: { key: string; value: string }[]) => void };
  label: string;
  addButtonLabel: string;
}) {
  const [richState, setRichState] = useState<Record<string, RawConfigValue>>(() =>
    kvArrayToRecord(field.value),
  );

  function handleChange(record: Record<string, RawConfigValue>) {
    setRichState(record);
    field.onChange(recordToKvArray(record));
  }

  return (
    <ProtectedKeyValueEditor
      label={label}
      value={richState}
      onChange={handleChange}
      addButtonLabel={addButtonLabel}
    />
  );
}

interface APIFormProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
  activeSection?: string;
}

export const APIForm = ({ register, control, setValue, watch, activeSection }: APIFormProps) => {
  const apiMethod = watch("apiMethod");
  const show = (id: string) => !activeSection || activeSection === id;

  return (
    <div className="space-y-6 mt-4">
      {/* Endpoint section */}
      {show("endpoint") && (
        <Section
          icon={<Server className="h-4 w-4" />}
          title="Endpoint"
          sub="Request URL, method, and query parameters"
        >
          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="feedUrl" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Base URL
            </Label>
            <Input
              id="feedUrl"
              {...register("feedUrl")}
              placeholder="https://api.example.com"
            />
          </div>

          {/* API Route */}
          <div className="space-y-2">
            <Label htmlFor="apiRoute">API Route (e.g. "/dog/breeds")</Label>
            <Input
              id="apiRoute"
              {...register("apiRoute")}
              placeholder="/api/endpoint"
            />
          </div>

          {/* HTTP Method */}
          <div className="space-y-2">
            <Label htmlFor="apiMethod">HTTP Method</Label>
            <Select
              value={apiMethod || "GET"}
              onValueChange={(value) => setValue("apiMethod", value as any)}
            >
              <SelectTrigger>
                <SelectValue placeholder="GET" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GET">GET</SelectItem>
                <SelectItem value="POST">POST</SelectItem>
                <SelectItem value="PUT">PUT</SelectItem>
                <SelectItem value="DELETE">DELETE</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Query Parameters */}
          <KeyValueManager
            control={control}
            name="apiParams"
            label="Query Parameters"
            addButtonLabel="Add Parameter"
            keyPlaceholder="param_name"
            valuePlaceholder="value"
          />
        </Section>
      )}

      {/* Headers section */}
      {show("headers") && (
        <Section
          icon={<Server className="h-4 w-4" />}
          title="Headers & Body"
          sub="Request headers and optional request body fields"
        >
          {/* Headers */}
          <Controller
            control={control}
            name="apiHeaders"
            render={({ field }) => (
              <APIHeadersEditor
                field={field}
                label="HTTP Headers"
                addButtonLabel="Add Header"
              />
            )}
          />

          {/* Request Body */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--wb-outline)" }}>
            <Controller
              control={control}
              name="apiBody"
              render={({ field }) => (
                <APIHeadersEditor
                  field={field}
                  label="Request Body"
                  addButtonLabel="Add Body Field"
                />
              )}
            />
          </div>
        </Section>
      )}

      {/* Mapping section */}
      {show("mapping") && (
        <Section
          icon={<Link className="h-4 w-4" />}
          title="Response Mapping"
          sub="Map JSON paths to feed item fields"
        >
          {/* Items Path */}
          <div className="space-y-2">
            <Label htmlFor="apiItemsPath">Items Path (e.g., 'data.items')</Label>
            <Input
              id="apiItemsPath"
              {...register("apiItemsPath")}
              placeholder="data.items"
            />
          </div>

          {/* Basic Fields */}
          <div className="space-y-2">
            <Label htmlFor="apiTitleField">Title Field</Label>
            <Input
              id="apiTitleField"
              {...register("apiTitleField")}
              placeholder="title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiDescriptionField">Description Field</Label>
            <Input
              id="apiDescriptionField"
              {...register("apiDescriptionField")}
              placeholder="description"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiLinkField">Link Field</Label>
            <Input
              id="apiLinkField"
              {...register("apiLinkField")}
              placeholder="url"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiDateField">Date Field</Label>
            <Input
              id="apiDateField"
              {...register("apiDateField")}
              placeholder="pubDate"
            />
          </div>

          {/* Additional item fields */}
          <div className="pt-2 border-t space-y-4" style={{ borderColor: "var(--wb-outline)" }}>
            <p className="workbench-label">Additional Item Fields</p>
            <div className="space-y-2">
              <Label htmlFor="apiAuthor">Author Field</Label>
              <Input id="apiAuthor" {...register("apiAuthor")} placeholder="author" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiEnclosureUrl">Enclosure URL JSON Path</Label>
              <Input id="apiEnclosureUrl" {...register("apiEnclosureUrl")} placeholder="image.url" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiEnclosureSize">Enclosure Size JSON Path</Label>
              <Input id="apiEnclosureSize" {...register("apiEnclosureSize")} placeholder="image.size" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiEnclosureType">Enclosure Type JSON Path</Label>
              <Input id="apiEnclosureType" {...register("apiEnclosureType")} placeholder="image.type" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiContentEncoded">Content Encoded JSON Path</Label>
              <Input id="apiContentEncoded" {...register("apiContentEncoded")} placeholder="content" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiSummary">Summary JSON Path</Label>
              <Input id="apiSummary" {...register("apiSummary")} placeholder="summary" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiGuid">GUID JSON Path</Label>
              <Input id="apiGuid" {...register("apiGuid")} placeholder="id" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiCategories">Categories JSON Path</Label>
              <Input id="apiCategories" {...register("apiCategories")} placeholder="categories" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiContributors">Contributors JSON Path</Label>
              <Input id="apiContributors" {...register("apiContributors")} placeholder="contributors" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiLat">Latitude JSON Path</Label>
              <Input id="apiLat" {...register("apiLat")} placeholder="location.lat" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiLong">Longitude JSON Path</Label>
              <Input id="apiLong" {...register("apiLong")} placeholder="location.long" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiSourceUrl">Source URL JSON Path</Label>
              <Input id="apiSourceUrl" {...register("apiSourceUrl")} placeholder="source.url" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiSourceTitle">Source Title JSON Path</Label>
              <Input id="apiSourceTitle" {...register("apiSourceTitle")} placeholder="source.title" />
            </div>
          </div>

          {/* Feed-level fields */}
          <div className="pt-2 border-t space-y-4" style={{ borderColor: "var(--wb-outline)" }}>
            <p className="workbench-label">Feed Level Information</p>
            <div className="space-y-2">
              <Label htmlFor="apiFeedTitle">Feed Title JSON Path</Label>
              <Input id="apiFeedTitle" {...register("apiFeedTitle")} placeholder="feed.title" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiFeedDescription">Feed Description JSON Path</Label>
              <Input id="apiFeedDescription" {...register("apiFeedDescription")} placeholder="feed.description" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiFeedLanguage">Feed Language JSON Path</Label>
              <Input id="apiFeedLanguage" {...register("apiFeedLanguage")} placeholder="feed.language" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiFeedCopyright">Feed Copyright JSON Path</Label>
              <Input id="apiFeedCopyright" {...register("apiFeedCopyright")} placeholder="feed.copyright" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiFeedImageUrl">Feed Image URL JSON Path</Label>
              <Input id="apiFeedImageUrl" {...register("apiFeedImageUrl")} placeholder="feed.image" />
            </div>
          </div>
        </Section>
      )}
    </div>
  );
};
