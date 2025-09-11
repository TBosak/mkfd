import axios, { AxiosRequestConfig } from "axios";
import { WebhookConfig, WebhookPayload } from "../models/webhook.model";
import * as cheerio from "cheerio";

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
    const axiosConfig: AxiosRequestConfig = {
      method: "POST",
      url: webhookConfig.url,
      headers: {
        "Content-Type": webhookConfig.format === "xml" 
          ? "application/xml" 
          : "application/json",
        ...webhookConfig.headers,
      },
      timeout: 10000, // 10 second timeout
    };

    // Prepare the payload based on format
    if (webhookConfig.format === "xml") {
      axiosConfig.data = typeof payload.data === "string" 
        ? payload.data 
        : JSON.stringify(payload.data);
    } else {
      axiosConfig.data = payload;
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