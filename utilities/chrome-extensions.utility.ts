import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

/**
 * Gets Chrome extension paths from the configured extensions directory
 * @returns Array of absolute paths to Chrome extensions
 */
export function getChromeExtensionPaths(): string[] {
  // Default to /app/extensions if not configured
  const extensionsDir = process.env.CHROME_EXTENSIONS_PATH || "/app/extensions";

  console.log(`[Extensions] CHROME_EXTENSIONS_PATH env var: "${process.env.CHROME_EXTENSIONS_PATH}" (using: "${extensionsDir}")`);


  try {
    // Check if the directory exists - silently skip if not
    if (!existsSync(extensionsDir)) {
      console.log(`[Extensions] Directory does not exist: ${extensionsDir}`);
      return [];
    }

    console.log(`[Extensions] Directory exists: ${extensionsDir}`);

    // Read all items in the extensions directory
    const items = readdirSync(extensionsDir);
    console.log(`[Extensions] Found ${items.length} item(s) in directory:`, items);

    // Filter for directories (each extension should be in its own folder)
    const extensionPaths = items
      .map((item) => join(extensionsDir, item))
      .filter((itemPath) => {
        try {
          const isDir = statSync(itemPath).isDirectory();
          console.log(`[Extensions] ${itemPath} is directory: ${isDir}`);
          return isDir;
        } catch (err) {
          console.warn(`[Extensions] Could not stat ${itemPath}:`, err);
          return false;
        }
      });

    console.log(
      `[Extensions] Found ${extensionPaths.length} extension folder(s):`,
      extensionPaths,
    );

    // Only log if extensions were actually found
    if (extensionPaths.length > 0) {
      console.log(
        `[Extensions] Loaded ${extensionPaths.length} Chrome extension(s):`,
        extensionPaths.map((p) => p.split("/").pop()),
      );
    } else {
      console.log("[Extensions] No valid extension folders found");
    }

    return extensionPaths;
  } catch (error) {
    console.error(
      `[Extensions] Error loading Chrome extensions from ${extensionsDir}:`,
      error,
    );
    return [];
  }
}

/**
 * Gets launch options for Chromium with extensions loaded
 * @param baseOptions Base Chromium launch options
 * @returns Launch options with extensions configured
 */
export function getChromiumLaunchOptions(baseOptions: any = {}) {
  const extensionPaths = getChromeExtensionPaths();
  const args = baseOptions.args || [];

  // Add stealth arguments to avoid bot detection (always)
  args.push("--disable-blink-features=AutomationControlled");
  args.push("--disable-dev-shm-usage");
  args.push("--no-sandbox");
  args.push("--disable-web-security");
  args.push("--disable-features=IsolateOrigins,site-per-process");

  // Add extension paths if any extensions are configured
  if (extensionPaths.length > 0) {
    const extensionArg = `--load-extension=${extensionPaths.join(",")}`;
    const disableExceptArg = `--disable-extensions-except=${extensionPaths.join(",")}`;
    args.push(disableExceptArg);
    args.push(extensionArg);
    console.log(`[Extensions] Added extension arguments to Chrome launch:`);
    console.log(`[Extensions] ${disableExceptArg}`);
    console.log(`[Extensions] ${extensionArg}`);
  } else {
    console.log("[Extensions] No extensions to load, launching without extension arguments");
  }

  return {
    ...baseOptions,
    args,
    // Extensions work with new headless mode when using channel: 'chrome' or 'chromium'
    // Keep the original headless setting from baseOptions
  };
}
