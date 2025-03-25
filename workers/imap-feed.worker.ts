import ImapWatcher from "../utilities/imap-watch.utility";
import { ImapConfig } from "../models/imapconfig.model";

let watcher: ImapWatcher | null = null;
declare var self: Worker;

self.onmessage = (message) => {
  if (message.data.command === "start") {
    const config: ImapConfig = message.data.config.config;
    watcher = new ImapWatcher(config, message.data.encryptionKey);
    watcher.start();
    self.postMessage({ status: "IMAP worker started." });
  } else if (message.data.command === "stop" && watcher) {
    watcher.stop();
    self.postMessage({ status: "IMAP worker stopped." });
  }
};
