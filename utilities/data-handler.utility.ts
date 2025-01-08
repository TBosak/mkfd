export function stripHtml(html: string) {
  return html.replace(/<(?:.|\n)*?>/gm, "");
}

export function titleCase(words: string) {
  return words.replace(/\w\S*/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase();
  });
}

//appends url in front of relative links
export function appendUrl(url?: string, link?: string) {
  if (!!url && !!link) {
    if (link.startsWith("/")) {
      return url.endsWith("/")
        ? `${url.substring(0, url.length - 1)}${link}`
        : `${url}${link}`;
    }
    return url.endsWith("/") ? `${url}${link}` : `${url}/${link}`;
  }
}

//applies relevant utilities to titles, descriptions, etc.
export function processWords(
  words?: string,
  title?: boolean,
  removeHtml?: boolean
) {
  var result = words ?? "";
  if (removeHtml) result = stripHtml(result);
  if (title) result = titleCase(result);
  return result;
}

//applies relevant utilities to urls
export function processLinks(
  words?: string,
  removeHtml?: boolean,
  relativeLink?: boolean,
  rootUrl?: string
) {
  var result = words ?? "";
  if (removeHtml) result = stripHtml(result);
  if (relativeLink && rootUrl) result = appendUrl(rootUrl, result);
  return result;
}

export function processDates(date?: any, removeHtml?: boolean) {
  let result = date ?? "";
  if (removeHtml) result = stripHtml(result);

  // Define regex patterns for various date and time formats
  const patterns = [
    { regex: /\b\d{10}\b/, type: "unix" }, // Unix timestamp (seconds)
    { regex: /\b\d{13}\b/, type: "unixMillis" }, // Unix timestamp (milliseconds)
    {
      regex: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/,
      type: "iso",
    }, // ISO 8601 with time
    { regex: /\b\d{4}-\d{2}-\d{2}\b/, type: "yyyy-mm-dd" }, // YYYY-MM-DD
    {
      regex: /\b\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\b/,
      type: "yyyy-mm-dd hh:mm:ss",
    }, // Custom YYYY-MM-DD hh:mm:ss
    {
      regex: /\b\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT\b/,
      type: "utc",
    }, // UTC format with time
  ];

  // Function to parse a matched date and time substring based on its type
  function parseDate(value: string, type: string): Date | null {
    switch (type) {
      case "unix":
        return new Date(parseInt(value) * 1000); // Unix timestamp (seconds)
      case "unixMillis":
        return new Date(parseInt(value)); // Unix timestamp (milliseconds)
      case "iso":
        return new Date(value); // ISO 8601
      case "yyyy-mm-dd":
        return new Date(`${value}T00:00:00Z`); // YYYY-MM-DD assumed UTC midnight
      case "yyyy-mm-dd hh:mm:ss":
        return new Date(value + "Z"); // YYYY-MM-DD hh:mm:ss assumed UTC
      case "utc":
        return new Date(value); // UTC format
      default:
        return null;
    }
  }

  // Try each pattern to find a matching date and time substring in the input
  for (const { regex, type } of patterns) {
    const match = result.match(regex);
    if (match) {
      const parsedDate = parseDate(match[0], type);
      if (parsedDate && !isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleString(); // Return standardized date format with time if available
      }
    }
  }

  // If no match is found, return the original input
  return result;
}

export function get(obj, path, defaultValue) {
  const keys = path.split(".");
  let result = obj;
  for (let key of keys) {
    if (result == null || !(key in result)) {
      return defaultValue;
    }
    result = result[key];
  }
  return result;
}
