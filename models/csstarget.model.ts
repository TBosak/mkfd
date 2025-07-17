export default class CSSTarget {
  constructor(
    public selector: string,
    public attribute?: string,
    public stripHtml?: boolean,
    public rootUrl?: string,
    public relativeLink?: boolean,
    public titleCase?: boolean,
    public iterator?: string,
    public dateFormat?: string,
    public drillChain?: Array<{
      selector: string;
      attribute: string;
      isRelative: boolean;
      baseUrl: string;
      stripHtml: boolean;
    }>,
    // RSS 2.0 additional fields
    public category?: string,
    public comments?: string,
    public guid?: string,
    public pubDate?: string,
    public source?: string
  ) {}
}
