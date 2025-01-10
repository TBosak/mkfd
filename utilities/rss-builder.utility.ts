import * as cheerio from "cheerio";
import RSS from "rss";
import CSSTarget from "../models/csstarget.model";
import {
  processDates,
  processLinks,
  processWords,
  get,
} from "./data-handler.utility";
import ApiConfig from "./../models/apiconfig.model";

//TODO: ADD HTML STRIPPING TO EACH TARGET
export async function buildRSS(
  res: any,
  apiConfig?: ApiConfig,
  article?: {
    iterator: CSSTarget;
    title?: CSSTarget;
    description?: CSSTarget;
    author?: CSSTarget;
    link?: CSSTarget;
    date?: CSSTarget;
    enclosure?: CSSTarget;
  },
  reverse?: boolean
): Promise<string> {
  const $ = cheerio.load(res);
  const elements = $(article.iterator.selector).toArray();

  if (article) {
    const input = await Promise.all(
      elements.map(async (el, i) => {
        const itemData = {
          title: !article.title?.iterator
            ? !!article.title?.attribute
              ? processWords(
                  $(el)
                    .find(article.title?.selector)
                    ?.attr(article.title?.attribute),
                  article.title?.titleCase,
                  article.title?.stripHtml
                )
              : processWords(
                  $(el).find(article.title?.selector)?.text(),
                  article.title?.titleCase,
                  article.title?.stripHtml
                )
            : !!article.title?.attribute
            ? processWords(
                $($(article.title.iterator).toArray()[i])
                  .find(article.title.selector)
                  ?.attr(article.title?.attribute),
                article.title.titleCase,
                article.title.stripHtml
              )
            : processWords(
                $($(article.title.iterator).toArray()[i])
                  .find(article.title.selector)
                  .text(),
                article.title.titleCase,
                article.title.stripHtml
              ),
          description: !article.description?.iterator
            ? !!article.description?.attribute
              ? processWords(
                  $(el)
                    .find(article.description?.selector)
                    ?.attr(article.description?.attribute),
                  article.description?.titleCase,
                  article.description?.stripHtml
                )
              : processWords(
                  $(el).find(article.description?.selector)?.text(),
                  article.description?.titleCase,
                  article.description?.stripHtml
                )
            : !!article.description?.attribute
            ? processWords(
                $($(article.description.iterator).toArray()[i])
                  .find(article.description.selector)
                  ?.attr(article.description?.attribute),
                article.description.titleCase,
                article.description.stripHtml
              )
            : processWords(
                $($(article.description.iterator).toArray()[i])
                  .find(article.description.selector)
                  .text(),
                article.description.titleCase,
                article.description.stripHtml
              ),
          url: !article.link?.iterator
            ? !!article.link?.attribute
              ? processLinks(
                  $(el)
                    .find(article.link?.selector)
                    ?.attr(article.link?.attribute),
                  article.link?.stripHtml,
                  article.link?.relativeLink,
                  article.link?.rootUrl
                )
              : processLinks(
                  $(el).find(article.link?.selector)?.text(),
                  article.link?.stripHtml,
                  article.link?.relativeLink,
                  article.link?.rootUrl
                )
            : !!article.link?.attribute
            ? processLinks(
                $($(article.link.iterator).toArray()[i])
                  .find(article.link.selector)
                  ?.attr(article.link?.attribute),
                article.link.stripHtml,
                article.link.relativeLink,
                article.link.rootUrl
              )
            : processLinks(
                $($(article.link.iterator).toArray()[i])
                  .find(article.link.selector)
                  .text(),
                article.link.stripHtml,
                article.link.relativeLink,
                article.link.rootUrl
              ),
          author: !article.author?.iterator
            ? !!article.author?.attribute
              ? processWords(
                  $(el)
                    .find(article.author?.selector)
                    ?.attr(article.author?.attribute),
                  article.author?.titleCase,
                  article.author?.stripHtml
                )
              : processWords(
                  $(el).find(article.author?.selector)?.text(),
                  article.author?.titleCase,
                  article.author?.stripHtml
                )
            : !!article.author?.attribute
            ? processWords(
                $($(article.author.iterator).toArray()[i])
                  .find(article.author.selector)
                  ?.attr(article.author?.attribute),
                article.author.titleCase,
                article.author.stripHtml
              )
            : processWords(
                $($(article.author.iterator).toArray()[i])
                  .find(article.author.selector)
                  .text(),
                article.author.titleCase,
                article.author.stripHtml
              ),
          date: !article.date?.iterator
            ? !!article.date?.attribute
              ? processDates(
                  $(el)
                    .find(article.date?.selector)
                    ?.attr(article.date?.attribute),
                  article.date?.stripHtml
                )
              : processDates(
                  $(el).find(article.date?.selector)?.text(),
                  article.date?.stripHtml
                )
            : !!article.date?.attribute
            ? processDates(
                $($(article.date.iterator).toArray()[i])
                  .find(article.date.selector)
                  ?.attr(article.date?.attribute),
                article.date.stripHtml
              )
            : processDates(
                $($(article.date.iterator).toArray()[i])
                  .find(article.date.selector)
                  .text(),
                article.date.stripHtml
              ),
          enclosure: {
            url: !article.enclosure?.iterator
              ? !!article.enclosure?.attribute
                ? processLinks(
                    $(el)
                      .find(article.enclosure?.selector)
                      ?.attr(article.enclosure?.attribute),
                    article.enclosure?.stripHtml,
                    article.enclosure?.relativeLink,
                    article.enclosure?.rootUrl
                  )
                : processLinks(
                    $(el).find(article.enclosure?.selector)?.text(),
                    article.enclosure?.stripHtml,
                    article.enclosure?.relativeLink,
                    article.enclosure?.rootUrl
                  )
              : !!article.enclosure?.attribute
              ? processLinks(
                  $($(article.enclosure.iterator).toArray()[i])
                    .find(article.enclosure.selector)
                    ?.attr(article.enclosure?.attribute),
                  article.enclosure.stripHtml,
                  article.enclosure.relativeLink,
                  article.enclosure.rootUrl
                )
              : processLinks(
                  $($(article.enclosure.iterator).toArray()[i])
                    .find(article.enclosure.selector)
                    .text(),
                  article.enclosure.stripHtml,
                  article.enclosure.relativeLink,
                  article.enclosure.rootUrl
                ),
            size: 0,
            type: "application/octet-stream",
          },
        };
        if (itemData.enclosure.url) {
          try {
            const response = await fetch(itemData.enclosure.url);
            if (response.ok) {
              const contentLength = response.headers.get("content-length");
              const contentType = response.headers.get("content-type");
              itemData.enclosure["size"] = parseInt(contentLength) || 0;
              itemData.enclosure["type"] =
                contentType || "application/octet-stream";
            }
          } catch (err) {
            console.error(
              "Failed to fetch enclosure:",
              itemData.enclosure.url,
              err
            );
          }
        }

        return itemData; // This is the resolved value of the Promise
      })
    );

    // Optionally reverse
    if (reverse) {
      input.reverse();
    }

    // Now build the feed
    const feed = new RSS({
      title: apiConfig?.title || $("title")?.text(),
      description: $('meta[property="twitter:description"]')?.attr("content"),
      author: "mkfd",
      site_url: apiConfig.baseUrl,
      generator: "Generated by mkfd",
    });

    // Add each item
    for (const item of input) {
      feed.item({
        title: item.title,
        description: item.description,
        url: item.url,
        guid: Bun.hash(JSON.stringify(item)),
        author: item.author,
        date: item.date,
        enclosure: {
          url: item.enclosure.url,
          // RSS library looks for `size` and `type` exactly:
          size: item.enclosure.size,
          type: item.enclosure.type,
        },
      });
    }

    return feed.xml({ indent: true });
  }
}

export function buildRSSFromApiData(apiData, config, apiMapping) {
  const feed = new RSS({
    title: config.title || "API RSS Feed",
    description: "RSS feed generated from API data",
    feed_url: config.baseUrl + (config.route || ""),
    site_url: config.baseUrl,
    pubDate: new Date(),
  });

  // Access the items array in the API response
  const itemsPath = apiMapping.items || "";
  const items = get(apiData, itemsPath, []);

  items.forEach((item) => {
    feed.item({
      title: get(item, apiMapping.title, ""),
      description: get(item, apiMapping.description, ""),
      url: get(item, apiMapping.link, ""),
      guid: Bun.hash(JSON.stringify(item)),
      date: get(item, apiMapping.date, "") || new Date(),
    });
  });

  return feed.xml({ indent: true });
}
