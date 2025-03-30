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

const imapConfig = {
  host: rawConfig.config.host,
  port: rawConfig.config.port,
  user: rawConfig.config.user,
  password: decrypt(rawConfig.config.encryptedPassword, encryptionKey),
  folder: rawConfig.config.folder || "INBOX",
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

  emails.forEach((email) => {
    feed.item({
      title: email.subject,
      description: email.content,
      author: email.from,
      url: email.link,
      guid: email.UID,
      date: email.date || new Date(),
    });
  });

  return feed.xml({ indent: true });
}

const watcher = new ImapWatcher(imapConfig);

watcher.start();
