import { describe, expect, it } from "vitest";
import { parseFirstAddressFromList, parseSingleEmailAddress } from "./emailAddressParse";

describe("parseSingleEmailAddress", () => {
  it("parses angle-addr with name", () => {
    expect(parseSingleEmailAddress("Jane <jane@ex.com>")).toEqual({
      name: "Jane",
      address: "jane@ex.com",
    });
  });

  it("parses bare email", () => {
    expect(parseSingleEmailAddress("solo@ex.com")).toEqual({
      name: null,
      address: "solo@ex.com",
    });
  });

  it("parses angle-addr with multi-word display name", () => {
    expect(parseSingleEmailAddress("Timing Web <info@timingweb.com>")).toEqual({
      name: "Timing Web",
      address: "info@timingweb.com",
    });
  });

  it("parses obsolete addr (comment) form", () => {
    expect(parseSingleEmailAddress("info@timingweb.com (Timing Web)")).toEqual({
      name: "Timing Web",
      address: "info@timingweb.com",
    });
  });

  it('parses quoted display name with comma', () => {
    expect(parseSingleEmailAddress('"Doe, Jane" <jane@ex.com>')).toEqual({
      name: "Doe, Jane",
      address: "jane@ex.com",
    });
  });
});

describe("parseFirstAddressFromList", () => {
  it("returns first of two addresses", () => {
    expect(parseFirstAddressFromList("One <a@a.com>, Two <b@b.com>")).toEqual({
      name: "One",
      address: "a@a.com",
    });
  });
});
