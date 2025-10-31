#!/usr/bin/env node
import yaml from "js-yaml";
import path from "path";
import Imap from "node-imap";
import libmime from "libmime";
import minimist from "minimist";
import { Feed } from "feed";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { simpleParser } from "mailparser";
import { decrypt } from "../utilities/security.utility.ts";
import { fileURLToPath } from "url";
import { dirname } from "path";
import * as cheerio from "cheerio";

// Type definitions (inline to avoid ES module issues in Node.js worker)
interface Author {
  name?: string;
  email?: string;
  link?: string;
  avatar?: string;
}

interface Category {
  name?: string;
  domain?: string;
  scheme?: string;
  term?: string;
}

interface Enclosure {
  url: string;
  type?: string;
  length?: number;
  title?: string;
  duration?: number;
}

interface Extension {
  name: string;
  objects: any;
}

interface RSSItemOptions {
  title: string;
  id?: string;
  link: string;
  date: Date;
  description?: string;
  content?: string;
  category?: Category[];
  guid?: string;
  image?: string | Enclosure;
  audio?: string | Enclosure;
  video?: string | Enclosure;
  enclosure?: Enclosure;
  author?: Author[];
  contributor?: Author[];
  published?: Date;
  copyright?: string;
  extensions?: Extension[];
}

interface RSSFeedOptions {
  feedId?: string;
  feedName?: string;
  feedType?: string;
  config?: any;
  webhook?: any;
  refreshTime?: number;
  reverse?: boolean;
  strict?: boolean;
  advanced?: boolean;
  headers?: any;
  cookies?: any;
  article?: any;
  apiMapping?: any;
  serverUrl?: string;
    id: string;
  title: string;
  updated?: Date;
  generator?: string;
  language?: string;
  ttl?: number;
  feed?: string;
  feedLinks?: any;
  hub?: string;
  docs?: string;
  podcast?: boolean;
  category?: string;
  author?: Author;
  link?: string;
  description?: string;
  image?: string;
  favicon?: string;
  copyright: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = minimist(process.argv.slice(2));
const encryptionKey: string = args.key || "";
const configHash: string = args.hash || "";

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
  emailCount: rawConfig.config?.emailCount || 10,
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
      this.imap.removeAllListeners("mail");
      this.imap.removeAllListeners("close");
      this.imap.removeAllListeners("error");
      this.imap.setMaxListeners(20);

      this.imap.on("mail", (n) => {
        console.log(`[IMAP] New mail event received for feed ${this.config.feedId}: ${n} new email(s)`);
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

      const emailLimit = this.config.config?.emailCount || 10;
      const recentUids = results
        .sort((a: number, b: number) => a - b)
        .slice(-emailLimit);
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
        console.log("[IMAP] No emails found:", err?.message || "Empty mailbox");
        return;
      }

      const emailLimit = this.config.config?.emailCount || 10;
      const recentUids = results.sort((a, b) => b - a).slice(0, emailLimit).reverse();
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
            console.log(`[IMAP] Recent emails fetched for feed ${this.config.feedId}, updating RSS with ${emails.length} emails...`);
            const rss = buildRSSFromEmailFolder(emails, this.config);
            writeFileSync(
              path.join(__dirname, "../public/feeds", `${this.config.feedId}.xml`),
              rss,
            );
            console.log(`[IMAP] RSS Feed regenerated for feed ${this.config.feedId}`);
            
            // Handle webhook if configured
            if (this.config.webhook?.enabled && this.config.webhook?.url) {
              console.log(`[IMAP] Calling webhook handler for feed ${this.config.feedId}`);
              this.handleWebhook(rss);
            } else {
              console.log(`[IMAP] Webhook not configured for feed ${this.config.feedId} - enabled: ${this.config.webhook?.enabled}, url: ${!!this.config.webhook?.url}`);
            }
          } else {
            console.log(`[IMAP] No valid emails found for feed ${this.config.feedId}`);
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

  private async handleWebhook(rssXml: string): Promise<void> {
    try {
      console.log(`[IMAP] Webhook handler called for feed ${this.config.feedId}`);
      
      if (!this.config.webhook?.enabled || !this.config.webhook?.url) {
        console.log(`[IMAP] Webhook not configured for feed ${this.config.feedId} - enabled: ${this.config.webhook?.enabled}, url: ${!!this.config.webhook?.url}`);
        return;
      }
      
      console.log(`[IMAP] Webhook configured for feed ${this.config.feedId} - URL: ${this.config.webhook.url}, format: ${this.config.webhook.format}, newItemsOnly: ${this.config.webhook.newItemsOnly}`);

      let shouldSendWebhook = true;
      let webhookRssXml = rssXml;
      
      // Check if only new items should be sent
      if (this.config.webhook.newItemsOnly) {
        const historyPath = path.join(__dirname, "../feed-history", `${this.config.feedId}.xml`);
        let previousRss = null;
        
        try {
          if (existsSync(historyPath)) {
            previousRss = readFileSync(historyPath, "utf8");
          }
        } catch (err) {
          console.warn("[IMAP] Could not read feed history:", err.message);
        }
        
        // Use centralized new item detection
        try {
          const { getNewItemsFromRSS } = await import("../utilities/webhook.utility.ts");
          const newItemsRss = getNewItemsFromRSS(rssXml, previousRss);
          
          if (!newItemsRss) {
            shouldSendWebhook = false;
            console.log(`[IMAP] No new items detected for feed ${this.config.feedId}, skipping webhook`);
          } else {
            webhookRssXml = newItemsRss;
            console.log(`[IMAP] New items detected for feed ${this.config.feedId}, will send webhook`);
          }
        } catch (importErr) {
          console.warn("[IMAP] Could not import webhook utilities, falling back to simple comparison:", importErr.message);
          // Fallback to simple comparison
          if (previousRss && previousRss.trim() === rssXml.trim()) {
            shouldSendWebhook = false;
            console.log("[IMAP] No changes detected, skipping webhook");
          }
        }
      }
      
      if (shouldSendWebhook) {
        try {
          // Use centralized webhook system
          const { sendWebhook, createWebhookPayload, createJsonWebhookPayload } = await import("../utilities/webhook.utility.ts");
          
          const payload = this.config.webhook.format === "json"
            ? createJsonWebhookPayload(this.config, webhookRssXml, "automatic")
            : createWebhookPayload(this.config, webhookRssXml, "automatic");

          const success = await sendWebhook(this.config.webhook, payload);
          
          if (success) {
            console.log(`[IMAP] Webhook sent successfully for feed ${this.config.feedId} to ${this.config.webhook.url}`);
            
            // Store current RSS for future comparison using centralized history utility
            try {
              const { storeFeedHistory } = await import("../utilities/feed-history.utility.ts");
              await storeFeedHistory(this.config.feedId, rssXml);
              console.log(`[IMAP] Feed history stored for feed ${this.config.feedId}`);
            } catch (historyErr) {
              console.warn(`[IMAP] Could not store feed history for feed ${this.config.feedId}:`, historyErr.message);
              // Fallback to manual file storage
              const historyDir = path.join(__dirname, "../feed-history");
              if (!existsSync(historyDir)) {
                mkdirSync(historyDir, { recursive: true });
              }
              writeFileSync(path.join(historyDir, `${this.config.feedId}.xml`), rssXml, "utf8");
              console.log(`[IMAP] Feed history stored manually for feed ${this.config.feedId}`);
            }
          } else {
            console.warn(`[IMAP] Webhook failed for feed ${this.config.feedId} to ${this.config.webhook.url}`);
          }
        } catch (webhookErr) {
          console.error(`[IMAP] Error using centralized webhook system:`, webhookErr.message);
        }
      }
    } catch (error) {
      console.error(`[IMAP] Webhook error:`, error.message);
    }
  }

}

export function buildRSSFromEmailFolder(emails: Email[], feedSetup: RSSFeedOptions): string {
  const feed = new Feed({
    id: feedSetup.id,
    title: feedSetup.feedName || feedSetup.title || "Email Feed",
    link: feedSetup.link || feedSetup.id,
    description: feedSetup.description || `Email feed from ${feedSetup.config?.folder || 'folder'}`,
    image: feedSetup.image,
    language: feedSetup.language || "en",
    updated: new Date(),
    copyright: feedSetup.copyright || '',
    generator: feedSetup.generator || "MkFD IMAP Email Watcher",
    ttl: feedSetup.ttl,
    feedLinks: {
      rss: feedSetup.id
    }
  });

  // Helper function to sanitize content for XML/RSS
  const sanitizeForXML = (content: string): string => {
    if (!content) return content;
    return content
      .replace(/]]>/g, ']]&gt;') // Escape CDATA closing sequence
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove invalid XML characters
      .replace(/&(?!(?:amp|lt|gt|quot|apos|nbsp);)/g, '&amp;'); // Escape unescaped ampersands
  };

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
        descriptionText = extractedText.replace(/\s+/g, ' ').trim();
      }

      // For contentEncodedHtml, get the HTML content after removals
      // Prefer HTML from <body>, fallback to :root
      contentEncodedHtml = ($('body').length ? $('body') : $(':root')).html() || $.html();
    }
    
    // Fallback for descriptionText if it's still empty after all attempts
    if (!descriptionText || descriptionText.trim() === "") {
      descriptionText = "(No descriptive content)";
    }

    // Sanitize both description and content for XML
    descriptionText = sanitizeForXML(descriptionText || "");
    contentEncodedHtml = sanitizeForXML(contentEncodedHtml || "");
    
    const itemOptions: RSSItemOptions = {
      title: sanitizeForXML(email.subject || "(No Subject)"),
      description: descriptionText,
      date: email.date ? new Date(email.date) : new Date(),
      guid: email.messageId || email.UID.toString(), // Use Message-ID as GUID, fallback to UID
      link: email.messageId ? `mailto:${email.messageId}` : `mailto:${email.UID}`, // Email items use mailto: scheme
      content: contentEncodedHtml, // Content is now a standard field
    };

    // Handle author (convert to Author array)
    const authorName = sanitizeForXML(email.from || "");
    if (authorName) {
      itemOptions.author = [{ name: authorName }];
    }

    // Handle categories (convert to Category array)
    const keywords = email.headers?.get('keywords') ? String(email.headers.get('keywords')).split(',').map(k => sanitizeForXML(k.trim())) : [];
    if (keywords.length > 0) {
      itemOptions.category = keywords.map(name => ({ name }));
    }

    // Add enclosure if present
    if (email.attachments && email.attachments.length > 0 && email.attachments[0].content && email.attachments[0].size && email.attachments[0].contentType) {
      const enclosureUrl = email.attachments[0].filename ? `cid:${sanitizeForXML(email.attachments[0].filename)}` : (email.attachments[0].contentId ? `cid:${sanitizeForXML(email.attachments[0].contentId)}` : undefined);
      if (enclosureUrl) {
        itemOptions.enclosure = {
          url: enclosureUrl,
          length: email.attachments[0].size,
          type: email.attachments[0].contentType,
        };
      }
    }

    feed.addItem(itemOptions);
  });

  return feed.rss2();
}

const serverUrl = rawConfig.serverUrl || process.env.SERVER_URL || 'http://localhost:5000';
const completeFeedConfig: RSSFeedOptions = {
    id: `${serverUrl}/public/feeds/${rawConfig.feedId}.xml`,
    link: rawConfig.link || 'mailto:' + (imapOriginalConfig.user || ''),
    title: rawConfig.feedName || `Email Feed: ${imapOriginalConfig.folder}`,
    description: rawConfig.description || `Emails from ${imapOriginalConfig.user || 'unknown user'}/${imapOriginalConfig.folder}`,
    copyright: rawConfig.copyright || '',
    feedId: rawConfig.feedId,
    feedName: rawConfig.feedName,
    feedType: rawConfig.feedType,
    language: rawConfig.language,
    updated: rawConfig.updated || new Date(),
    ttl: rawConfig.ttl,
    image: rawConfig.image,
    generator: rawConfig.generator,
    config: imapOriginalConfig,
    webhook: rawConfig.webhook, // Pass through webhook configuration
};

console.log("[IMAP Node Watcher] ImapWatcher will attempt to connect to host:", completeFeedConfig.config?.host, "port:", completeFeedConfig.config?.port);
console.log("[IMAP Node Watcher] Webhook configuration:", JSON.stringify({
    enabled: completeFeedConfig.webhook?.enabled,
    url: completeFeedConfig.webhook?.url ? '[REDACTED]' : undefined,
    format: completeFeedConfig.webhook?.format,
    newItemsOnly: completeFeedConfig.webhook?.newItemsOnly
}, null, 2));

const watcher = new ImapWatcher(completeFeedConfig); 

watcher.start();
