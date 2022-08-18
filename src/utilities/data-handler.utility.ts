export function timestampToDate(timestamp: any){
    return new Date((timestamp * 1000)).toLocaleTimeString("en-US")
}

export function stripHtml(html: string){
    return html.replace(/<(?:.|\n)*?>/gm, '');
}