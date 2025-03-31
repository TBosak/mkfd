import { writeFile } from "fs/promises"
import axios from "axios"
import { buildRSS, buildRSSFromApiData } from "../utilities/rss-builder.utility"
import { join } from "path"
import puppeteer from "puppeteer"

declare var self: Worker
const rssDir = "./public/feeds"

async function fetchDataAndUpdateFeed(feedConfig) {
  try {
    let rssXml
    if (feedConfig.feedType === "webScraping" && !feedConfig.config.advanced) {
      const response = feedConfig.article.headers
        ? await axios.get(feedConfig.config.baseUrl, { headers: feedConfig.article.headers })
        : await axios.get(feedConfig.config.baseUrl)
      const html = response.data
      rssXml = await buildRSS(html, feedConfig)
    } else if (feedConfig.feedType === "webScraping" && feedConfig.config.advanced) {
      const browser = await puppeteer.launch()
      const page = await browser.newPage()
      await page.goto(feedConfig.config.baseUrl, { waitUntil: "networkidle2" })
      const html = await page.content()
      await browser.close()
      rssXml = await buildRSS(html, feedConfig)
    } else if (feedConfig.feedType === "api") {
      const axiosConfig = {
        method: feedConfig.config.method || "GET",
        url: feedConfig.config.baseUrl + (feedConfig.config.route || ""),
        headers: feedConfig.config.headers || {},
        params: feedConfig.config.params || {},
        data: feedConfig.config.body || {},
        withCredentials: feedConfig.config.withCredentials || false
      }
      const response = await axios(axiosConfig)
      const apiData = response.data
      rssXml = buildRSSFromApiData(apiData, feedConfig)
    } else if (feedConfig.feedType === "email") {
    }
    const rssFilePath = join(rssDir, `${feedConfig.feedId}.xml`)
    await writeFile(rssFilePath, rssXml, "utf8")
  } catch (error) {
    console.error(`Error fetching data for feedId ${feedConfig.feedId}:`, error.message)
  }
}

self.onmessage = (message) => {
  if (message.data.command === "start") {
    fetchDataAndUpdateFeed(message.data.config)
  }
}
