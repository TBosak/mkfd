// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/calendar-feed.utility.ts: the same
// defect shape as sitemap.utility.ts. fetchAndBuildCalendarItems fetches
// config.url with a bare axios.get and no outbound policy check at all
// (see utilities/calendar-feed.utility.ts). These tests drive the real
// public fetchAndBuildCalendarItems entry point with a blocked target and
// prove it is not currently refused.
//
// axios.get is mocked at the shared module-object level (no live network
// call), the same convention already used across this repo's other
// outbound-policy tests.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { fetchAndBuildCalendarItems } from "../utilities/calendar-feed.utility";
import type { CalendarFeedConfig } from "../models/calendar.model";

const originalAxiosGet = axios.get;

afterEach(() => {
	axios.get = originalAxiosGet;
});

const BASE_CONFIG: CalendarFeedConfig = {
	url: "",
	windowDays: 36500,
	includePastEvents: false,
	expandRecurringEvents: false,
	maxEvents: 50,
	sortOrder: "startAsc",
	dateStrategy: "start",
	linkStrategy: "eventUrl",
	includeCanceled: false,
};

const LEAK_MARKER = "internal-calendar-secret-4b7c";
const ICS = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:1\nSUMMARY:${LEAK_MARKER}\nDTSTART:20301231T000000Z\nEND:VEVENT\nEND:VCALENDAR`;

function mockUpstreamIcs(ics: string): string[] {
	const calls: string[] = [];
	axios.get = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: ics };
	}) as typeof axios.get;
	return calls;
}

describe("fetchAndBuildCalendarItems — outbound executor policy (requirement 7)", () => {
	test("sanity: an ordinary public calendar.url is fetched and parsed", async () => {
		mockUpstreamIcs(ICS);
		const items = await fetchAndBuildCalendarItems({ ...BASE_CONFIG, url: "http://example.com/cal.ics" });
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe(LEAK_MARKER);
	});

	test("refuses a loopback calendar.url through its own public entry point, without ever making the request", async () => {
		const calls = mockUpstreamIcs(ICS);
		await expect(
			fetchAndBuildCalendarItems({ ...BASE_CONFIG, url: "http://127.0.0.1/cal.ics" }),
		).rejects.toThrow(/blocked|private|loopback/i);
		expect(calls).toHaveLength(0);
	});

	test("refuses a cloud metadata calendar.url through its own public entry point", async () => {
		const calls = mockUpstreamIcs(ICS);
		await expect(
			fetchAndBuildCalendarItems({ ...BASE_CONFIG, url: "http://metadata.google.internal/computeMetadata/v1/" }),
		).rejects.toThrow(/metadata|blocked/i);
		expect(calls).toHaveLength(0);
	});
});
