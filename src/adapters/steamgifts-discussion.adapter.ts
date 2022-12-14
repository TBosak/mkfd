import { CSSTarget } from "../models/CSSTarget.model";
import IAdapter from "./adapter.interface";
import { buildRSS } from "../utilities/rss-builder.utility";
import { ApiConfig } from "../models/apiconfig.model";

export default class SteamgiftsDiscussionAdapter implements IAdapter {
    config = new ApiConfig("Steamgifts Discussions");
    constructor(){
        this.buildRSS = this.buildRSS.bind(this);
        this.fetchData = this.fetchData.bind(this);
     }

    buildRSS(res: string): string {
        return buildRSS(res, {
            iterator: new CSSTarget('div.comment'), 
            title: new CSSTarget('div.comment__username'),
            description: new CSSTarget('div.comment__parent > div.comment__summary > div.comment__display-state', null, true),
            link: new CSSTarget('div.comment__actions > a','href', false, 'https://www.steamgifts.com', true),
            date: new CSSTarget('div.comment__actions > span','data-timestamp'),
        }, null, null, null, null, true, true);
    };

    async fetchData(param?: string): Promise<string> {
        let res: string;
        await fetch(`https://www.steamgifts.com/discussion/${param}/search?page=9000`).then(response => {
            response.text().then(txt => {
                res = txt;
            })
        })
        return res;
    }

}
