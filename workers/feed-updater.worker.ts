import { writeFile } from "fs/promises";
import axios from "axios";
import {
  buildRSS,
  buildRSSFromApiData,
} from "../utilities/rss-builder.utility";
import { join } from "path";

declare var self: Worker;
const rssDir = "./public/feeds";

async function fetchDataAndUpdateFeed(feedConfig) {
  try {
    var rssXml;

    if (feedConfig.feedType === "webScraping") {
      const response = feedConfig.article.headers
        ? await axios.get(feedConfig.config.baseUrl, {
            headers: feedConfig.article.headers,
          })
        : await axios.get(feedConfig.config.baseUrl);
      const html = response.data;
      rssXml = await buildRSS(
        html,
        feedConfig.config,
        feedConfig.article,
        feedConfig.reverse
      );
    } else if (feedConfig.feedType === "api") {
      const axiosConfig = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        headers: feedConfig.config.headers || {},
        params: feedConfig.config.params || {},
        data: feedConfig.config.body || {},
        withCredentials: feedConfig.config.withCredentials || false,
      };

      console.log("axiosConfig:", axiosConfig);
      const response = await axios(axiosConfig);
      const apiData = response.data;

      rssXml = buildRSSFromApiData(
        apiData,
        feedConfig.config,
        feedConfig.apiMapping
      );
    } else if (feedConfig.feedType === "email") {
      
    }
    const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`);
    await writeFile(rssFilePath, rssXml, "utf8");

    console.log(`RSS feed updated for feedId: ${feedConfig.feedId}`);
  } catch (error) {
    console.error(
      `Error fetching data for feedId ${feedConfig.feedId}:`,
      error.message
    );
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    fetchDataAndUpdateFeed(message.data.config);
  }
};
