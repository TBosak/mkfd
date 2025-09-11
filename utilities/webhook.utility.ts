import axios from "axios";
import * as cheerio from "cheerio";

// Define types directly to avoid import issues in Node.js worker context
interface WebhookConfig {
  url: string;
  enabled: boolean;
  headers?: Record<string, string>;
  format: 'xml' | 'json';
  newItemsOnly: boolean;
  customPayload?: string;
}

interface WebhookPayload {
  feedId: string;
  feedName: string;
  feedType: string;
  timestamp: string;
  triggerType: 'automatic' | 'manual';
  itemCount: number;
  data: string | object;
  metadata?: {
    lastBuildDate?: string;
    feedUrl?: string;
    siteUrl?: string;
  };
}

/**
 * Sends a webhook POST request to the configured URL
 */
export async function sendWebhook(
  webhookConfig: WebhookConfig,
  payload: WebhookPayload
): Promise<boolean> {
  if (!webhookConfig.enabled || !webhookConfig.url) {
    return false;
  }

  try {
    const axiosConfig: any = {
      method: "POST",
      url: webhookConfig.url,
      headers: {
        // Default headers - will be overridden based on payload type
        ...webhookConfig.headers,
      },
      timeout: 10000, // 10 second timeout
    };

    // Prepare the payload and set appropriate Content-Type based on format and platform
    if (webhookConfig.customPayload) {
      // Parse items from data for granular access
      let items: any[] = [];
      try {
        if (typeof payload.data === "object" && (payload.data as any).items) {
          items = (payload.data as any).items;
        } else if (typeof payload.data === "string") {
          // Parse RSS XML to get items
          const $ = cheerio.load(payload.data, { xmlMode: true });
          items = $("item").map((_, item) => {
            const $item = $(item);
            return {
              title: $item.find("title").text(),
              description: $item.find("description").text(),
              link: $item.find("link").text(),
              pubDate: $item.find("pubDate").text(),
              guid: $item.find("guid").text(),
              author: $item.find("author").text(),
              category: $item.find("category").map((_, cat) => $(cat).text()).get().join(", "),
            };
          }).get();
        }
      } catch (parseError) {
        console.warn("Could not parse items for webhook template:", parseError);
      }

      // Use custom payload template with enhanced variable substitution
      let customData = webhookConfig.customPayload
        .replace(/\${feedId}/g, payload.feedId)
        .replace(/\${feedName}/g, payload.feedName)
        .replace(/\${feedType}/g, payload.feedType)
        .replace(/\${itemCount}/g, payload.itemCount.toString())
        .replace(/\${timestamp}/g, payload.timestamp)
        .replace(/\${data}/g, typeof payload.data === "string" ? payload.data : JSON.stringify(payload.data));

      // Replace individual item variables (up to first 10 items)
      for (let i = 0; i < Math.min(items.length, 10); i++) {
        const item = items[i];
        customData = customData
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.title\\}`, 'g'), item.title || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.description\\}`, 'g'), item.description || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.link\\}`, 'g'), item.link || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.author\\}`, 'g'), item.author || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.pubDate\\}`, 'g'), item.pubDate || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.category\\}`, 'g'), item.category || '')
          .replace(new RegExp(`\\$\\{items\\[${i}\\]\\.guid\\}`, 'g'), item.guid || '');
      }

      // Replace first item shortcuts for convenience
      if (items.length > 0) {
        const firstItem = items[0];
        customData = customData
          .replace(/\${firstItem\.title}/g, firstItem.title || '')
          .replace(/\${firstItem\.description}/g, firstItem.description || '')
          .replace(/\${firstItem\.link}/g, firstItem.link || '')
          .replace(/\${firstItem\.author}/g, firstItem.author || '')
          .replace(/\${firstItem\.pubDate}/g, firstItem.pubDate || '')
          .replace(/\${firstItem\.category}/g, firstItem.category || '')
          .replace(/\${firstItem\.guid}/g, firstItem.guid || '');
      }
        
      // Try to parse as JSON, fallback to string if not valid JSON
      try {
        axiosConfig.data = JSON.parse(customData);
        axiosConfig.headers["Content-Type"] = "application/json";
      } catch {
        axiosConfig.data = customData;
        axiosConfig.headers["Content-Type"] = "text/plain";
      }
    } else if (isDiscordWebhook(webhookConfig.url)) {
      // Format for Discord webhooks - always JSON
      axiosConfig.data = formatForDiscord(payload, webhookConfig.format);
      axiosConfig.headers["Content-Type"] = "application/json";
    } else if (webhookConfig.format === "xml") {
      // Standard XML format
      axiosConfig.data = typeof payload.data === "string" 
        ? payload.data 
        : JSON.stringify(payload.data);
      axiosConfig.headers["Content-Type"] = "application/xml";
    } else {
      // Standard JSON format (original mkfd format)
      axiosConfig.data = payload;
      axiosConfig.headers["Content-Type"] = "application/json";
    }

    const response = await axios(axiosConfig);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`Webhook sent successfully to ${webhookConfig.url} for feed ${payload.feedId}`);
      return true;
    } else {
      // Include response body where possible to help diagnose 4xx/5xx responses
      let respBody: any = undefined;
      try {
        respBody = response.data;
      } catch (e) {
        respBody = "<unserializable response body>";
      }
      console.warn(
        `Webhook failed with status ${response.status} for feed ${payload.feedId}. Response body: ${
          typeof respBody === "string" ? respBody : JSON.stringify(respBody)
        }`
      );
      return false;
    }
  } catch (error) {
    // Axios errors can include response/request info; log them for debugging
    const anyErr: any = error;
    if (anyErr.response) {
      // Server responded with a status outside the 2xx range
      const status = anyErr.response.status;
      const data = anyErr.response.data;
      console.error(
        `Webhook error for feed ${payload.feedId}: Request failed with status code ${status}. Response body: ${
          typeof data === "string" ? data : JSON.stringify(data)
        }`
      );
    } else if (anyErr.request) {
      // Request was sent but no response received
      console.error(
        `Webhook error for feed ${payload.feedId}: No response received from ${webhookConfig.url}. Request details:`,
        anyErr.request
      );
    } else {
      // Something else happened while setting up the request
      console.error(`Webhook error for feed ${payload.feedId}:`, anyErr.message || anyErr);
    }
    return false;
  }
}

/**
 * Creates a webhook payload from RSS XML and feed configuration
 */
export function createWebhookPayload(
  feedConfig: any,
  rssXml: string,
  triggerType: 'automatic' | 'manual' = 'automatic',
  itemCount?: number
): WebhookPayload {
  const payload: WebhookPayload = {
    feedId: feedConfig.feedId,
    feedName: feedConfig.feedName,
    feedType: feedConfig.feedType,
    timestamp: new Date().toISOString(),
    triggerType,
    itemCount: itemCount || getItemCountFromXML(rssXml),
    data: rssXml,
    metadata: {
      lastBuildDate: new Date().toISOString(),
      feedUrl: `public/feeds/${feedConfig.feedId}.xml`,
      siteUrl: feedConfig.config?.baseUrl,
    },
  };

  return payload;
}

/**
 * Creates a JSON webhook payload from RSS XML
 */
export function createJsonWebhookPayload(
  feedConfig: any,
  rssXml: string,
  triggerType: 'automatic' | 'manual' = 'automatic'
): WebhookPayload {
  const parsedData = parseRSSToJson(rssXml);
  const payload: WebhookPayload = {
    feedId: feedConfig.feedId,
    feedName: feedConfig.feedName,
    feedType: feedConfig.feedType,
    timestamp: new Date().toISOString(),
    triggerType,
    itemCount: parsedData.items?.length || 0,
    data: parsedData,
    metadata: {
      lastBuildDate: new Date().toISOString(),
      feedUrl: `public/feeds/${feedConfig.feedId}.xml`,
      siteUrl: feedConfig.config?.baseUrl,
    },
  };

  return payload;
}

/**
 * Parses RSS XML to JSON structure
 */
function parseRSSToJson(rssXml: string): any {
  try {
    const $ = cheerio.load(rssXml, { xmlMode: true });
    
    const channel = $("channel");
    const items = $("item").map((_, item) => {
      const $item = $(item);
      return {
        title: $item.find("title").text(),
        description: $item.find("description").text(),
        link: $item.find("link").text(),
        pubDate: $item.find("pubDate").text(),
        guid: $item.find("guid").text(),
        author: $item.find("author").text(),
        category: $item.find("category").map((_, cat) => $(cat).text()).get(),
        enclosure: (() => {
          const enc = $item.find("enclosure");
          if (enc.length) {
            return {
              url: enc.attr("url"),
              type: enc.attr("type"),
              length: enc.attr("length"),
            };
          }
          return null;
        })(),
      };
    }).get();

    return {
      title: channel.find("title").text(),
      description: channel.find("description").text(),
      link: channel.find("link").text(),
      lastBuildDate: channel.find("lastBuildDate").text(),
      pubDate: channel.find("pubDate").text(),
      language: channel.find("language").text(),
      generator: channel.find("generator").text(),
      items,
    };
  } catch (error) {
    console.error("Error parsing RSS XML to JSON:", error);
    return { items: [] };
  }
}

/**
 * Extracts item count from RSS XML
 */
function getItemCountFromXML(rssXml: string): number {
  try {
    const $ = cheerio.load(rssXml, { xmlMode: true });
    return $("item").length;
  } catch (error) {
    console.error("Error counting items in RSS XML:", error);
    return 0;
  }
}

/**
 * Detects if a URL is a Discord webhook
 */
function isDiscordWebhook(url: string): boolean {
  return url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks');
}

/**
 * Formats payload for Discord webhooks
 */
function formatForDiscord(payload: WebhookPayload, format: 'xml' | 'json'): any {
  const feedName = payload.feedName || "RSS Feed";
  const itemCount = payload.itemCount;
  
  if (format === "xml" && typeof payload.data === "string") {
    // For XML format, send as content with code block
    const truncatedXml = payload.data.length > 1500 
      ? payload.data.substring(0, 1500) + '...' 
      : payload.data;
    
    return {
      content: `**${feedName}** - ${itemCount} item(s) updated`,
      embeds: [{
        title: "RSS Feed Update",
        description: `\`\`\`xml\n${truncatedXml}\n\`\`\``,
        color: 5814783, // Blue color
        timestamp: payload.timestamp,
        footer: {
          text: `Feed Type: ${payload.feedType} | Feed ID: ${payload.feedId}`
        }
      }]
    };
  } else {
    // For JSON format, create a nice embed with item details
    const data = typeof payload.data === "object" ? payload.data : { items: [] };
    const items = (data as any).items || [];
    
    const embed: any = {
      title: `${feedName} - Feed Update`,
      description: `${itemCount} item(s) in feed`,
      color: 5814783, // Blue color
      timestamp: payload.timestamp,
      fields: [],
      footer: {
        text: `Feed Type: ${payload.feedType} | Feed ID: ${payload.feedId}`
      }
    };

    // Add up to 5 recent items as fields
    items.slice(0, 5).forEach((item: any, index: number) => {
      const title = item.title || "Untitled";
      const description = item.description || "";
      const link = item.link || "";
      const author = item.author || "";
      const pubDate = item.pubDate || "";
      
      let fieldValue = "";
      if (author) fieldValue += `**Author:** ${author}\n`;
      if (pubDate) fieldValue += `**Published:** ${pubDate}\n`;
      if (link) fieldValue += `**Link:** [View Item](${link})\n`;
      if (description) {
        // Clean up the description - remove extra whitespace and HTML entities
        const cleanDesc = description
          .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
          .replace(/&#?\w+;/g, '') // Remove HTML entities like &#8203;
          .replace(/‌/g, '') // Remove zero-width non-joiner characters
          .trim();
        
        // Use more of Discord's 1024 character limit per field
        const maxDescLength = 800 - fieldValue.length; // Reserve space for other field content
        const truncatedDesc = cleanDesc.length > maxDescLength 
          ? cleanDesc.substring(0, maxDescLength).trim() + "..." 
          : cleanDesc;
        fieldValue += `\n${truncatedDesc}`;
      }
      
      // Discord embed field values have a 1024 character limit
      if (fieldValue.length > 1024) {
        fieldValue = fieldValue.substring(0, 1020) + "...";
      }
      
      embed.fields.push({
        name: `📄 ${title.length > 256 ? title.substring(0, 253) + "..." : title}`, // Field names are limited to 256 chars
        value: fieldValue || "No details available",
        inline: false
      });
    });
    
    if (itemCount > 5) {
      embed.fields.push({
        name: "📝 Additional Items",
        value: `... and ${itemCount - 5} more item(s)`,
        inline: false
      });
    }

    return {
      content: `**${feedName}** updated with ${itemCount} item(s)`,
      embeds: [embed]
    };
  }
}

/**
 * Compares two RSS XMLs and returns only new items
 */
export function getNewItemsFromRSS(newRssXml: string, oldRssXml?: string): string | null {
  if (!oldRssXml) {
    return newRssXml; // All items are new if no previous RSS
  }

  try {
    const $new = cheerio.load(newRssXml, { xmlMode: true });
    const $old = cheerio.load(oldRssXml, { xmlMode: true });

    // Extract GUIDs from old RSS
    const oldGuids = new Set();
    $old("item").each((_, item) => {
      const guid = $old(item).find("guid").text() || $old(item).find("link").text();
      if (guid) oldGuids.add(guid);
    });

    // Filter new items
    const newItems: any[] = [];
    $new("item").each((_, item) => {
      const $item = $new(item);
      const guid = $item.find("guid").text() || $item.find("link").text();
      if (guid && !oldGuids.has(guid)) {
        newItems.push($item.clone());
      }
    });

    if (newItems.length === 0) {
      return null; // No new items
    }

    // Create new RSS with only new items
    const $clone = cheerio.load(newRssXml, { xmlMode: true });
    $clone("item").remove();
    
    // Add only new items
    const channel = $clone("channel");
    newItems.forEach(item => {
      channel.append(item);
    });

    return $clone.xml();
  } catch (error) {
    console.error("Error comparing RSS for new items:", error);
    return newRssXml; // Return full RSS on error
  }
}