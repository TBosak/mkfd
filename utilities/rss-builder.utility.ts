import * as cheerio from "cheerio";
import RSS from "rss";
import CSSTarget from "../models/csstarget.model";
import { processDates, processLinks, processWords, timestampToDate } from "./data-handler.utility";

//TODO: ADD HTML STRIPPING TO EACH TARGET 
export function buildRSS(res: any, article?:
        { iterator: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean}, 
          title?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean },
          description?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean },
          link?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean },
          date?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean } },
          title?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean },
          description?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean },
          link?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean }, 
          date?: CSSTarget | { selector: string, attribute?: string, stripHtml?: boolean, rootUrl?: string, relativeLink?: boolean, titleCase?: boolean}, 
          timestamp?: boolean,
          reverse?: boolean): string {
        let input: Array<any> = [];
        const $ = cheerio.load(res);
        if (article) {
            $(article.iterator.selector).each((i: any, data: any) => {
                input.push({
                    title: !!article.title?.attribute ? 
                            processWords($(data).find(article.title?.selector)?.attr(article.title?.attribute),article.title?.titleCase,article.title?.stripHtml) : 
                            processWords($(data).find(article.title?.selector)?.text(),article.title?.titleCase,article.title?.stripHtml),
                    description: !!article.description?.attribute ? 
                                 processWords($(data).find(article.description?.selector)?.attr(article.description?.attribute),article.description?.titleCase,article.description?.stripHtml) : 
                                 processWords($(data).find(article.description?.selector)?.text(),article.description?.titleCase,article.description?.stripHtml),
                    url: !!article.link?.attribute ? 
                         processLinks($(data).find(article.link?.selector)?.attr(article.link?.attribute),article.link?.stripHtml,article.link?.relativeLink,article.link?.rootUrl) : 
                         processLinks($(data).find(article.link?.selector)?.text(),article.link?.stripHtml,article.link?.relativeLink,article.link?.rootUrl),
                    date: !!article.date?.attribute ? 
                          processDates($(data).find(article.date?.selector)?.attr(article.date?.attribute),article.date?.stripHtml,timestamp) : 
                          processDates($(data).find(article.date?.selector)?.text(),article.date?.stripHtml,timestamp)
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
                input[i].date = processDates($(data).attr(date.attribute),date?.stripHtml,timestamp) 
                                ?? processDates($(data).text(),date?.stripHtml,timestamp);
            })
        }
    
        const feed = new RSS({
            title: $('title')?.text(),
            description: $('meta[property="twitter:description"]')?.attr('content'),
            author: "mkfd",
            generator: 'Generated by mkfd',
        });
    
        if (reverse) {
            input.reverse();
        }

        for (const article of input) {
            feed.item({
                title: article.title,
                description: article.description,
                url: article.url,
                guid: article.url??article.title,
                categories: null,
                author: null,
                date: article.date,
                lat: null,
                long: null,
                custom_elements: null,
                enclosure: null
            });
        }
        return feed.xml({ indent: true });
}