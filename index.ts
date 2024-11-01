import { file } from 'bun';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import CSSTarget from './models/csstarget.model';
import { v4 as uuidv4 } from 'uuid';
import * as yaml from 'js-yaml';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const app = new Hono()

const yamlDir = join(__dirname, 'feeds');
if (!existsSync(yamlDir)) {
  mkdirSync(yamlDir);
}

app.use('/public/*', serveStatic({ root: './' }))
app.use('/feeds/*', serveStatic({ root: './' }))

app.get('/', (ctx) => ctx.html(file('./public/index.html').text()));

app.post('/', async (ctx) => {
  const feedId = uuidv4();
    const data = await ctx.req.formData();
      const feedName = data.get("feedName")?.toString() || "RSS Feed";
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
        feedName: feedName,
        config: null,
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
      const yamlFilePath = join(yamlDir, `${feedId}.yaml`);
      writeFileSync(yamlFilePath, yamlStr, 'utf8');
  
      // Provide the user with the RSS feed URL
      ctx.html(`
        <p>Your RSS feed is being generated and will update periodically.</p>
        <p>Access it at: <a href="/feed/${feedId}.xml">/feed/${feedId}.xml</a></p>
      `);
      return new Response();
});

export default { 
  port: 5000, 
  fetch: app.fetch, 
} 