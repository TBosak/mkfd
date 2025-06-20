#!/usr/bin/env node
import yaml from "js-yaml";
import path from "path";
import Imap from "node-imap";
import libmime from "libmime";
import minimist from "minimist";
import RSS from "rss";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { simpleParser } from "mailparser";
import { decrypt } from "../utilities/security.utility.ts";
import { fileURLToPath } from "url";
import { dirname } from "path";
import * as cheerio from "cheerio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = minimist(process.argv.slice(2));
const encryptionKey: string = args.key || "";
const configHash: string = args.hash || "";

// --- Embedded RSS Model Definitions ---
interface RSSImageOptions {
    url: string;         // URL of the feed image
    title: string;       // Title of the image (alt text)
    link: string;        // Link the image points to (usually the feed's homepage)
    width?: number;      // Width of the image in pixels
    height?: number;     // Height of the image in pixels
    description?: string; // Description of the image
}

interface RSSEnclosureOptions {
    url: string;    // URL of the media file
    length: number; // Length of the media file in bytes
    type: string;   // MIME type of the media file (e.g., "audio/mpeg")
}

interface RSSSourceOptions {
    title: string; // Title of the original source
    url: string;   // URL of the original source
}

interface RSSItemOptions {
    title: string;                    // Title of the item
    description?: string;               // Synopsis of the item (often shown in feed readers)
    url?: string;                       // URL of the full item (HTML page or media file)
    guid?: string;                      // Globally unique identifier for the item (can be URL, hash, etc.)
    categories?: string[];              // Array of category names item belongs to
    author?: string;                    // Email address or name of the author
    date: Date | string;                // Publication date of the item
    lat?: number;                       // Latitude for geo-tagging
    long?: number;                      // Longitude for geo-tagging
    comments?: string;                  // URL to comments page for the item
    enclosure?: RSSEnclosureOptions;    // Media object attached to the item
    source?: RSSSourceOptions;          // Original source of the item if republished
    contentEncoded?: string;          // Full content of the item, often HTML (CDATA recommended)
    summary?: string;                   // Similar to description, can be a more detailed summary
    contributors?: string[];            // Array of contributor names
    customElements?: Record<string, any>[]; // For adding custom XML elements
    // Specific to CSSTarget/Scraping context, not directly used by RSS library but part of the unified model
    guidIsPermaLink?: boolean; 
}

interface RSSFeedOptions {
    title: string;                      // Title of the feed
    description: string;                // Description of the feed
    feed_url: string;                   // URL of the RSS feed itself (where it will be published)
    site_url: string;                   // URL of the main website the feed is for
    image_url?: string;                 // DEPRECATED by RSS library, use feedImage instead. URL to an image for the feed (usually a logo)
    feedImage?: RSSImageOptions;        // Detailed image options for the feed
    docs?: string;                      // URL to documentation for the XML format of the feed (e.g., RSS 2.0 spec)
    author?: string;                    // DEPRECATED by RSS library. Author of the feed content.
    managingEditor?: string;            // Email of person responsible for editorial content
    webMaster?: string;                 // Email of person responsible for technical issues
    copyright?: string;                 // Copyright notice for content in the feed
    language?: string;                  // Language the feed is written in (e.g., "en-us")
    categories?: string[];              // Array of category names the feed belongs to
    pubDate?: Date | string;            // Publication date for the content in the feed (often current time or last item's date)
    lastBuildDate?: Date | string;      // The last time the content of the feed changed
    ttl?: number;                       // Time To Live: minutes the feed can be cached before refreshing
    rating?: string;                    // PICS rating for the feed
    skipHours?: number[];               // Hours of the day (0-23) when aggregators should skip updating
    skipDays?: string[];                // Days of the week (e.g., "Monday") when aggregators should skip updating
    customNamespace?: Record<string, string>; // e.g. { 'dc': 'http://purl.org/dc/elements/1.1/' }
    customElements?: Record<string, any>[]; // For adding custom XML elements at the feed level
    generator?: string;                 // Name of the program used to generate the feed
    // Cloud options (for feed notifications, rarely used now)
    cloud?: {
        domain: string;
        port: number;
        path: string;
        registerProcedure: string;
        protocol: "xml-rpc" | "soap" | "http-post";
    };
    // Not directly part of standard RSS spec but from our models
    feedId?: string;
    feedName?: string; // Often same as title
    feedType?: "webScraping" | "api" | "email";
    refreshTime?: number; // In minutes
    reverse?: boolean;
    strict?: boolean;
    advanced?: boolean;
    headers?: Record<string, string>;
    cookies?: Array<{ name: string; value: string }>;
    config?: any; // Holds type-specific config (ApiConfig, CSSTarget base, EmailConfig)
    article?: any; // For web scraping, holds CSSTargets for item fields
    apiMapping?: any; // For API feeds, holds paths for item and feed fields
}
// --- End Embedded RSS Model Definitions ---

export interface Email {
  UID: number;
  messageId?: string;
  subject?: string;
  from?: string;
  to?: string | Array<string>;
  cc?: string | Array<string>;
  bcc?: string | Array<string>;
  date?: string;
  textBody?: string;
  htmlBody?: string;
  attachments?: Array<{
    filename?: string;
    contentType?: string;
    size?: number;
    content?: Buffer;
    contentId?: string;
    related?: boolean;
  }>;
  headers?: Map<string, string | string[]>;
}

if (!encryptionKey || !configHash) {
  console.error(
    "[IMAP Node Watcher] Usage: node imap-watcher.service.ts --key=<encryptionKey> --hash=<configHash>",
  );
  process.exit(1);
}

console.log(`[IMAP Node Watcher] Process started for hash: ${configHash} with key: ${encryptionKey}`);

const yamlPath: string = path.join(
  __dirname,
  "../configs",
  `${configHash}.yaml`,
);

console.log(`[IMAP Node Watcher] Attempting to load YAML from: ${yamlPath}`);

if (!existsSync(yamlPath)) {
  console.error(`[IMAP Node Watcher] YAML config not found at: ${yamlPath}`);
  process.exit(1);
}

const fileContents = readFileSync(yamlPath, "utf8");
const rawConfig: any = yaml.load(fileContents);

console.log("[IMAP Node Watcher] Loaded rawConfig:", JSON.stringify({
    feedId: rawConfig.feedId,
    feedName: rawConfig.feedName,
    feedType: rawConfig.feedType,
    configHost: rawConfig.config?.host,
    configPort: rawConfig.config?.port,
    configUser: rawConfig.config?.user,
    configFolder: rawConfig.config?.folder
}, null, 2));

const imapOriginalConfig = {
  host: rawConfig.config?.host,
  port: rawConfig.config?.port,
  user: rawConfig.config?.user,
  password: rawConfig.config?.encryptedPassword ? decrypt(rawConfig.config.encryptedPassword, encryptionKey) : undefined,
  folder: rawConfig.config?.folder || "INBOX",
};

if (!imapOriginalConfig.password) {
    console.error(`[IMAP Node Watcher] Password for ${imapOriginalConfig.user} is missing or decryption failed. Ensure encryptedPassword is present in YAML and key is correct.`);
}

class ImapWatcher {
  private config: RSSFeedOptions;
  private imap: Imap;

  constructor(passedConfig: RSSFeedOptions) {
    this.config = passedConfig;

    const imapConnectionDetails = this.config.config;

    if (!imapConnectionDetails || !imapConnectionDetails.host || !imapConnectionDetails.port) {
        console.error("[IMAP Node Watcher] CRITICAL: IMAP connection details (host, port) are missing in the processed config for feedId:", this.config.feedId);
    }

    this.imap = new Imap({
      user: imapConnectionDetails?.user,
      password: imapConnectionDetails?.password,
      host: imapConnectionDetails?.host,
      port: imapConnectionDetails?.port,
      tls: true,
    });
  }

  async start(): Promise<void> {
    try {
      await this.connect();
      await this.openBox(this.config.config?.folder || "INBOX");
      this.fetchRecentStartupEmails();

      this.imap.on("mail", (n) => {
        console.log(`[IMAP] New mail event: ${n}`);
        this.fetchNewEmails();
      });

      this.imap.on("close", () => this.reconnect());
      this.imap.on("error", () => this.reconnect());
    } catch (err) {
      console.error("[IMAP] Failed to start:", err);
      this.reconnect();
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once("ready", () => {
        console.log("[IMAP] Connected");
        resolve();
      });
      this.imap.once("error", reject);
      this.imap.connect();
    });
  }

  private openBox(boxName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.openBox(boxName, false, (err) => {
        if (err) return reject(err);
        console.log(`[IMAP] Box "${boxName}" opened`);
        resolve();
      });
    });
  }

  private fetchRecentStartupEmails(): void {
    console.log("[IMAP] Fetching emails...");
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    this.imap.search([["SINCE", twoDaysAgo.toUTCString()]], (err, results) => {
      if (err || !results || results.length === 0) {
        console.log("[IMAP] No recent emails found on startup.");
        return;
      }

      const recentUids = results
        .sort((a: number, b: number) => a - b)
        .slice(-10);
      const fetch = this.imap.fetch(recentUids, { bodies: [""], struct: true });
      const tasks: Promise<Email>[] = [];

      fetch.on("message", (msg, seqno) => {
        const chunks: Buffer[] = [];
        msg.on("body", (stream) => {
          stream.on("data", (chunk: Buffer | string) => {
            if (typeof chunk === "string") {
              chunks.push(Buffer.from(chunk, "utf-8"));
            } else {
              chunks.push(chunk);
            }
          });
        });

        const task = new Promise<Email>((resolveTask, rejectTask) => {
          msg.once("end", async () => {
            try {
              const raw = Buffer.concat(chunks);
              const parsed = await simpleParser(raw);

              const parsedHeaders = new Map<string, string | string[]>();
              if (parsed.headers && typeof parsed.headers.forEach === 'function') {
                parsed.headers.forEach((value, key) => parsedHeaders.set(key, value));
              }

              const extractAddresses = (field: any): string | string[] | undefined => {
                if (!field) return undefined;
                if (typeof field.text === 'string') return libmime.decodeWords(field.text);
                if (Array.isArray(field.value)) {
                  return field.value.map((addr: any) => libmime.decodeWords(addr.text || addr.address || '')).filter(Boolean);
                }
                return undefined;
              };

              const email: Email = {
                UID: seqno,
                messageId: parsed.messageId,
                subject: parsed.subject ? libmime.decodeWords(parsed.subject) : "(No Subject)",
                from: parsed.from?.text ? libmime.decodeWords(parsed.from.text) : "(Unknown Sender)",
                to: extractAddresses(parsed.to),
                cc: extractAddresses(parsed.cc),
                bcc: extractAddresses(parsed.bcc),
                date: parsed.date?.toISOString() || new Date().toISOString(),
                textBody: parsed.text,
                htmlBody: parsed.html || undefined,
                attachments: parsed.attachments?.map(att => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                  content: Buffer.isBuffer(att.content) ? att.content : undefined,
                  contentId: att.contentId,
                  related: att.related,
                })),
                headers: parsedHeaders,
              };
              resolveTask(email);
            } catch (parseErr) {
              console.error(
                `[IMAP] Failed to parse message ${seqno}:`,
                parseErr,
              );
              rejectTask(parseErr);
            }
          });
        });
        tasks.push(task);
      });

      fetch.once("end", async () => {
        await Promise.allSettled(tasks).then((results) => {
          const emails = results
            .filter((result) => result.status === "fulfilled")
            .map((result) => (result as PromiseFulfilledResult<Email>).value);

          if (emails.length > 0) {
            console.log("[IMAP] Startup emails fetched");
            const rss = buildRSSFromEmailFolder(emails, this.config);
            writeFileSync(
              path.join(__dirname, "../public/feeds", `${this.config.feedId}.xml`),
              rss,
            );
            console.log("[IMAP] RSS Feed generated");
          } else {
            console.log("[IMAP] No valid emails found.");
          }
        });
        console.log("[IMAP] Finished processing emails.");
      });

      fetch.once("error", (fetchErr) => {
        console.error("[IMAP] Startup fetch error:", fetchErr);
      });
    });
  }

  private fetchNewEmails(): void {
    console.log("[IMAP] Fetching emails...");

    this.imap.search(["ALL"], (err, results) => {
      if (err || !results || results.length === 0) {
        console.error("[IMAP] Error or no emails found:", err);
        return;
      }

      const recentUids = results.sort((a, b) => a - b).slice(-10);
      const fetch = this.imap.fetch(recentUids, { bodies: [""], struct: true });
      const tasks: Promise<Email>[] = [];

      fetch.on("message", (msg, seqno) => {
        const chunks: Buffer[] = [];
        msg.on("body", (stream) => {
          stream.on("data", (chunk: Buffer | string) => {
            if (typeof chunk === "string") {
              chunks.push(Buffer.from(chunk, "utf-8"));
            } else {
              chunks.push(chunk);
            }
          });
        });

        const task = new Promise<Email>((resolveTask, rejectTask) => {
          msg.once("end", async () => {
            try {
              const raw = Buffer.concat(chunks);
              const parsed = await simpleParser(raw);

              const parsedHeaders = new Map<string, string | string[]>();
              if (parsed.headers && typeof parsed.headers.forEach === 'function') {
                parsed.headers.forEach((value, key) => parsedHeaders.set(key, value));
              }

              const extractAddresses = (field: any): string | string[] | undefined => {
                if (!field) return undefined;
                if (typeof field.text === 'string') return libmime.decodeWords(field.text);
                if (Array.isArray(field.value)) {
                  return field.value.map((addr: any) => libmime.decodeWords(addr.text || addr.address || '')).filter(Boolean);
                }
                return undefined;
              };

              const email: Email = {
                UID: seqno,
                messageId: parsed.messageId,
                subject: parsed.subject ? libmime.decodeWords(parsed.subject) : "(No Subject)",
                from: parsed.from?.text ? libmime.decodeWords(parsed.from.text) : "(Unknown Sender)",
                to: extractAddresses(parsed.to),
                cc: extractAddresses(parsed.cc),
                bcc: extractAddresses(parsed.bcc),
                date: parsed.date?.toISOString() || new Date().toISOString(),
                textBody: parsed.text,
                htmlBody: parsed.html || undefined,
                attachments: parsed.attachments?.map(att => ({
                  filename: att.filename,
                  contentType: att.contentType,
                  size: att.size,
                  content: Buffer.isBuffer(att.content) ? att.content : undefined,
                  contentId: att.contentId,
                  related: att.related,
                })),
                headers: parsedHeaders,
              };
              resolveTask(email);
            } catch (parseErr) {
              console.error(
                `[IMAP] Failed to parse message ${seqno}:`,
                parseErr,
              );
              rejectTask(parseErr);
            }
          });
        });
        tasks.push(task);
      });

      fetch.once("end", async () => {
        await Promise.allSettled(tasks).then((results) => {
          const emails = results
            .filter((result) => result.status === "fulfilled")
            .map((result) => (result as PromiseFulfilledResult<Email>).value);

          if (emails.length > 0) {
            console.log("[IMAP] Recent emails fetched, updating RSS...");
            const rss = buildRSSFromEmailFolder(emails, this.config);
            writeFileSync(
              path.join(__dirname, "../public/feeds", `${this.config.feedId}.xml`),
              rss,
            );
            console.log("[IMAP] RSS Feed regenerated");
          } else {
            console.log("[IMAP] No valid emails found.");
          }
        });
        console.log("[IMAP] Completed processing new emails.");
      });

      fetch.once("error", (fetchErr) => {
        console.error("[IMAP] Error fetching new emails:", fetchErr);
      });
    });
  }

  private reconnect(): void {
    console.log("[IMAP] Reconnecting in 10s...");
    setTimeout(() => this.start(), 10000);
  }

  public stop(): void {
    if (this.imap) {
      console.log("[IMAP] Stopping watcher...");
      this.imap.end();
    }
  }
}

export function buildRSSFromEmailFolder(emails: Email[], feedSetup: RSSFeedOptions): string {
  const feed = new RSS({
    title: feedSetup.feedName || feedSetup.title || "Email Feed",
    description: feedSetup.description || `Email feed from ${feedSetup.config?.folder || 'folder'}`,
    feed_url: feedSetup.feed_url, 
    site_url: feedSetup.site_url || feedSetup.feed_url, 
    language: feedSetup.language || "en",
    pubDate: feedSetup.pubDate || new Date(),
    lastBuildDate: new Date(),
    managingEditor: feedSetup.managingEditor,
    webMaster: feedSetup.webMaster,
    copyright: feedSetup.copyright,
    generator: feedSetup.generator || "MkFD IMAP Email Watcher",
    ttl: feedSetup.ttl,
    categories: feedSetup.categories,
    feedImage: feedSetup.feedImage, 
    customElements: feedSetup.customElements,
    customNamespace: feedSetup.customNamespace,
  });

  emails.forEach((email) => {
    let descriptionText: string | undefined = email.textBody;
    let contentEncodedHtml: string | undefined = email.htmlBody || email.textBody;

    if (email.htmlBody) {
      const $ = cheerio.load(email.htmlBody);
      // Remove script, style tags, and linked stylesheets
      $('script, style, link[rel="stylesheet"]').remove();

      // For descriptionText, if email.textBody was not good:
      if (!descriptionText || descriptionText.trim() === "") {
        // Prefer text from <body>, fallback to :root
        const textSource = $('body').length ? $('body') : $(':root');
        let extractedText = textSource.text();
        
        // Normalize all whitespace (including newlines) to single spaces and trim
        let fullCleanedText = extractedText.replace(/\s+/g, ' ').trim();
        
        if (fullCleanedText.length > 500) {
          // Truncate and add ellipsis, ensuring total length is at most 500
          descriptionText = fullCleanedText.substring(0, 497) + "...";
        } else {
          descriptionText = fullCleanedText;
        }
      }

      // For contentEncodedHtml, get the HTML content after removals
      // Prefer HTML from <body>, fallback to :root
      contentEncodedHtml = ($('body').length ? $('body') : $(':root')).html() || $.html();
    }
    
    // Fallback for descriptionText if it's still empty after all attempts
    if (!descriptionText || descriptionText.trim() === "") {
      descriptionText = "(No descriptive content)";
    }


    const itemOptions: RSSItemOptions = {
      title: email.subject || "(No Subject)",
      description: descriptionText,
      contentEncoded: contentEncodedHtml,
      author: email.from, 
      date: email.date ? new Date(email.date) : new Date(),
      guid: email.messageId || email.UID.toString(), // Use Message-ID as GUID, fallback to UID
      url: undefined, // Email items generally don't have a direct public URL by default
      categories: email.headers?.get('keywords') ? String(email.headers.get('keywords')).split(',').map(k => k.trim()) : undefined,
      enclosure: email.attachments && email.attachments.length > 0 && email.attachments[0].content && email.attachments[0].size && email.attachments[0].contentType ? {
        // For local/internal use, CID linking might work if the RSS reader processes related MIME parts.
        // For external/public RSS, attachments need to be hosted and linked via a public URL.
        // This placeholder will use CID, assuming a capable reader or internal use.
        url: email.attachments[0].filename ? `cid:${email.attachments[0].filename}` : (email.attachments[0].contentId ? `cid:${email.attachments[0].contentId}` : undefined),
        length: email.attachments[0].size,
        type: email.attachments[0].contentType,
      } : undefined,
      customElements: [
        { 'email:to': Array.isArray(email.to) ? email.to.join(', ') : email.to },
        { 'email:cc': Array.isArray(email.cc) ? email.cc.join(', ') : email.cc },
      ].filter(el => Object.values(el)[0] !== undefined) 
    };
    // Remove enclosure if its URL could not be formed
    if (itemOptions.enclosure && !itemOptions.enclosure.url) {
        delete itemOptions.enclosure;
    }
    feed.item(itemOptions);
  });

  return feed.xml({ indent: true });
}

const completeFeedConfig: RSSFeedOptions = {
    feed_url: `${rawConfig.feedId}.xml`, 
    site_url: rawConfig.site_url || 'mailto:' + (imapOriginalConfig.user || ''), 
    title: rawConfig.feedName || `Email Feed: ${imapOriginalConfig.folder}`,
    description: rawConfig.description || `Emails from ${imapOriginalConfig.user || 'unknown user'}/${imapOriginalConfig.folder}`,
    feedId: rawConfig.feedId,
    feedName: rawConfig.feedName,
    feedType: rawConfig.feedType, 
    language: rawConfig.language,
    copyright: rawConfig.copyright,
    managingEditor: rawConfig.managingEditor,
    webMaster: rawConfig.webMaster,
    pubDate: rawConfig.pubDate,
    lastBuildDate: rawConfig.lastBuildDate,
    ttl: rawConfig.ttl,
    rating: rawConfig.rating,
    skipHours: rawConfig.skipHours,
    skipDays: rawConfig.skipDays,
    feedImage: rawConfig.feedImage,
    generator: rawConfig.generator,
    config: imapOriginalConfig,
};

console.log("[IMAP Node Watcher] ImapWatcher will attempt to connect to host:", completeFeedConfig.config?.host, "port:", completeFeedConfig.config?.port);

const watcher = new ImapWatcher(completeFeedConfig); 

watcher.start();
