// TDD slice: p3-browser-adapter
//
// utilities/data-handler.utility.ts's resolveDrillChain owns two of the
// three unvalidated browser call sites the brief identifies: the initial-URL
// fetch (~line 221) and the mid-drill-chain-step fetch (~line 339), both
// reached only when `useAdvanced` is true and FlareSolverr is not enabled.
// Migrating both to lib/outbound/browser-adapter.ts is defect #2 in the
// brief: "Drill-chain steps navigate to scraped URLs with no validation
// whatsoever."
//
// No real Chromium process is launched: "patchright"'s `chromium.launch` is
// replaced with tests/helpers/fake-browser.ts's harness for the whole file,
// per that helper's own doc comment on why call-site migration suites use
// module mocking (mock.module) rather than the `_launchBrowser` injection
// the dedicated tests/browser-adapter.test.ts uses -- this file drives the
// REAL resolveDrillChain, which today still calls `chromium.launch` and
// `page.goto` directly with zero validation, so it must never reach an
// actual browser either before or after migration.
//
// resolveDrillChain deliberately swallows fetch/navigation failures and
// returns "" on any failure (see its own catch blocks, and the locked
// tests/data-handler-outbound-executor.test.ts for the same convention), so
// "refused" here is proven the stronger way: the browser's page.goto was
// never even called for the refused target (harness.gotoCalls), not merely
// that the returned value happens to be "".

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { BrowserHarness, mockPatchright } from "./helpers/fake-browser";

const harness = new BrowserHarness();
mockPatchright(harness);

import { resolveDrillChain } from "../utilities/data-handler.utility";

afterAll(() => {
	mock.restore();
});

beforeEach(() => {
	harness.reset();
});

const HOP1_URL = "http://93.184.216.34/start";
const HOP2_URL = "http://93.184.216.34/page2";
const PRIVATE_URL = "http://10.0.0.5/start";
const PRIVATE_HOP2_URL = "http://10.0.0.5/page2";
const METADATA_URL = "http://169.254.169.254/latest/meta-data/";
const FINAL_MARKER = "drillchain-browser-final-secret-9f2a";

const ONE_STEP_CHAIN = [
	{
		selector: "#final",
		attribute: "href",
		isRelative: false,
		baseUrl: "",
		stripHtml: false,
	},
];

const TWO_HOP_CHAIN = [
	{
		selector: "#next",
		attribute: "href",
		isRelative: false,
		baseUrl: "",
		stripHtml: false,
	},
	{
		selector: "#final",
		attribute: "href",
		isRelative: false,
		baseUrl: "",
		stripHtml: false,
	},
];

describe("resolveDrillChain — browser adapter, initial-fetch call site (requirements 1-4, non-goal: matches FlareSolverr sibling's validation)", () => {
	test("sanity: a permitted starting URL navigates through the browser adapter and its content is drilled", async () => {
		harness.htmlByUrl.set(
			HOP1_URL,
			`<html><body><a id="final" href="${FINAL_MARKER}">x</a></body></html>`,
		);

		const result = await resolveDrillChain(
			HOP1_URL,
			ONE_STEP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(result).toBe(FINAL_MARKER);
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([HOP1_URL]);
	});

	test("refuses a private-address starting URL for the initial fetch, without ever calling page.goto", async () => {
		const result = await resolveDrillChain(
			PRIVATE_URL,
			ONE_STEP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(
			harness.gotoCalls.length,
			"goto must never be called for a refused starting URL",
		).toBe(0);
		expect(result).toBe("");
	});

	test("refuses a cloud metadata starting URL for the initial fetch, without ever calling page.goto", async () => {
		const result = await resolveDrillChain(
			METADATA_URL,
			ONE_STEP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(harness.gotoCalls.length).toBe(0);
		expect(result).toBe("");
	});
});

describe("resolveDrillChain — browser adapter, mid-chain-step call site (requirement 2's core scenario: one session across many navigations)", () => {
	test("sanity: a permitted multi-step chain reuses ONE browser session across both navigations, not a fresh one per step", async () => {
		harness.htmlByUrl.set(
			HOP1_URL,
			`<html><body><a id="next" href="${HOP2_URL}">next</a></body></html>`,
		);
		harness.htmlByUrl.set(
			HOP2_URL,
			`<html><body><a id="final" href="${FINAL_MARKER}">final</a></body></html>`,
		);

		const result = await resolveDrillChain(
			HOP1_URL,
			TWO_HOP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(result).toBe(FINAL_MARKER);
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([HOP1_URL, HOP2_URL]);
		expect(
			harness.contexts.length,
			"expected one browser context/session for the whole chain",
		).toBe(1);
	});

	test("refuses a mid-chain navigation to a private address discovered in the previous page's HTML, without ever calling page.goto for it", async () => {
		harness.htmlByUrl.set(
			HOP1_URL,
			`<html><body><a id="next" href="${PRIVATE_HOP2_URL}">next</a></body></html>`,
		);

		const result = await resolveDrillChain(
			HOP1_URL,
			TWO_HOP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(result).toBe("");
		// The first, permitted hop still ran; the second, scraped-and-untrusted
		// hop never reached goto at all.
		expect(harness.gotoCalls.map((c) => c.url)).toEqual([HOP1_URL]);
	});

	test("the browser still closes even when a mid-chain navigation throws an unrelated error (requirement 6: data-handler's finally delegates to session.close())", async () => {
		harness.htmlByUrl.set(
			HOP1_URL,
			`<html><body><a id="next" href="${HOP2_URL}">next</a></body></html>`,
		);
		harness.gotoThrows.set(HOP2_URL, new Error("ECONNRESET"));

		const result = await resolveDrillChain(
			HOP1_URL,
			TWO_HOP_CHAIN,
			true,
			false,
			undefined,
			undefined,
		);

		expect(result).toBe("");
		expect(harness.browserCloseCount).toBe(1);
	});
});
