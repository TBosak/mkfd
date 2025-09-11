#!/usr/bin/env bun
import { mkdir, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import * as yaml from "js-yaml";

// Test webhook functionality
async function testWebhookFunctionality() {
  console.log("Testing webhook functionality...");
  
  try {
    // Import webhook utilities
    const { sendWebhook, createWebhookPayload, getNewItemsFromRSS } = await import("./utilities/webhook.utility");
    const { storeFeedHistory, getPreviousFeedHistory } = await import("./utilities/feed-history.utility");
    
    // Create test directories
    const testConfigDir = "./test-configs";
    const testFeedDir = "./test-feeds";
    
    if (!existsSync(testConfigDir)) {
      await mkdir(testConfigDir, { recursive: true });
    }
    if (!existsSync(testFeedDir)) {
      await mkdir(testFeedDir, { recursive: true });
    }
    
    // Create a test feed configuration with webhook
    const testFeedConfig = {
      feedId: "test-webhook-feed",
      feedName: "Test Webhook Feed",
      feedType: "webScraping",
      webhook: {
        enabled: true,
        url: "https://httpbin.org/post", // Test endpoint
        format: "json",
        newItemsOnly: true,
        headers: {
          "Authorization": "Bearer test-token"
        }
      }
    };
    
    // Save test config
    const configPath = join(testConfigDir, "test-webhook-feed.yaml");
    await writeFile(configPath, yaml.dump(testFeedConfig), "utf8");
    console.log("✓ Created test feed configuration");
    
    // Create test RSS XML
    const testRSSXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <description>Test feed for webhook functionality</description>
    <link>https://example.com</link>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <item>
      <title>Test Item 1</title>
      <description>This is test item 1</description>
      <link>https://example.com/item1</link>
      <guid>item-1</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>Test Item 2</title>
      <description>This is test item 2</description>
      <link>https://example.com/item2</link>
      <guid>item-2</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;
    
    // Save test RSS
    const rssPath = join(testFeedDir, "test-webhook-feed.xml");
    await writeFile(rssPath, testRSSXml, "utf8");
    console.log("✓ Created test RSS feed");
    
    // Test webhook payload creation
    const payload = createWebhookPayload(testFeedConfig, testRSSXml, "manual");
    console.log("✓ Created webhook payload:", {
      feedId: payload.feedId,
      triggerType: payload.triggerType,
      itemCount: payload.itemCount
    });
    
    // Test new items detection
    const oldRSSXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <description>Test feed for webhook functionality</description>
    <link>https://example.com</link>
    <item>
      <title>Test Item 1</title>
      <description>This is test item 1</description>
      <link>https://example.com/item1</link>
      <guid>item-1</guid>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;
    
    const newItemsRss = getNewItemsFromRSS(testRSSXml, oldRSSXml);
    if (newItemsRss) {
      console.log("✓ New items detected correctly");
    } else {
      console.log("✗ Failed to detect new items");
    }
    
    // Test feed history storage
    await storeFeedHistory("test-feed", testRSSXml);
    const storedHistory = await getPreviousFeedHistory("test-feed");
    if (storedHistory && storedHistory.includes("Test Item 1")) {
      console.log("✓ Feed history storage working");
    } else {
      console.log("✗ Feed history storage failed");
    }
    
    // Test webhook sending (will fail due to no real endpoint, but tests the function)
    console.log("Testing webhook sending...");
    const webhookResult = await sendWebhook(testFeedConfig.webhook, payload);
    console.log("Webhook send result:", webhookResult ? "✓ Success" : "✗ Failed (expected for test endpoint)");
    
    console.log("\n🎉 Webhook functionality test completed!");
    
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error(error.stack);
  }
}

// Run the test
testWebhookFunctionality();