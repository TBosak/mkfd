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
import cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = minimist(process.argv.slice(2));
const encryptionKey: string = args.key || "";
const configHash: string = args.hash || "";

export interface Email {
  UID: number;
  subject: string;
  from: string;
  date: string;
  content: string;
}

if (!encryptionKey || !configHash) {
  console.error(
    "Usage: node imap-watcher.service.ts --key=<encryptionKey> --hash=<configHash>",
  );
  process.exit(1);
}

const yamlPath: string = path.join(
  __dirname,
  "../configs",
  `${configHash}.yaml`,
);
if (!existsSync(yamlPath)) {
  console.error(`YAML config not found at: ${yamlPath}`);
  process.exit(1);
}

const fileContents = readFileSync(yamlPath, "utf8");
const rawConfig = yaml.load(fileContents);

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

class ImapWatcher {
  private config: any;
  private imap: Imap;

  constructor(config: any) {
    this.config = config;
    this.imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: true,
    });
  }

  async start(): Promise<void> {
    try {
      await this.connect();
      await this.openBox(this.config.folder);
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

              const subject = parsed.subject
                ? libmime.decodeWords(parsed.subject)
                : "(No Subject)";
              const from = parsed.from?.text
                ? libmime.decodeWords(parsed.from.text)
                : "(Unknown Sender)";
              const date =
                parsed.date?.toISOString() || new Date().toISOString();
              const content = parsed.text || parsed.html || "(No content)";
              const email: Email = {
                UID: seqno,
                subject,
                from,
                date,
                content,
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
              path.join(__dirname, "../public/feeds", `${configHash}.xml`),
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

      const emailLimit = this.config.config?.emailCount || 10;
      const recentUids = results.sort((a, b) => a - b).slice(-emailLimit);
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

              const subject = parsed.subject
                ? libmime.decodeWords(parsed.subject)
                : "(No Subject)";
              const from = parsed.from?.text
                ? libmime.decodeWords(parsed.from.text)
                : "(Unknown Sender)";
              const date =
                parsed.date?.toISOString() || new Date().toISOString();
              const content = parsed.text || parsed.html || "(No content)";
              const email: Email = {
                UID: seqno,
                subject,
                from,
                date,
                content,
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
              path.join(__dirname, "../public/feeds", `${configHash}.xml`),
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

export function buildRSSFromEmailFolder(emails, config) {
  const feed = new RSS({
    title: config.title || "Email RSS Feed",
    description: "RSS feed generated from IMAP email folder",
    pubDate: new Date(),
  });

  // Helper function to sanitize content for XML/RSS
  const sanitizeForXML = (content: string): string => {
    if (!content) return content;
    return content
      .replace(/]]>/g, ']]&gt;') // Escape CDATA closing sequence
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove invalid XML characters
      .replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, '&amp;'); // Escape unescaped ampersands
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

    // Sanitize both description and content for XML
    descriptionText = sanitizeForXML(descriptionText || "");
    contentEncodedHtml = sanitizeForXML(contentEncodedHtml || "");


    const itemOptions: RSSItemOptions = {
      title: sanitizeForXML(email.subject || "(No Subject)"),
      description: descriptionText,
      contentEncoded: contentEncodedHtml,
      author: sanitizeForXML(email.from || ""), 
      date: email.date ? new Date(email.date) : new Date(),
      guid: email.messageId || email.UID.toString(), // Use Message-ID as GUID, fallback to UID
      url: undefined, // Email items generally don't have a direct public URL by default
      categories: email.headers?.get('keywords') ? String(email.headers.get('keywords')).split(',').map(k => sanitizeForXML(k.trim())) : undefined,
      enclosure: email.attachments && email.attachments.length > 0 && email.attachments[0].content && email.attachments[0].size && email.attachments[0].contentType ? {
        // For local/internal use, CID linking might work if the RSS reader processes related MIME parts.
        // For external/public RSS, attachments need to be hosted and linked via a public URL.
        // This placeholder will use CID, assuming a capable reader or internal use.
        url: email.attachments[0].filename ? `cid:${sanitizeForXML(email.attachments[0].filename)}` : (email.attachments[0].contentId ? `cid:${sanitizeForXML(email.attachments[0].contentId)}` : undefined),
        length: email.attachments[0].size,
        type: email.attachments[0].contentType,
      } : undefined,
      customElements: [
        { 'email:to': Array.isArray(email.to) ? email.to.join(', ') : email.to },
        { 'email:cc': Array.isArray(email.cc) ? email.cc.join(', ') : email.cc },
      ].filter(el => Object.values(el)[0] !== undefined).map(el => {
        const key = Object.keys(el)[0];
        const value = Object.values(el)[0];
        return { [key]: sanitizeForXML(String(value)) };
      }) 
    };
    // Remove enclosure if its URL could not be formed
    if (itemOptions.enclosure && !itemOptions.enclosure.url) {
        delete itemOptions.enclosure;
    }
    feed.item(itemOptions);
  });

  return feed.xml({ indent: true });
}

const watcher = new ImapWatcher(imapOriginalConfig);

watcher.start();
