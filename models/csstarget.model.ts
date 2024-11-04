export default class CSSTarget {
    constructor(public selector: string, public attribute?: string, public stripHtml?: boolean, 
        public rootUrl?: string, public relativeLink?: boolean, public titleCase?: boolean, public iterator?: string) { }
    }