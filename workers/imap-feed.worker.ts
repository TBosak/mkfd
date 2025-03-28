declare var self: Worker;

import { spawn } from "bun";

let childProcess: any = null;

self.onmessage = (message) => {
  if (message.data.command === "start" && !childProcess) {
    const encryptionKey = message.data.encryptionKey;
    const configHash = message.data.hash || "default-config-hash";

    if (!encryptionKey || typeof encryptionKey !== "string") {
      console.error("[IMAP WORKER] Invalid encryption key:", encryptionKey);
      self.postMessage({ status: "error", error: "Invalid encryption key" });
      return;
    }

    console.log("[IMAP WORKER] Spawning Node IMAP watcher subprocess...");

    childProcess = spawn({
      cmd: [
        "node",
        "imap-watcher.service.js",
        `--key=${encryptionKey}`,
        `--hash=${configHash}`
      ],
      stdout: "pipe",
      stderr: "pipe"
    });

    // Optional: watch stdout/stderr to see logs from the Node script
    childProcess.stdout.ondata = (chunk) => {
      console.log("[Node IMAP stdout]", chunk.toString());
    };
    childProcess.stderr.ondata = (chunk) => {
      console.error("[Node IMAP stderr]", chunk.toString());
    };

    childProcess.onexit = (exitCode) => {
      console.log("[IMAP WORKER] Node IMAP process exited with code:", exitCode);
      childProcess = null;
    };

    self.postMessage({ status: "IMAP worker started." });

  } else if (message.data.command === "stop" && childProcess) {
    console.log("[IMAP WORKER] Stopping Node IMAP watcher...");
    childProcess.kill();
    childProcess = null;
    self.postMessage({ status: "IMAP worker stopped." });
  }
};
