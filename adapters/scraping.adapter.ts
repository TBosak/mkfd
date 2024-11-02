import axios from "axios";
import ApiConfig  from "../models/apiconfig.model";
import CSSTarget from "../models/csstarget.model";
import { buildRSS } from "../utilities/rss-builder.utility";
import { BaseAdapter } from "./base.adapter";

export class WebScrapingAdapter extends BaseAdapter {
  article: {
    iterator: CSSTarget;
    title?: CSSTarget;
    description?: CSSTarget;
    link?: CSSTarget;
    date?: CSSTarget;
  };
  timestamp?: boolean;
  reverse?: boolean;

  constructor(config: ApiConfig, articleConfig: any, timestamp?: boolean, reverse?: boolean) {
    super(config);
    this.article = articleConfig;
    this.timestamp = timestamp;
    this.reverse = reverse;
  }

  async fetchData(): Promise<string> {
    try {
      const response = await axios.get(this.config.baseUrl!, {
        headers: this.config.headers,
        withCredentials: this.config.withCredentials,
      });
      return response.data;
    } catch (error) {
      console.error("Error fetching data:", error);
      throw error;
    }
  }

  buildRSS(res: string): string {
    return buildRSS(
      res,
      this.article,
      undefined,
      undefined,
      undefined,
      undefined,
      this.timestamp,
      this.reverse
    );
  }
}