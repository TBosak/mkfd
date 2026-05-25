import {
  UseFormRegister,
  Control,
  UseFormSetValue,
  UseFormWatch,
} from "react-hook-form";
import { FeedFormData } from "@/types/feed";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface WebhookConfigurationProps {
  register: UseFormRegister<FeedFormData>;
  control: Control<FeedFormData>;
  setValue: UseFormSetValue<FeedFormData>;
  watch: UseFormWatch<FeedFormData>;
}

const webhookTemplates = {
  discord: `{
  "content": "\${feedName} updated with \${itemCount} item(s)",
  "embeds": [{
    "title": "\${feedName} - Feed Update",
    "description": "\${itemCount} item(s) in feed",
    "color": 5814783,
    "timestamp": "\${timestamp}",
    "fields": [
      {
        "name": "📄 \${firstItem.title}",
        "value": "**Author:** \${firstItem.author}\\n**Published:** \${firstItem.pubDate}\\n**Link:** [\${firstItem.link}](\${firstItem.link})\\n\\n\${firstItem.description}",
        "inline": false
      }
    ],
    "footer": {
      "text": "Feed Type: \${feedType} | Feed ID: \${feedId}"
    }
  }]
}`,
  slack: `{
  "text": "\${feedName} updated with \${itemCount} item(s)",
  "attachments": [
    {
      "color": "good",
      "title": "\${firstItem.title}",
      "title_link": "\${firstItem.link}",
      "text": "\${firstItem.description}",
      "fields": [
        {"title": "Author", "value": "\${firstItem.author}", "short": true},
        {"title": "Published", "value": "\${firstItem.pubDate}", "short": true}
      ]
    }
  ]
}`,
  teams: `{
  "@type": "MessageCard",
  "@context": "http://schema.org/extensions",
  "themeColor": "0076D7",
  "summary": "\${feedName} - \${firstItem.title}",
  "sections": [
    {
      "activityTitle": "\${firstItem.title}",
      "activitySubtitle": "\${feedName} Feed Update",
      "text": "\${firstItem.description}",
      "facts": [
        {"name": "Author:", "value": "\${firstItem.author}"},
        {"name": "Published:", "value": "\${firstItem.pubDate}"}
      ]
    }
  ],
  "potentialAction": [
    {
      "@type": "OpenUri",
      "name": "View Item",
      "targets": [
        {"os": "default", "uri": "\${firstItem.link}"}
      ]
    }
  ]
}`,
  generic: `{
  "message": "\${feedName} updated with \${itemCount} items",
  "feed_id": "\${feedId}",
  "feed_name": "\${feedName}",
  "feed_type": "\${feedType}",
  "item_count": \${itemCount},
  "timestamp": "\${timestamp}",
  "data": "\${data}"
}`,
  custom: "",
};

export const WebhookConfiguration = ({
  register,
  setValue,
  watch,
}: WebhookConfigurationProps) => {
  const webhookFormat = watch("webhook.format");

  const loadWebhookTemplate = (template: keyof typeof webhookTemplates) => {
    setValue("webhook.customPayload", webhookTemplates[template]);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="webhookUrl">Webhook URL</Label>
            <Input
              id="webhookUrl"
              {...register("webhook.url")}
              placeholder="https://your-webhook-url.com/webhook"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookFormat">Webhook Format</Label>
            <Select
              value={webhookFormat || "xml"}
              onValueChange={(value) =>
                setValue("webhook.format", value as any)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="XML (RSS Format)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="xml">XML (RSS Format)</SelectItem>
                <SelectItem value="json">JSON (Parsed Data)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Checkbox
              id="webhookNewItemsOnly"
              checked={watch("webhook.newItemsOnly")}
              onCheckedChange={(checked) =>
                setValue("webhook.newItemsOnly", checked as boolean)
              }
            />
            <Label htmlFor="webhookNewItemsOnly">Send Only New Items</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                Only trigger webhook when new items are detected
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhookHeaders">
              Webhook Headers (JSON format)
            </Label>
            <Textarea
              id="webhookHeaders"
              {...register("webhook.headers")}
              placeholder='{"Authorization": "Bearer token", "Content-Type": "application/json"}'
              rows={3}
              defaultValue="{}"
            />
          </div>

          <div className="pt-2 border-t space-y-4" style={{ borderColor: "var(--wb-outline)" }}>
            <p className="workbench-label">Custom Payload Template</p>
            <div className="space-y-2">
              <Label htmlFor="templateSelector">Quick Templates</Label>
              <Select onValueChange={(value) => loadWebhookTemplate(value as keyof typeof webhookTemplates)}>
                <SelectTrigger>
                  <SelectValue placeholder="-- Select Platform Template --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="teams">Microsoft Teams</SelectItem>
                  <SelectItem value="generic">Generic (Simple JSON)</SelectItem>
                  <SelectItem value="custom">Custom (Clear field)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="webhookCustomPayload">Custom Payload Template</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-md">
                    Leave empty for default format. Available variables: $&#123;feedId&#125;, $&#123;feedName&#125;, $&#123;itemCount&#125;, $&#123;timestamp&#125;, $&#123;firstItem.title&#125;, etc.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Textarea
                id="webhookCustomPayload"
                {...register("webhook.customPayload")}
                placeholder="Choose a template above or write your own..."
                rows={8}
              />
            </div>
          </div>
        </div>
    </div>
  );
};
