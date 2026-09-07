// TDD slice: p3-shared-outbound-executor
//
// Specifies requirement 7 for utilities/graphql-feed.utility.ts:
// executeGraphQLFeed posts to options.endpoint — a URL the feed author
// supplies — with a bare axios.post and no outbound policy check at all
// (see utilities/graphql-feed.utility.ts). These tests drive the real
// public executeGraphQLFeed entry point with a blocked endpoint and prove
// it is not currently refused.
//
// axios.post is mocked at the shared module-object level (no live network
// call), the same convention already used across this repo's other
// outbound-policy tests.

import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";
import { executeGraphQLFeed } from "../utilities/graphql-feed.utility";

const originalAxiosPost = axios.post;

afterEach(() => {
	axios.post = originalAxiosPost;
});

const LEAK_MARKER = "internal-graphql-secret-2e91";

function mockUpstreamGraphQL(): string[] {
	const calls: string[] = [];
	axios.post = (async (url: string) => {
		calls.push(url);
		return { status: 200, headers: {}, data: { data: { message: LEAK_MARKER } } };
	}) as typeof axios.post;
	return calls;
}

describe("executeGraphQLFeed — outbound executor policy (requirement 7)", () => {
	test("sanity: an ordinary public endpoint is queried", async () => {
		mockUpstreamGraphQL();
		const result = await executeGraphQLFeed({ endpoint: "http://example.com/graphql", query: "{ message }" });
		expect((result.data as { message: string }).message).toBe(LEAK_MARKER);
	});

	test("refuses a loopback endpoint through its own public entry point, without ever making the request", async () => {
		const calls = mockUpstreamGraphQL();
		await expect(
			executeGraphQLFeed({ endpoint: "http://127.0.0.1/graphql", query: "{ message }" }),
		).rejects.toThrow(/blocked|private|loopback/i);
		expect(calls).toHaveLength(0);
	});

	test("refuses a cloud metadata endpoint through its own public entry point", async () => {
		const calls = mockUpstreamGraphQL();
		await expect(
			executeGraphQLFeed({ endpoint: "http://metadata.google.internal/computeMetadata/v1/", query: "{ message }" }),
		).rejects.toThrow(/metadata|blocked/i);
		expect(calls).toHaveLength(0);
	});
});
