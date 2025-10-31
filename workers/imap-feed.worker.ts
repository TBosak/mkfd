declare var self: Worker;

import { spawn } from "bun";

let childProcess: any = null;

self.onmessage = (message) => {
  if (message.data.command === "start" && !childProcess) {
    const encryptionKey = message.data.encryptionKey;
    const configHash = message.data.config.feedId;

    if (!encryptionKey || typeof encryptionKey !== "string") {
      console.error("[IMAP WORKER] Invalid encryption key:", encryptionKey);
      self.postMessage({ status: "error", error: "Invalid encryption key" });
      return;
    }

    console.log("[IMAP WORKER] Spawning Node IMAP watcher subprocess...");

    // Set default memory allocation if not already configured by user
    const nodeOptions = process.env.NODE_OPTIONS || "--max-old-space-size=4096";
    console.log(`[IMAP WORKER] Using NODE_OPTIONS: ${nodeOptions}`);

    childProcess = spawn({
      cmd: [
        "node",
        "./node/imap-watch.utility.ts",
        `--key=${encryptionKey}`,
        `--hash=${configHash}`,
      ],
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        NODE_OPTIONS: nodeOptions,
      },
    });

    // Now we can handle output
    // childProcess.stdout.ondata = (chunk) => {
    //   console.log("[Node IMAP stdout]", chunk.toString());
    // };
    // if (childProcess.stderr) {
    //   childProcess.stderr.ondata = (chunk) => {
    //     console.error("[Node IMAP stderr]", chunk.toString());
    //   };
    // }

    childProcess.onexit = (exitCode) => {
      console.log(
        "[IMAP WORKER] Node IMAP process exited with code:",
        exitCode,
      );
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
