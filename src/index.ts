import { Hono } from "hono";
import { serveStatic } from 'hono/serve-static.bun'
import { resolve } from "path";
import { write, stdout, file } from "bun";
import * as cheerio from 'cheerio';
import * as RSS from 'rss';

const app = new Hono();

const port = parseInt(process.env.PORT) || 3000;

app.use('/feeds/*', serveStatic({ root: './' }))
app.get('/', (c) => c.text('This is Home! You can access: /feeds/index.rss'))
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

    return c.body(buildRSS(
        res, 
        article: {
            iterator: new cssTarget({ selector: 'tr.athing'}),
            title: new cssTarget({selector: 'a.titlelink'}),
            link: new cssTarget({selector: 'a.titlelink'})},
            null, null, date: {selector: 'span.age', attribute: 'title'}))
});

async function fetchData(url:string): Promise<any> {
    return fetch(url);
};

function buildRSS(
    res: string,
    article?: {iterator: cssTarget, 
              title?: cssTarget,
              link?: cssTarget,
              date?: cssTarget},
    title?: cssTarget, 
    link?: cssTarget,
    date?: cssTarget): any {
    const $ = cheerio.load(res);
    let input: Array<any> = [];

    if (article) {
        $(article.iterator).each((i, data) => {
            input.push({
                title: $(data).find(article.title.selector)?.attr(article.title.attribute) ?? $(data).find(article.title.selector)?.text(),
                url: $(data).find(article.link.selector)?.attr(article.link.attribute) ?? $(data).find(article.link.selector)?.text(),
                date: $(data).find(article.date.selector)?.attr(article.date.attribute) ?? $(data).find(article.date.selector)?.text()
            })
        })
    }
    if (title) {
        $(title.selector).each((i, data) => {
            input[i].title = $(data).attr(title.attribute) ?? $(data).text();
        }) 
    }
    if (link) {
        $(link.selector).each((i, data) => {
            input[i].url = $(data).attr(link.attribute) ?? $(data).text();
        }) 
    }
    if (date) {
        $(date.selector).each((i, data) => {
            input[i].title = $(data).attr(date.attribute) ?? $(data).text();
        }) 
    }
    
    const feed = new RSS({
        title: $('title').text(),
        description: $('meta[property="twitter:description"]').attr('content'),
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
    selector: string;
    attribute?: string;
    constructor(public sel: string, public attr?: string) {
        this.selector = sel;
        if (attr) this.attribute = attr;
    }
}