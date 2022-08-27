import { CSSTarget } from "../models/CSSTarget.model";
import IAdapter from "./adapter.interface";
import { buildRSS } from "../utilities/rss-builder.utility";
import { ApiConfig } from "../models/apiconfig.model";

export default class HackerNewsAdapter implements IAdapter {
    config = new ApiConfig("Hacker News");
    constructor(){
        this.buildRSS = this.buildRSS.bind(this);
        this.fetchData = this.fetchData.bind(this);
     }

    buildRSS(res: string): string {
        return buildRSS(
            res, 
            {iterator: new CSSTarget('tr.athing'), title: new CSSTarget('a.titlelink'), link: new CSSTarget('a.titlelink', 'href')},
            null, 
            null,
            null, 
            new CSSTarget('span.age', 'title'));
    };

    async fetchData(param?: string): Promise<string> {
        let res: string;
        await fetch(`https://news.ycombinator.com/newest`).then(response => {
            response.text().then(txt => {
                res = txt;
            })
        })
        return res;
    }

}