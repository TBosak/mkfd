import { readFile, readdir, writeFile } from 'fs/promises';
import yaml from 'js-yaml';
import axios from 'axios';
import { buildRSS } from '../utilities/rss-builder.utility';
import { join } from 'path';

declare var self: Worker;

// Directories
const yamlDir = './configs';
const rssDir = './public/feeds';

// Function to process feeds
async function processFeeds() {
  try {
    const files = await readdir(yamlDir);
    const yamlFiles = files.filter((file) => file.endsWith('.yaml'));

    for (const file of yamlFiles) {
      const filePath = join(yamlDir, file);
      const yamlContent = await readFile(filePath, 'utf8');
      const feedConfig = yaml.load(yamlContent);

      // Fetch data and update the RSS feed
      await fetchDataAndUpdateFeed(feedConfig);
    }

    // Notify the parent that processing is done
    self.postMessage({ status: 'done' });
  } catch (error) {
    console.error('Error processing feeds:', error);
    self.postMessage({ status: 'error', error: error.message });
  }
}

// Function to fetch data and update the feed
async function fetchDataAndUpdateFeed(feedConfig) {
  try {
    const response = await axios.get(feedConfig.config.baseUrl);
    const html = response.data;

    // Generate the RSS feed using your buildRSS function
    const rssXml = buildRSS(
      html,
      feedConfig.article,
      undefined,
      undefined,
      undefined,
      undefined,
      feedConfig.timestamp,
      feedConfig.reverse
    );

    // Save the RSS XML to a file
    const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`);
    await writeFile(rssFilePath, rssXml, 'utf8');

    console.log(`RSS feed updated for feedId: ${feedConfig.feedId}`);
  } catch (error) {
    console.error(`Error fetching data for feedId ${feedConfig.feedId}:`, error.message);
  }
}

// Listen for messages from the parent thread
self.onmessage = (message) => {
  if (message.data === 'start') {
    processFeeds();
  }
};