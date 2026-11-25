import { describe, expect, it } from "vitest";
import { JURISDICTION_OPTIONS } from "./jurisdictionOptions";

describe("JURISDICTION_OPTIONS", () => {
  const index = (value: string) =>
    JURISDICTION_OPTIONS.findIndex((option) => option.value === value);

  it("lists each country's subdivisions, indented, right after it", () => {
    const uk = index("United Kingdom");
    expect(JURISDICTION_OPTIONS.slice(uk, uk + 4)).toEqual([
      { value: "United Kingdom", label: "United Kingdom" },
      { value: "England and Wales", label: "England and Wales", nested: true },
      { value: "Scotland", label: "Scotland", nested: true },
      { value: "Northern Ireland", label: "Northern Ireland", nested: true },
    ]);
    expect(JURISDICTION_OPTIONS[index("Delaware")]).toMatchObject({ nested: true });
    expect(index("Delaware")).toBeGreaterThan(index("United States"));
    expect(index("Ontario")).toBeGreaterThan(index("Canada"));
  });

  it("names a state that shares a country's name with its country, and keeps every value unique", () => {
    expect(JURISDICTION_OPTIONS).toContainEqual({
      value: "Georgia (US)",
      label: "Georgia",
      nested: true,
    });
    expect(JURISDICTION_OPTIONS).toContainEqual({ value: "Georgia", label: "Georgia" });
    const values = JURISDICTION_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
