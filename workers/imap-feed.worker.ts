declare var self: Worker;

import { spawn } from "bun";

let childProcess: any = null;

self.onmessage = (message) => {
  if (message.data.command === "start" && !childProcess) {
    const encryptionKey = message.data.encryptionKey;
    const configHash = message.data.config.feedId;
    const preview = message.data.preview || false;

    if (!encryptionKey || typeof encryptionKey !== "string") {
      console.error("[IMAP WORKER] Invalid encryption key:", encryptionKey);
      self.postMessage({ status: "error", error: "Invalid encryption key" });
      return;
    }

    console.log("[IMAP WORKER] Spawning Node IMAP watcher subprocess...");
    childProcess = spawn({
      cmd: [
        "node",
        "./node/imap-watch.utility.ts",
        `--key=${encryptionKey}`,
        `--hash=${configHash}`,
        `--preview=${preview}`,
      ],
      stdout: preview ? "pipe" : "inherit",
      stderr: "inherit",
    });

    if (preview) {
      let rssChunks = "";
      const reader = childProcess.stdout.getReader();
    
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          rssChunks += new TextDecoder().decode(value);
        }
      })();
    
      childProcess.onexit = () => {
        console.log("Preview result: ", rssChunks);
        self.postMessage({ status: "finished", data: rssChunks });
        childProcess = null;
      };
    } else {
      childProcess.onexit = async (exitCode) => {
        console.log("[IMAP WORKER] Exited:", exitCode);
        childProcess = null;
      };
    }
  } else if (message.data.command === "stop" && childProcess) {
    console.log("[IMAP WORKER] Stopping Node IMAP watcher...");
    childProcess.kill();
    childProcess = null;
    self.postMessage({ status: "IMAP worker stopped." });
  }
};
