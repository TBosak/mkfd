/**
 * Sanitizes content for XML/RSS feeds
 * Escapes special characters and removes invalid XML characters
 */
export function stripInvalidXmlControlCharacters(content: string): string {
	return Array.from(content)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return (
				codePoint === 0x09 ||
				codePoint === 0x0a ||
				codePoint === 0x0d ||
				(codePoint >= 0x20 && codePoint !== 0x7f)
			);
		})
		.join("");
}

export function sanitizeForXML(content: string | undefined): string {
	if (!content || typeof content !== "string") return content || "";

	const decoded = content
		// First, decode any existing HTML entities to avoid double-encoding
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

	return (
		stripInvalidXmlControlCharacters(decoded)
			// Escape CDATA closing sequence
			.replace(/]]>/g, "]]&gt;")
			// Escape XML special characters
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&apos;")
	);
}

/**
 * Sanitizes a URL for XML/RSS feeds
 * Only escapes ampersands in query strings
 */
export function sanitizeURLForXML(url: string | undefined): string {
	if (!url || typeof url !== "string") return url || "";

	// Only escape ampersands in URLs, as other characters are valid in URLs
	return url.replace(/&(?!(?:amp|lt|gt|quot|apos);)/g, "&amp;");
}
