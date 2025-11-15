import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link, Server, Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface APIFormProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
}

export const APIForm = ({ register, setValue, watch }: APIFormProps) => {
  const apiMethod = watch("apiMethod");

  return (
    <div className="space-y-6 mt-4">
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

      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Server className="h-5 w-5" />
        API Configuration
      </h3>

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
      <div className="space-y-2">
        <Label htmlFor="apiParams">Query Parameters (JSON format)</Label>
        <Textarea
          id="apiParams"
          {...register("apiParams")}
          placeholder="{}"
          rows={5}
          defaultValue="{}"
        />
      </div>

      {/* Headers */}
      <div className="space-y-2">
        <Label htmlFor="apiHeaders">HTTP Headers (JSON format)</Label>
        <Textarea
          id="apiHeaders"
          {...register("apiHeaders")}
          placeholder="{}"
          rows={5}
          defaultValue="{}"
        />
      </div>

      {/* Request Body */}
      <div className="space-y-2">
        <Label htmlFor="apiBody">Request Body (JSON format)</Label>
        <Textarea
          id="apiBody"
          {...register("apiBody")}
          placeholder="{}"
          rows={5}
          defaultValue="{}"
        />
      </div>

      <h3 className="text-lg font-semibold mt-6 flex items-center gap-2">
        <Link className="h-5 w-5" />
        API Response Mapping
      </h3>

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

      {/* Additional Fields in Accordion */}
      <Accordion type="multiple" className="w-full">
        <AccordionItem value="additional">
          <AccordionTrigger>Additional Item Fields</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiAuthor">Author Field</Label>
                <Input
                  id="apiAuthor"
                  {...register("apiAuthor")}
                  placeholder="author"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiEnclosureUrl">Enclosure URL JSON Path</Label>
                <Input
                  id="apiEnclosureUrl"
                  {...register("apiEnclosureUrl")}
                  placeholder="image.url"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiEnclosureSize">
                  Enclosure Size JSON Path
                </Label>
                <Input
                  id="apiEnclosureSize"
                  {...register("apiEnclosureSize")}
                  placeholder="image.size"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiEnclosureType">
                  Enclosure Type JSON Path
                </Label>
                <Input
                  id="apiEnclosureType"
                  {...register("apiEnclosureType")}
                  placeholder="image.type"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiContentEncoded">
                  Content Encoded JSON Path
                </Label>
                <Input
                  id="apiContentEncoded"
                  {...register("apiContentEncoded")}
                  placeholder="content"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiSummary">Summary JSON Path</Label>
                <Input
                  id="apiSummary"
                  {...register("apiSummary")}
                  placeholder="summary"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiGuid">GUID JSON Path</Label>
                <Input id="apiGuid" {...register("apiGuid")} placeholder="id" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiCategories">
                  Item Categories JSON Path (comma-separated string)
                </Label>
                <Input
                  id="apiCategories"
                  {...register("apiCategories")}
                  placeholder="categories"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiContributors">
                  Contributors JSON Path (comma-separated string)
                </Label>
                <Input
                  id="apiContributors"
                  {...register("apiContributors")}
                  placeholder="contributors"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiLat">Latitude JSON Path</Label>
                <Input
                  id="apiLat"
                  {...register("apiLat")}
                  placeholder="location.lat"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiLong">Longitude JSON Path</Label>
                <Input
                  id="apiLong"
                  {...register("apiLong")}
                  placeholder="location.long"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiSourceUrl">Source URL JSON Path</Label>
                <Input
                  id="apiSourceUrl"
                  {...register("apiSourceUrl")}
                  placeholder="source.url"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiSourceTitle">Source Title JSON Path</Label>
                <Input
                  id="apiSourceTitle"
                  {...register("apiSourceTitle")}
                  placeholder="source.title"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="feedLevel">
          <AccordionTrigger>Feed Level Information (Optional)</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiFeedTitle">Feed Title JSON Path</Label>
                <Input
                  id="apiFeedTitle"
                  {...register("apiFeedTitle")}
                  placeholder="feed.title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiFeedDescription">
                  Feed Description JSON Path
                </Label>
                <Input
                  id="apiFeedDescription"
                  {...register("apiFeedDescription")}
                  placeholder="feed.description"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiFeedLanguage">Feed Language JSON Path</Label>
                <Input
                  id="apiFeedLanguage"
                  {...register("apiFeedLanguage")}
                  placeholder="feed.language"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiFeedCopyright">
                  Feed Copyright JSON Path
                </Label>
                <Input
                  id="apiFeedCopyright"
                  {...register("apiFeedCopyright")}
                  placeholder="feed.copyright"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="apiFeedImageUrl">
                  Feed Image URL JSON Path
                </Label>
                <Input
                  id="apiFeedImageUrl"
                  {...register("apiFeedImageUrl")}
                  placeholder="feed.image"
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
