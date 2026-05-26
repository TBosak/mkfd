import { describe, expect, test } from "bun:test";
import type { FeedConfigTemplate } from "../models/feed-template.model";
import type { ProtectedValue } from "../models/protected-value.model";
import {
  findTemplateExpressions,
  hasFeedTemplate,
  parseTemplateExpression,
  renderFeedConfigTemplate,
  validateFeedTemplate,
} from "../utilities/feed-template.utility";
import { resolveProtectedValue } from "../utilities/protected-values.utility";

describe("feed templates", () => {
  test("FeedConfigTemplate compiles with all variable types", () => {
    const template: FeedConfigTemplate = {
      variables: {
        owner: { label: "Owner", type: "string", required: true },
        count: { label: "Count", type: "number", defaultValue: 20 },
        enabled: { label: "Enabled", type: "boolean" },
        endpoint: { label: "Endpoint", type: "url" },
        mode: { label: "Mode", type: "select", options: [{ label: "A", value: "a" }] },
        body: { label: "Body", type: "textarea" },
        apiKey: { label: "API Key", type: "secret", encrypted: true },
      },
    };
    expect(Object.keys(template.variables)).toHaveLength(7);
  });

  test("ProtectedValue env variant accepts prefix and suffix", () => {
    process.env.MKFD_TEMPLATE_TEST = "token";
    const v: ProtectedValue = { type: "env", value: "MKFD_TEMPLATE_TEST", prefix: "Bearer ", suffix: "!" };
    expect(resolveProtectedValue(v, "")).toBe("Bearer token!");
  });

  test("renders values, filters, and strips template block", () => {
    const rendered = renderFeedConfigTemplate({
      feedName: "{{ owner | trim | slug }}",
      config: { baseUrl: "https://example.com/{{ owner | urlEncode }}" },
      headers: { Authorization: "{{ secret.apiKey | bearer }}" },
      template: {
        variables: {
          owner: { label: "Owner", type: "string", required: true },
          apiKey: { label: "API Key", type: "secret", encrypted: true },
        },
      },
    }, {
      feedId: "templated-feed",
      encryptionKey: "1234567890123456",
      values: { owner: " City Desk ", apiKey: "secret" },
      secretStorage: { apiKey: "protected" },
      origin: { type: "manual" },
    });
    expect(rendered.feedName).toBe("city-desk");
    expect(rendered.template).toBeUndefined();
    expect(rendered.headers).toMatchObject({ Authorization: { type: "protected" } });
  });

  test("validates required and URL values", () => {
    const result = validateFeedTemplate({
      variables: { endpoint: { label: "Endpoint", type: "url", required: true } },
    }, { endpoint: "not a url" });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("valid URL");
  });

  test("detects template block", () => {
    expect(hasFeedTemplate({ template: { variables: {} } })).toBe(true);
  });

  test("parses template expressions", () => {
    expect(parseTemplateExpression("{{ owner }}")).toMatchObject({
      namespace: "value",
      variableName: "owner",
      filters: [],
    });
    expect(parseTemplateExpression("{{ secret.token | bearer }}")).toMatchObject({
      namespace: "secret",
      variableName: "token",
      filters: ["bearer"],
    });
    expect(parseTemplateExpression("plain text")).toBeNull();
  });

  test("finds nested template expressions", () => {
    const expressions = findTemplateExpressions({
      config: { route: "/repos/{{ owner }}/{{ repo }}/releases" },
      headers: { Authorization: "{{ secret.token | bearer }}" },
    });
    expect(expressions.map((expr) => expr.variableName)).toEqual(["owner", "repo", "token"]);
    expect(expressions.at(-1)).toMatchObject({ path: "headers.Authorization", filters: ["bearer"] });
  });

  test("rejects undefined variables and unsupported filters", () => {
    expect(() => renderFeedConfigTemplate({
      feedName: "{{ missing | nope }}",
      template: { variables: {} },
    }, {
      feedId: "x",
      encryptionKey: "1234567890123456",
      values: {},
    })).toThrow(/not defined/);
  });
});
