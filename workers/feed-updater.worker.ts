import { writeFile } from 'fs/promises';
import axios from 'axios';
import { buildRSS, buildRSSFromApiData } from '../utilities/rss-builder.utility';
import { join } from 'path';
import * as url from 'url';

declare var self: Worker;

// Directories
const rssDir = './public/feeds';

// Function to fetch data and update the feed
async function fetchDataAndUpdateFeed(feedConfig) {
  try {
    var rssXml;

    if(feedConfig.feedType === 'webScraping') {
      const response = await axios.get(feedConfig.config.baseUrl);
      const html = response.data;
    // Generate the RSS feed using your buildRSS function
    rssXml = buildRSS(
      html,
      feedConfig.config,
      feedConfig.article,
      undefined,
      undefined,
      undefined,
      undefined,
      feedConfig.reverse
    );
  } else if(feedConfig.feedType === 'api') {
    // Generate the RSS feed using your buildRSSFromApiData function
    const axiosConfig = {
      method: feedConfig.config.method || 'GET',
      url: feedConfig.config.baseUrl + (feedConfig.config.route || ''),
      headers: feedConfig.config.headers || {},
      params: feedConfig.config.params || {},
      data: feedConfig.config.body || {},
      withCredentials: feedConfig.config.withCredentials || false,
    };

    console.log('axiosConfig:', axiosConfig);
    const response = await axios(axiosConfig);
    const apiData = response.data;

    rssXml = buildRSSFromApiData(apiData, feedConfig.config, feedConfig.apiMapping);
  }
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
  if (message.data.command === 'start') {
    fetchDataAndUpdateFeed(message.data.config);
  }
};