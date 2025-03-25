import Imap from 'node-imap';
import { simpleParser } from 'mailparser';
import { decrypt } from './security.utility';
import { ImapConfig } from '../models/imapconfig.model';

export default class ImapWatcher {
  private imap: Imap;

  constructor(private config: ImapConfig, private encryptionKey: string) {}

  private createImapConnection(): Imap {
    return new Imap({
      user: this.config.user,
      password: decrypt(this.config.encryptedPassword, this.encryptionKey),
      host: this.config.host,
      port: this.config.port,
      tls: true
    });
  }

  async start(): Promise<void> {
    this.imap = this.createImapConnection();

    try {
      await this.connect();
      await this.openBox(this.config.folder);
      console.log(`[IMAP] Watching folder: ${this.config.folder}`);
      this.fetchNewEmails();

      this.imap.on('mail', (numNewMsgs) => {
        console.log(`[IMAP] New mail event: ${numNewMsgs}`);
        this.fetchNewEmails();
      });

      this.imap.on('error', (err) => {
        console.error('[IMAP] Error:', err);
        this.reconnect();
      });

      this.imap.on('close', (hadError) => {
        console.log('[IMAP] Connection closed', hadError ? '(with error)' : '');
        this.reconnect();
      });
    } catch (err) {
      console.error('[IMAP] Failed to start:', err);
      this.reconnect();
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.once('ready', () => {
        console.log('[IMAP] Connected');
        resolve();
      });
      this.imap.once('error', (err) => {
        reject(err);
      });
      this.imap.connect();
    });
  }

  private openBox(boxName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap.openBox(boxName, false, (err, box) => {
        if (err) return reject(err);
        console.log(`[IMAP] Box "${boxName}" opened`);
        resolve();
      });
    });
  }

  private fetchNewEmails(): void {
    this.imap.search(['ALL'], (err, results) => {
      if (err || !results || !results.length) {
        return;
      }
  
      const recentUids = results.slice(-10);
  
      const fetch = this.imap.fetch(recentUids, { bodies: '' });
  
      fetch.on('message', (msg) => {
        msg.on('body', async (stream) => {
          const parsed = await simpleParser(stream);
          console.log(`[IMAP] Recent email: ${parsed.subject}`);
          // You could emit events or handle RSS integration here.
        });
      });
  
      fetch.once('error', (err) => {
        console.error('[IMAP] Fetch error:', err);
      });
    });
  }  

  private reconnect(): void {
    console.log('[IMAP] Reconnecting in 10s...');
    setTimeout(() => this.start(), 10000);
  }

  stop(): void {
    if (this.imap) {
      console.log('[IMAP] Stopping watcher...');
      this.imap.end();
    }
  }
}
