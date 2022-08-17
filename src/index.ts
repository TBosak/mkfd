import { xml } from "cheerio";
import { Hono } from "hono";
import { html } from 'hono/html'
import IAdapter from "./adapters/adapter.interface";
import HackerNewsAdapter from "./adapters/hacker-news.adapter";
import SteamgiftsDiscussionAdapter from "./adapters/steamgifts-discussion.adapter"

//ADAPTER DECLARATIONS
const HackerNews = new HackerNewsAdapter();
const SteamgiftsDiscussions = new SteamgiftsDiscussionAdapter();
export const Adapters: Array<IAdapter> = 
[
  HackerNews,
  SteamgiftsDiscussions
]
//SETUP
const app = new Hono();
const port = parseInt(process.env.PORT) || 3000;

//HOMEPAGE //TODO: ADD STYLING & BUILD CARDS BASED ON ADAPTER CONFIG DATA
app.get('/', (c) => {
  var content = [];
  Adapters.forEach(adapter=>{
    content.push(
      html`<h3>${adapter.config.title}</h3><br><hr>`
    )
  })
   content.join(' ');

    return c.html(
      `${content}`
    )
  })


//ADAPTER ENDPOINTS
app.get('/hackernews', async (c) => {
    c.header('Content-Type', 'text/xml');
    let feed;
    await HackerNews.fetchData().then((res)=>feed = HackerNews.buildRSS(res));
    return c.body(feed);
});

app.get('/sgdiscussion/:id/:page', async (c) => {
    c.header('Content-Type', 'text/xml');
    const id = c.req.param('id');
    const page = c.req.param('page');
    let feed;
    await SteamgiftsDiscussions.fetchData(`${id}/${page}`).then((res)=>feed = SteamgiftsDiscussions.buildRSS(res));
    return c.body(feed);
});

//RUNNING
console.log(`Running at http://localhost:${port}`);
app.fire()
export default app;