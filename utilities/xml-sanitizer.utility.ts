/**
 * Sanitizes content for XML/RSS feeds
 * Escapes special characters and removes invalid XML characters
 */
export function sanitizeForXML(content: string | undefined): string {
  if (!content || typeof content !== 'string') return content || '';

  return content
    // First, decode any existing HTML entities to avoid double-encoding
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Remove invalid XML characters (control characters except tab, newline, carriage return)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Escape CDATA closing sequence
    .replace(/]]>/g, ']]&gt;')
    // Escape XML special characters
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Sanitizes a URL for XML/RSS feeds
 * Only escapes ampersands in query strings
 */
export function sanitizeURLForXML(url: string | undefined): string {
  if (!url || typeof url !== 'string') return url || '';

  // Only escape ampersands in URLs, as other characters are valid in URLs
  return url.replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, '&amp;');
}
