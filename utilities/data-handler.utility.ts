export function timestampToDate(timestamp: any) {
    return new Date((timestamp * 1000)).toLocaleTimeString("en-US");
}

export function stripHtml(html: string) {
    return html.replace(/<(?:.|\n)*?>/gm, '');
}

export function titleCase(words: string) {
    return words.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();});
}

//appends url in front of relative links
export function appendUrl(url?: string, link?: string) {
    if(!!url && !!link){
        if(link.startsWith('/')){ return url.endsWith('/') ? `${url.substring(0, url.length-1)}${link}` : `${url}${link}`};
        return url.endsWith('/') ? `${url}${link}` : `${url}/${link}`
    }
}

//applies relevant utilities to titles, descriptions, etc.
export function processWords(words?: string, title?: boolean, removeHtml?: boolean) {
    var result = words ?? '';
    if(removeHtml) result = stripHtml(result);
    if(title) result = titleCase(result)
    return result;
}

//applies relevant utilities to urls
export function processLinks(words?: string, removeHtml?: boolean, relativeLink?: boolean, rootUrl?: string) {
    var result = words ?? '';
    if(removeHtml) result = stripHtml(result);
    if(relativeLink && rootUrl) result = appendUrl(rootUrl,result);
    return result;
}

export function processDates(date?: any, removeHtml?: boolean, timestamp?: boolean) {
    var result = date ?? '';
    if(removeHtml) result = stripHtml(result);
    if(timestamp) result = timestampToDate(result);
    return result;
}

export function get(obj, path, defaultValue) {
    const keys = path.split('.');
    let result = obj;
    for (let key of keys) {
      if (result == null || !(key in result)) {
        return defaultValue;
      }
      result = result[key];
    }
    return result;
  }