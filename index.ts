import { file } from 'bun';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import CSSTarget from './models/csstarget.model';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import ApiConfig from './models/apiconfig.model';
import { writeFile } from 'fs/promises';

const app = new Hono()

var feedUpdaters: Map<string, Worker> = new Map();
var feedIntervals: Map<string, Timer> = new Map();

const feedPath = join(__dirname, '/public/feeds');
if (!existsSync(feedPath)) {
  mkdirSync(feedPath);
}

const configsDir = join(__dirname, 'configs');
if (!existsSync(configsDir)) {
  mkdirSync(configsDir);
}

// Start processing immediately on startup
processFeedsAtStart();

app.use('/public/*', serveStatic({ root: './' }))
app.use('/feeds/*', serveStatic({ root: './' }))
app.use('/configs/*', serveStatic({ root: './' }))

app.get('/', (ctx) => ctx.html(file('./public/index.html').text()));

app.post('/', async (ctx) => {
    const feedId = uuidv4();
    const data = await ctx.req.formData();
    var article = {};
    var apiMapping = {};
    const feedType = data.get("feedType")?.toString();
      const apiConfig: ApiConfig = {
        title: data.get("feedName")?.toString() || "RSS Feed",
        baseUrl: data.get("feedUrl")?.toString(),
      }

      if(feedType === 'webScraping') {
      const iteratorTarget = new CSSTarget(
        data.get("itemSelector")?.toString(),
      );
      const titleTarget = new CSSTarget(
      data.get("titleSelector")?.toString(),
      data.get("titleAttribute")?.toString() || undefined,
      data.get("titleStripHtml")?.toString() === 'on',
      "",
      false,
      data.get("titleTitleCase")?.toString() === 'on'
      );
      const descriptionTarget = new CSSTarget(
        data.get("descriptionSelector")?.toString(),
        data.get("descriptionAttribute")?.toString() || undefined,
        data.get("descriptionStripHtml")?.toString() === 'on',
        "",
        false,
        data.get("descriptionTitleCase")?.toString() === 'on'
      );
      const linkTarget = new CSSTarget(
        data.get("linkSelector")?.toString(),
        data.get("linkAttribute")?.toString() || undefined,
        false,
        data.get("linkBaseUrl")?.toString(),
        data.get("linkRelativeLink")?.toString() === 'on',
        false
      );
      const dateTarget = new CSSTarget(
        data.get("dateSelector")?.toString(),
        data.get("dateAttribute")?.toString() || undefined,
        data.get("dateStripHtml")?.toString() === 'on',
        "",
        false,
        false
      );

      article = {
        iterator: iteratorTarget,
        title: titleTarget,
        description: descriptionTarget,
        link: linkTarget,
        date: dateTarget,
    }
  }
    else if (feedType === 'api') {
      // API configuration
      apiConfig.method = data.get("apiMethod")?.toString() || 'GET';
      apiConfig.route = data.get("apiRoute")?.toString();
  
      // Parse JSON inputs
      try {
        apiConfig.params = JSON.parse(data.get("apiParams")?.toString() || '{}');
      } catch {
        return ctx.text('Invalid JSON in API parameters.', 400);
      }
  
      try {
        apiConfig.headers = JSON.parse(data.get("apiHeaders")?.toString() || '{}');
      } catch {
        return ctx.text('Invalid JSON in API headers.', 400);
      }
  
      try {
        apiConfig.body = JSON.parse(data.get("apiBody")?.toString() || '{}');
      } catch {
        return ctx.text('Invalid JSON in API body.', 400);
      }
  
      // API response mapping
      apiMapping = {
        items: data.get("apiItemsPath")?.toString(),
        title: data.get("apiTitleField")?.toString(),
        description: data.get("apiDescriptionField")?.toString(),
        link: data.get("apiLinkField")?.toString(),
        date: data.get("apiDateField")?.toString(),
      };
    }
      const refreshTime = parseInt(data.get("refreshTime")?.toString() || '5');
      const timestamp = (data.get("timestamp")?.toString() === 'on');
      const reverse = (data.get("reverse")?.toString() === 'on');

      const feedConfig = {
        feedId,
        feedName: apiConfig.title,
        feedType: data.get("feedType")?.toString() || "webScraping", // 'webScraping' or 'api'
        config: apiConfig,
        article: article,
        apiMapping: apiMapping,
        refreshTime: refreshTime,
        timestamp: timestamp,
        reverse: reverse,
      };
  
      // Convert the feedConfig to YAML
      const yamlStr = yaml.dump(feedConfig);
  
      // Save the YAML file
      const yamlFilePath = join(configsDir, `${feedId}.yaml`);
      await writeFile(yamlFilePath, yamlStr, 'utf8');
  
      // Provide the user with the RSS feed URL
      setFeedUpdaterInterval(feedConfig);
      return ctx.html(`
        <p>Your RSS feed is being generated and will update every ${refreshTime} minutes.</p>
        <p>Access it at: <a href="/feeds/${feedId}.xml">/feeds/${feedId}.xml</a></p>
      `);
});

function initializeWorker(feedConfig: any) {
  feedUpdaters.set(feedConfig.feedId, new Worker("./workers/feed-updater.worker.ts", { type: "module" }));

  feedUpdaters.get(feedConfig.feedId).onmessage = (message) => {
    if (message.data.status === 'done') {
      console.log(`Feed updates completed for ${feedConfig.feedId}.`);
    } else if (message.data.status === 'error') {
      console.error(`Feed updates for ${feedConfig.feedId} encountered an error:`, message.data.error);
    }
  };

  feedUpdaters.get(feedConfig.feedId).onerror = (error) => {
    console.error('Worker error:', error);
  };
}

async function processFeedsAtStart() {
  try {
    const files = await readdir(configsDir);
    const yamlFiles = files.filter((file) => file.endsWith('.yaml'));

    for (const file of yamlFiles) {
      const filePath = join(configsDir, file);
      const yamlContent = await readFile(filePath, 'utf8');
      const feedConfig = yaml.load(yamlContent);
      console.log('Processing feed:', feedConfig.feedId);
      setFeedUpdaterInterval(feedConfig);
    }
}
catch (error) {
  console.error('Error processing feeds:', error);
  }
}

// Schedule the cron job
function setFeedUpdaterInterval(feedConfig: any) {
  const feedId = feedConfig.feedId;

  // Check if an interval already exists
  if (!feedIntervals.has(feedId)) {
    console.log('Setting interval for feed:', feedId);

    // Initialize the worker if not already done
    if (!feedUpdaters.has(feedId)) {
      console.log('Initializing worker for feed:', feedId);
      initializeWorker(feedConfig);
      feedUpdaters.get(feedConfig.feedId).postMessage({command: "start", config: feedConfig});
    }

    // Set the interval and store the interval ID
    const interval = setInterval(() => {
      console.log('Engaging worker for feed:', feedId);
      feedUpdaters.get(feedId).postMessage({ command: 'start', config: feedConfig });
    }, feedConfig.refreshTime * 60 * 1000);

    feedIntervals.set(feedId, interval);
  }
}

function clearAllFeedUpdaterIntervals() {
  for (const [feedId, intervalId] of feedIntervals.entries()) {
    clearFeedUpdaterInterval(feedId);

    // Terminate the worker
    const worker = feedUpdaters.get(feedId);
    if (worker) {
      worker.terminate();
      feedUpdaters.delete(feedId);
    }
  }
}

function clearFeedUpdaterInterval(feedId: string) {
  const interval = feedIntervals.get(feedId);
  if (interval) {
    clearInterval(interval);
    feedIntervals.delete(feedId);
  }
}

export default { 
  port: 5000, 
  fetch: app.fetch, 
}

// Listen for process exit events
process.on('exit', () => {
  clearAllFeedUpdaterIntervals();
});

process.on('SIGINT', () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});

process.on('SIGTERM', () => {
  clearAllFeedUpdaterIntervals();
  process.exit();
});