import { Hono } from "hono";
import HackerNewsAdapter from "./adapters/hacker-news.adapter";
import SteamgiftsDiscussionAdapter from "./adapters/steamgifts-discussion.adapter"

//ADAPTER DECLARATIONS
const HackerNews = new HackerNewsAdapter();
const SteamgiftsDiscussions = new SteamgiftsDiscussionAdapter();

//SETUP
const app = new Hono();
const port = parseInt(process.env.PORT) || 3000;

//HOMEPAGE
app.get('/', (c) => c.text('Home'))

//ADAPTER ENDPOINTS
app.get('/hackernews', async (c) => {
    c.header('Content-Type', 'text/xml');
    let feed;
    await HackerNews.fetchData().then((res)=>feed = HackerNews.buildRSS(res));
    return c.body(feed);
});

app.get('/sgdiscussion/:id', async (c) => {
    c.header('Content-Type', 'text/xml');
    const id = c.req.param('id')
    let feed;
    await SteamgiftsDiscussions.fetchData(id).then((res)=>feed = SteamgiftsDiscussions.buildRSS(res));
    return c.body(feed);
});

//RUNNING
console.log(`Running at http://localhost:${port}`);
app.fire()
export default app;