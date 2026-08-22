import {
  DST_DISAMBIGUATION_POLICY,
  instantSecondsToWallDateTime,
  parseWallDateTime,
  zonedWallDateTimeToInstant,
} from "./time";

describe("Calendar IANA time resolver", () => {
  it("resolves a Moscow wall time independently of the host timezone", () => {
    const wall = parseWallDateTime("20260315T100000");
    expect(new Date(zonedWallDateTimeToInstant(wall, "Europe/Moscow") * 1000).toISOString())
      .toBe("2026-03-15T07:00:00.000Z");
  });

  it("shifts a DST gap to the first valid wall instant", () => {
    const wall = parseWallDateTime("20260308T023000");
    const instant = zonedWallDateTimeToInstant(wall, "America/New_York");
    expect(DST_DISAMBIGUATION_POLICY.gap).toBe("shift-forward");
    expect(instantSecondsToWallDateTime(instant, "America/New_York")).toEqual({
      year: 2026, month: 3, day: 8, hour: 3, minute: 0, second: 0,
    });
  });

  it("chooses the earlier instant in a DST overlap", () => {
    const wall = parseWallDateTime("20261101T013000");
    expect(DST_DISAMBIGUATION_POLICY.overlap).toBe("earlier");
    expect(new Date(zonedWallDateTimeToInstant(wall, "America/New_York") * 1000).toISOString())
      .toBe("2026-11-01T05:30:00.000Z");
  });

  it("supports a 30-minute DST transition in Australia/Lord_Howe", () => {
    const wall = parseWallDateTime("20261004T021500");
    const instant = zonedWallDateTimeToInstant(wall, "Australia/Lord_Howe");
    expect(instantSecondsToWallDateTime(instant, "Australia/Lord_Howe")).toEqual({
      year: 2026, month: 10, day: 4, hour: 2, minute: 30, second: 0,
    });
  });
});
