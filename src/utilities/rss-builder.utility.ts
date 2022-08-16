import * as cheerio from 'cheerio';
import * as RSS from 'rss';
import { CSSTarget } from "../models/CSSTarget.model";
import { timestampToDate } from "./data-handler.utility";

export function buildRSS(res: any, article?:
        { iterator: CSSTarget | { selector: string, attribute: string }, 
          title?: CSSTarget | { selector: string, attribute: string },
          link?: CSSTarget | { selector: string, attribute: string },
          date?: CSSTarget | { selector: string, attribute: string } },
          title?: CSSTarget | { selector: string, attribute: string }, 
          link?: CSSTarget | { selector: string, attribute: string }, 
          date?: CSSTarget | { selector: string, attribute: string }, 
          timestamp?: boolean): string {
        let input: Array<any> = [];
        const $ = cheerio.load(res);
        if (article) {
            $(article.iterator.selector).each((i, data) => {
                input.push({
                    title: !!article.title?.attribute ? $(data).find(article.title?.selector)?.attr() : $(data).find(article.title?.selector)?.text(),
                    url: !!article.link?.attribute ? $(data).find(article.link?.selector)?.attr(article.link?.attribute) : $(data).find(article.link?.selector)?.text(),
                    date: !!article.date?.attribute ? $(data).find(article.date?.selector)?.attr(article.date?.attribute) : $(data).find(article.date?.selector)?.text()
                })
                console.log(input);
            })
        }
        if (title) {
            $(title?.selector).each((i, data) => {
                input[i].title = $(data).attr(title.attribute) ?? $(data).text();
            })
        }
        if (link) {
            $(link?.selector).each((i, data) => {
                input[i].url = $(data).attr(link.attribute) ?? $(data).text();
            })
        }
        if (date) {
            $(date?.selector).each((i, data) => {
                const dateTime = $(data).text();
                input[i].date = $(data).attr(date.attribute) ?? dateTime;
                if(timestamp) input[i].date = timestampToDate(dateTime);
            })
        }
    
        const feed = new RSS({
            title: $('title')?.text(),
            description: $('meta[property="twitter:description"]')?.attr('content'),
            author: "Mkfd"
        });
    
        for (const article of input) {
            feed.item({
                title: article.title,
                url: article.url,
                date: article.date
            });
        }
        return feed.xml({ indent: true });
}