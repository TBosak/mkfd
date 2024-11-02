import { file } from 'bun';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import CSSTarget from './models/csstarget.model';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import ApiConfig from './models/apiconfig.model';

const app = new Hono()

var feedUpdater: Worker;

const feedPath = join(__dirname, '/public/feeds');
if (!existsSync(feedPath)) {
  mkdirSync(feedPath);
}

const configsDir = join(__dirname, 'configs');
if (!existsSync(configsDir)) {
  mkdirSync(configsDir);
}

// Start processing immediately on startup
startFeedUpdaterWorker();
feedUpdater.postMessage('start');

// Schedule the cron job
setInterval(() => {
  if (!feedUpdater) {
    startFeedUpdaterWorker();
  } else {
    feedUpdater.postMessage('start');
  }
}, 60 * 1000); // Every minute

app.use('/public/*', serveStatic({ root: './' }))
app.use('/feeds/*', serveStatic({ root: './' }))
app.use('/configs/*', serveStatic({ root: './' }))

app.get('/', (ctx) => ctx.html(file('./public/index.html').text()));

app.post('/', async (ctx) => {
  const feedId = uuidv4();
    const data = await ctx.req.formData();
      const apiConfig: ApiConfig = {
        title: data.get("feedName")?.toString() || "RSS Feed",
        baseUrl: data.get("feedUrl")?.toString(),
      }
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
      const timestamp = (data.get("timestamp")?.toString() === 'on');
      const reverse = (data.get("reverse")?.toString() === 'on');

      const feedConfig = {
        feedId,
        feedName: apiConfig.title,
        config: apiConfig,
        article: {
          iterator: iteratorTarget,
          title: titleTarget,
          description: descriptionTarget,
          link: linkTarget,
          date: dateTarget,
        },
        timestamp: timestamp,
        reverse: reverse,
      };
  
      // Convert the feedConfig to YAML
      const yamlStr = yaml.dump(feedConfig);
  
      // Save the YAML file
      const yamlFilePath = join(configsDir, `${feedId}.yaml`);
      writeFileSync(yamlFilePath, yamlStr, 'utf8');
  
      // Provide the user with the RSS feed URL
      startFeedUpdaterWorker();
      return ctx.html(`
        <p>Your RSS feed is being generated and will update periodically.</p>
        <p>Access it at: <a href="/feeds/${feedId}.xml">/feeds/${feedId}.xml</a></p>
      `);
});

function startFeedUpdaterWorker() {
  feedUpdater = new Worker("./workers/feed-updater.worker.ts", { type: "module" });

  feedUpdater.onmessage = (message) => {
    if (message.data.status === 'done') {
      console.log('Feed updates completed.');
    } else if (message.data.status === 'error') {
      console.error('Feed updates encountered an error:', message.data.error);
    }
  };

  feedUpdater.onerror = (error) => {
    console.error('Worker error:', error);
  };
}

export default { 
  port: 5000, 
  fetch: app.fetch, 
} 