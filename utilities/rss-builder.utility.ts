import * as cheerio from "cheerio";
import RSS from "rss";
import CSSTarget from "../models/csstarget.model";
import { processDates, processLinks, processWords, get } from "./data-handler.utility";
import ApiConfig from './../models/apiconfig.model';

//TODO: ADD HTML STRIPPING TO EACH TARGET 
export function buildRSS(res: any, apiConfig?: ApiConfig, article?:
        { iterator: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean , iterator: string }, 
          title?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          description?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          author?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          link?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          date?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string } },
          title?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          description?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          author?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string },
          link?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string }, 
          date?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean, iterator: string }, 
          reverse?: boolean): string {
        let input: Array<any> = [];
        const $ = cheerio.load(res);
        if (article) {
            $(article.iterator.selector).each((i: any, data: any) => {
                input.push({
                    title: !article.title?.iterator ? (!!article.title?.attribute ? 
                            processWords($(data).find(article.title?.selector)?.attr(article.title?.attribute),article.title?.titleCase,article.title?.stripHtml) : 
                            processWords($(data).find(article.title?.selector)?.text(),article.title?.titleCase,article.title?.stripHtml)) : 
                            (!!article.title?.attribute ? processWords($($(article.title.iterator).toArray()[i]).find(article.title.selector)?.attr(article.title?.attribute),article.title.titleCase,article.title.stripHtml):
                            processWords($($(article.title.iterator).toArray()[i]).find(article.title.selector).text(),article.title.titleCase,article.title.stripHtml)),
                    description: !article.description?.iterator ? (!!article.description?.attribute ? 
                                 processWords($(data).find(article.description?.selector)?.attr(article.description?.attribute),article.description?.titleCase,article.description?.stripHtml) : 
                                 processWords($(data).find(article.description?.selector)?.text(),article.description?.titleCase,article.description?.stripHtml)):
                                 (!!article.description?.attribute ? processWords($($(article.description.iterator).toArray()[i]).find(article.description.selector)?.attr(article.description?.attribute),article.description.titleCase,article.description.stripHtml) :
                                    processWords($($(article.description.iterator).toArray()[i]).find(article.description.selector).text(),article.description.titleCase,article.description.stripHtml)),
                    url: !article.link?.iterator ? (!!article.link?.attribute ? 
                         processLinks($(data).find(article.link?.selector)?.attr(article.link?.attribute),article.link?.stripHtml,article.link?.relativeLink,article.link?.rootUrl) : 
                         processLinks($(data).find(article.link?.selector)?.text(),article.link?.stripHtml,article.link?.relativeLink,article.link?.rootUrl)) :
                            (!!article.link?.attribute ? processLinks($($(article.link.iterator).toArray()[i]).find(article.link.selector)?.attr(article.link?.attribute),article.link.stripHtml,article.link.relativeLink,article.link.rootUrl) :
                            processLinks($($(article.link.iterator).toArray()[i]).find(article.link.selector).text(),article.link.stripHtml,article.link.relativeLink,article.link.rootUrl)),
                    author: !article.author.iterator ? (!!article.author?.attribute ?
                            processWords($(data).find(article.author?.selector)?.attr(article.author?.attribute),article.author?.titleCase,article.author?.stripHtml) : 
                            processWords($(data).find(article.author?.selector)?.text(),article.author?.titleCase,article.author?.stripHtml)) :
                                (!!article.author?.attribute ? processWords($($(article.author.iterator).toArray()[i]).find(article.author.selector)?.attr(article.author?.attribute),article.author.titleCase,article.author.stripHtml) :
                                processWords($($(article.author.iterator).toArray()[i]).find(article.author.selector).text(),article.author.titleCase,article.author.stripHtml)),
                    date: !article.date?.iterator ? (!!article.date?.attribute ? 
                          processDates($(data).find(article.date?.selector)?.attr(article.date?.attribute),article.date?.stripHtml) : 
                          processDates($(data).find(article.date?.selector)?.text(),article.date?.stripHtml)) :
                            (!!article.date?.attribute ? processDates($($(article.date.iterator).toArray()[i]).find(article.date.selector)?.attr(article.date?.attribute),article.date.stripHtml) :
                            processDates($($(article.date.iterator).toArray()[i]).find(article.date.selector).text(),article.date.stripHtml))
                })
            })
        }
        if (title) {
            $(title?.selector).each((i: string | number, data: any) => {
                input[i].title = processWords($(data).attr(title?.attribute),title?.titleCase,title?.stripHtml) ?? processWords($(data).text(),title?.titleCase,title?.stripHtml);
            })
        }
        if (description) {
            $(description?.selector).each((i: string | number, data: any) => {
                input[i].description = processWords($(data).attr(description?.attribute),description?.titleCase,description?.stripHtml) ?? processWords($(data).text(),description?.titleCase,description?.stripHtml);
            })
        }
        if (link) {
            $(link?.selector).each((i: string | number, data: any) => {
                input[i].url = processLinks($(data).attr(link?.attribute),link?.relativeLink,link?.stripHtml,link?.rootUrl) ?? processLinks($(data).text(),link?.stripHtml,link?.relativeLink,link?.rootUrl);
            })
        }
        if (date) {
            $(date?.selector).each((i: string | number, data: any) => {
                input[i].date = processDates($(data).attr(date.attribute),date?.stripHtml) 
                                ?? processDates($(data).text(),date?.stripHtml);
            })
        }
        if (author) {
            $(author?.selector).each((i: string | number, data: any) => {
                input[i].author = processWords($(data).attr(author?.attribute),author?.titleCase,author?.stripHtml) ?? processWords($(data).text(),author?.titleCase,author?.stripHtml);
            })
        }
    
        const feed = new RSS({
            title: apiConfig?.title || $('title')?.text(),
            description: $('meta[property="twitter:description"]')?.attr('content'),
            author: "mkfd",
            site_url: apiConfig.baseUrl,
            generator: "Generated by mkfd"
        });
    
        if (reverse) {
            input.reverse();
        }

        for (const item of input) {
            feed.item({
                title: item.title,
                description: item.description,
                url: item.url,
                guid: Bun.hash(JSON.stringify(item)),
                categories: null,
                author: item.author,
                date: item.date,
                lat: null,
                long: null,
                custom_elements: null,
                enclosure: null
            });
        }
        return feed.xml({ indent: true });
}

export function buildRSSFromApiData(apiData, config, apiMapping) {
    const feed = new RSS({
      title: config.title || 'API RSS Feed',
      description: 'RSS feed generated from API data',
      feed_url: config.baseUrl + (config.route || ''),
      site_url: config.baseUrl,
      pubDate: new Date(),
    });
  
    // Access the items array in the API response
    const itemsPath = apiMapping.items || '';
    const items = get(apiData, itemsPath, []);
  
    items.forEach((item) => {
      feed.item({
        title: get(item, apiMapping.title, ''),
        description: get(item, apiMapping.description, ''),
        url: get(item, apiMapping.link, ''),
        guid: Bun.hash(JSON.stringify(item)),
        date: get(item, apiMapping.date, '') || new Date(),
      });
    });
  
    return feed.xml({ indent: true });
  }