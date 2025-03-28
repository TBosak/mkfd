#!/usr/bin/env node
import yaml from 'js-yaml';
import path from 'path';
import Imap from 'node-imap';
import libmime from 'libmime';
import { minimist } from 'minimist';

const { decrypt } = require('./utilities/security.utility'); 

// Parse CLI args: e.g. node imap-watcher.service.js --key=mySecret --hash=feed123
const args = minimist(process.argv.slice(2));
const encryptionKey = args.key || '';
const configHash = args.hash || '';

if (!encryptionKey || !configHash) {
  console.error('Usage: node imap-watcher.service.js --key=<encryptionKey> --hash=<configHash>');
  process.exit(1);
}

const yamlPath = path.join(__dirname, 'configs', `${configHash}.yaml`);
if (!fs.existsSync(yamlPath)) {
  console.error(`YAML config not found at: ${yamlPath}`);
  process.exit(1);
}

const fileContents = fs.readFileSync(yamlPath, 'utf8');
const rawConfig = yaml.load(fileContents);

const imapConfig = {
  host: rawConfig.host,
  port: rawConfig.port,
  user: rawConfig.user,
  password: decrypt(rawConfig.encryptedPassword, encryptionKey),
  folder: rawConfig.folder || 'INBOX'
};

class ImapWatcher {
  imap: Imap;
  constructor(public config) {
    this.config = config;
    this.imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: true
    });
  }

  async start() {
    try {
      await this.connect();
      await this.openBox(this.config.folder);
      this.fetchRecentStartupEmails();

      this.imap.on('mail', (n) => {
        console.log(`[IMAP] New mail event: ${n}`);
        this.fetchNewEmails();
      });

      this.imap.on('close', () => this.reconnect());
      this.imap.on('error', () => this.reconnect());
    } catch (err) {
      console.error('[IMAP] Failed to start:', err);
      this.reconnect();
    }
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.imap.once('ready', () => {
        console.log('[IMAP] Connected');
        resolve();
      });
      this.imap.once('error', reject);
      this.imap.connect();
    });
  }

  openBox(boxName) {
    return new Promise<void>((resolve, reject) => {
      this.imap.openBox(boxName, false, (err) => {
        if (err) return reject(err);
        console.log(`[IMAP] Box "${boxName}" opened`);
        resolve();
      });
    });
  }

  fetchRecentStartupEmails() {
    console.log('[IMAP] Running fetchRecentStartupEmails...');
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    this.imap.search([['SINCE', twoDaysAgo.toUTCString()]], (err, results) => {
      if (err || !results || results.length === 0) {
        console.log('[IMAP] No recent emails found on startup.');
        return;
      }

      // Last 10
      const recentUids = results.sort((a, b) => a - b).slice(-10);
      console.log('[IMAP] Startup message UIDs:', recentUids);

      const fetch = this.imap.fetch(recentUids, { bodies: [""], struct: true });
      const tasks = [];

      fetch.on('message', (msg, seqno) => {
        const chunks = [];
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf-8') : chunk);
          });
        });

        const task = new Promise<void>((resolve, reject) => {
          msg.once('end', async () => {
            try {
              const raw = Buffer.concat(chunks);
              const parsed = await simpleParser(raw);

              const subject = parsed.subject ? libmime.decodeWords(parsed.subject) : '(No Subject)';
              const from = parsed.from?.text ? libmime.decodeWords(parsed.from.text) : '(Unknown Sender)';
              const date = parsed.date?.toISOString?.() ?? new Date().toISOString();
              const content = parsed.text ?? parsed.html ?? '(No content)';

              console.log(`[IMAP] [${seqno}]`);
              console.log(`→ Subject: ${subject}`);
              console.log(`→ From: ${from}`);
              console.log(`→ Date: ${date}`);
              console.log(`→ Content Preview:\n${content.substring(0, 200)}...`);

              resolve();
            } catch (err) {
              console.error(`[IMAP] Failed to parse message ${seqno}:`, err);
              reject(err);
            }
          });
        });
        tasks.push(task);
      });

      fetch.once('end', async () => {
        await Promise.allSettled(tasks);
        console.log('[IMAP] Finished processing all startup emails.');
      });

      fetch.once('error', (err) => {
        console.error('[IMAP] Startup fetch error:', err);
      });
    });
  }

  fetchNewEmails() {
    console.log('[IMAP] Running fetchNewEmails...');
    
  }

  reconnect() {
    console.log('[IMAP] Reconnecting in 10s...');
    setTimeout(() => this.start(), 10000);
  }

  stop() {
    if (this.imap) {
      console.log('[IMAP] Stopping watcher...');
      this.imap.end();
    }
  }
}

// 4. Create watcher instance, pass config with decrypted password
const watcher = new ImapWatcher(imapConfig);

// 5. Start the watcher
watcher.start();
