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
        "--preview",
        preview
      ],
      stdout: "pipe",
      stderr: "inherit",
    });

    const previewPromise = new Response(childProcess.stdout).text();

    childProcess.onexit = async (exitCode) => {
      if (preview) {
        const rssResult = await previewPromise;
        console.log("Preview result: ", rssResult);
        self.postMessage({ status: "IMAP worker finished.", data: rssResult });
      } else {
        console.log("[IMAP WORKER] Exited:", exitCode);
      }
      childProcess = null;
    };
  
  } else if (message.data.command === "stop" && childProcess) {
    console.log("[IMAP WORKER] Stopping Node IMAP watcher...");
    childProcess.kill();
    childProcess = null;
    self.postMessage({ status: "IMAP worker stopped." });
  }
};
