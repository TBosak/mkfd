import { Hono } from "hono";
import * as cheerio from 'cheerio';
import * as RSS from 'rss';

const app = new Hono();

const port = parseInt(process.env.PORT) || 3000;

app.get('/', (c) => c.text('Home'))
// app.get('*', serveStatic({ path: './static/fallback.txt' }))

console.log(`Running at http://localhost:${port}`);

app.fire()
export default app;

app.get('/feed', async (c) => {
    c.header('Content-Type', 'text/xml');
    let res, xml;
    await fetchData(`https://news.ycombinator.com/newest`).then(response => {response.text().then(txt => {
        res = txt;
    })});
    
    let feed = buildRSS(
        res, 
        {iterator: new cssTarget('tr.athing'), title: new cssTarget('a.titlelink'), link: new cssTarget('a.titlelink', 'href')},
        null, 
        null, 
        new cssTarget('span.age', 'title'));

    return c.body(feed);
});

async function fetchData(url:string): Promise<any> {
    return fetch(url);
};

function buildRSS(
    res: any,
    article?: {iterator: cssTarget, 
              title?: cssTarget,
              link?: cssTarget,
              date?: cssTarget},
    title?: cssTarget, 
    link?: cssTarget,
    date?: cssTarget): any {
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
            input[i].date = $(data).attr(date.attribute) ?? $(data).text();
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

export class cssTarget {
    constructor(public selector: string, public attribute?: string){}
}