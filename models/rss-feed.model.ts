import { Feed } from "feed";

// Type definitions from feed package (these are not exported at runtime, only in .d.ts)
export interface Author {
  name?: string;
  email?: string;
  link?: string;
  avatar?: string;
}

export interface Category {
  name?: string;
  domain?: string;
  scheme?: string;
  term?: string;
}

export interface Enclosure {
  url: string;
  type?: string;
  length?: number;
  title?: string;
  duration?: number;
}

export interface Extension {
  name: string;
  objects: any;
}

export interface FeedOptions {
  id: string;
  title: string;
  updated?: Date;
  generator?: string;
  language?: string;
  ttl?: number;
  feed?: string;
  feedLinks?: any;
  hub?: string;
  docs?: string;
  podcast?: boolean;
  category?: string;
  author?: Author;
  link?: string;
  description?: string;
  image?: string;
  favicon?: string;
  copyright: string;
}

export interface Item {
  title: string;
  id?: string;
  link: string;
  date: Date;
  description?: string;
  content?: string;
  category?: Category[];
  guid?: string;
  image?: string | Enclosure;
  audio?: string | Enclosure;
  video?: string | Enclosure;
  enclosure?: Enclosure;
  author?: Author[];
  contributor?: Author[];
  published?: Date;
  copyright?: string;
  extensions?: Extension[];
}

export interface RSSFeedOptions extends FeedOptions {
  feedId?: string;
  feedName?: string;
  feedType?: string;
  config?: any;
  webhook?: any;
  refreshTime?: number;
  reverse?: boolean;
  strict?: boolean;
  advanced?: boolean;
  headers?: any;
  cookies?: any;
  article?: any;
  apiMapping?: any;
  serverUrl?: string;
}

export interface RSSItemOptions extends Item {}

// Re-export Feed class
export { Feed };
