import { describe, it, expect } from "bun:test";
import { processDates } from "../utilities/data-handler.utility";

describe("processDates — isFallback", () => {
  it("returns isFallback: false for a valid ISO date string", () => {
    const { date, isFallback } = processDates("2024-03-15T10:00:00Z");
    expect(isFallback).toBe(false);
    expect(date.getFullYear()).toBe(2024);
  });

  it("returns isFallback: false for a unix timestamp string", () => {
    const { date, isFallback } = processDates("1710499200");
    expect(isFallback).toBe(false);
    expect(date.getTime()).toBeGreaterThan(0);
  });

  it("returns isFallback: true for an empty string", () => {
    const { isFallback } = processDates("");
    expect(isFallback).toBe(true);
  });

  it("returns isFallback: true for an unparseable string", () => {
    const { isFallback } = processDates("not a date at all");
    expect(isFallback).toBe(true);
  });

  it("returns isFallback: false when given an existing Date object", () => {
    const d = new Date("2023-01-01");
    const { date, isFallback } = processDates(d);
    expect(isFallback).toBe(false);
    expect(date).toBe(d);
  });
});
