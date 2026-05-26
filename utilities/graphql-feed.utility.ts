import axios from "axios";
import type { ExecuteGraphQLFeedOptions, GraphQLFeedConfig } from "../models/graphql.model";
import type { NormalizedFeedItem } from "../models/normalized-feed-item.model";
import { mapStructuredDataToItems } from "./structured-feed.utility";

export async function executeGraphQLFeed(options: ExecuteGraphQLFeedOptions): Promise<{ data: unknown; errors?: unknown[]; responseBytes: number; fetchMs: number }> {
  const started = Date.now();
  const response = await axios.post(options.endpoint, {
    query: options.query,
    variables: options.variables,
    operationName: options.operationName,
  }, {
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    timeout: options.timeoutMs ?? 60000,
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const body = response.data;
  if (body?.errors?.length && !body?.data) {
    throw new Error(`GraphQL returned ${body.errors.length} error(s): ${body.errors[0]?.message ?? "unknown error"}`);
  }
  return { data: body?.data ?? body, errors: body?.errors, responseBytes: JSON.stringify(body).length, fetchMs: Date.now() - started };
}

export function buildGraphQLItems(data: unknown, config: GraphQLFeedConfig): NormalizedFeedItem[] {
  return mapStructuredDataToItems(data, config.mapping);
}
