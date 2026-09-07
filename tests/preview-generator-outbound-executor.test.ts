// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/preview-generator.utility.ts.
// generatePreview already validates its top-level target URL up front
// (assertOutboundFetchAllowed on `previewUrl`) for every feed type, so a
// directly-blocked target is already refused today — that part is not the
// gap this slice closes. The gap is what happens *after* that check: for
// "sitemap"/"calendar"/"graphql" feed types, generatePreview delegates to
// fetchAndBuildSitemapItems / fetchAndBuildCalendarItems / executeGraphQLFeed,
// none of which revalidate a redirect (see
// utilities/calendar-feed.utility.ts, which lets plain axios.get follow
// redirects with its own default behavior, unchecked). A preview target
// that passes the initial check can still redirect the actual fetch to a
// blocked address, and generatePreview's own public entry point returns
// the leaked content as if it were legitimate.
//
// This test drives generatePreview directly (not an internal helper) with
// a calendar.url that is explicitly allowlisted (so the top-level check
// passes) and that 302-redirects to a *different*, non-allowlisted loopback
// address. Both hops are real local HTTP servers on 127.0.0.1/127.0.0.2 —
// loopback addresses can never leave the host, so this cannot reach
// anything outside the test process regardless of whether the refusal
// happens. Hop 2 is a real, listening server that serves recognizable
// content, so an unprotected implementation doesn't merely error — it
// visibly leaks hop 2's content into the generated preview feed, which is
// what the assertions below check for directly.

import { afterEach, describe, expect, test } from "bun:test";
import { generatePreview } from "../utilities/preview-generator.utility";

const cleanups: Array<() => void> = [];

afterEach(() => {
	while (cleanups.length) {
		cleanups.pop()?.();
	}
});

function startServer(hostname: string, fetchHandler: (req: Request) => Response | Promise<Response>) {
	const server = Bun.serve({ hostname, port: 0, fetch: fetchHandler });
	cleanups.push(() => server.stop(true));
	return { url: `http://${hostname}:${server.port}`, port: server.port };
}

const LEAK_MARKER = "internal-preview-secret-c31a";
const LEAKED_ICS = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:${LEAK_MARKER}\nDTSTART:20301231T000000Z\nEND:VEVENT\nEND:VCALENDAR`;

describe("generatePreview — outbound executor policy for its sitemap/calendar/graphql delegation (requirement 7)", () => {
	test(
		"a calendar preview target that passes the initial check must not leak content from a redirect to a non-allowlisted address",
		async () => {
			let hop2Requests = 0;
			const hop2 = startServer("127.0.0.2", () => {
				hop2Requests++;
				return new Response(LEAKED_ICS);
			});
			const hop1 = startServer("127.0.0.1", () => {
				return new Response(null, {
					status: 302,
					headers: { location: `http://127.0.0.2:${hop2.port}/leak.ics` },
				});
			});

			const feedConfig = {
				feedType: "calendar",
				feedId: "preview-calendar-test",
				feedName: "Preview Calendar Test",
				allowlist: ["127.0.0.1"], // authorizes only hop 1's exact address
				calendar: {
					url: `${hop1.url}/cal.ics`,
					windowDays: 36500,
					includePastEvents: false,
					expandRecurringEvents: false,
					maxEvents: 50,
					sortOrder: "startAsc",
					dateStrategy: "start",
					linkStrategy: "eventUrl",
					includeCanceled: false,
				},
			};

			let feed: import("feed").Feed | undefined;
			let caught: unknown;
			try {
				feed = await generatePreview(feedConfig);
			} catch (error) {
				caught = error;
			}

			if (feed) {
				// If it didn't refuse, it must not have leaked hop 2's content.
				expect(feed.rss2()).not.toContain(LEAK_MARKER);
			}
			// Either the call was refused, or it succeeded without ever reaching
			// hop 2 — both are acceptable outcomes; silently leaking hop 2's
			// content is not.
			expect(hop2Requests === 0 || caught !== undefined).toBe(true);
		},
		10_000,
	);
});
