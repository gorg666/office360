import { describe, expect, it } from "vitest";
import {
  applyRecurrencePreset,
  emptyRecurrenceDraft,
  parseRecurrenceRule,
  recurrenceRuleFromICalendar,
  serializeRecurrenceRule,
  summarizeRecurrenceRule,
  validateRecurrenceDraft,
  type RecurrenceDraft,
  type RecurrenceSerializeContext,
} from "./recurrenceRule";

const MOSCOW_START = { year: 2026, month: 9, day: 8, hour: 10, minute: 0, second: 0 };
const MOSCOW: RecurrenceSerializeContext = {
  allDay: false,
  timeZone: "Europe/Moscow",
  start: MOSCOW_START,
};

function roundTrip(draft: RecurrenceDraft, context: RecurrenceSerializeContext = MOSCOW): RecurrenceDraft {
  const rule = serializeRecurrenceRule(draft, context);
  return parseRecurrenceRule(rule, context);
}

describe("recurrence rule authoring", () => {
  it("serializes daily/weekly/monthly/yearly presets", () => {
    expect(serializeRecurrenceRule(applyRecurrencePreset("daily", emptyRecurrenceDraft()), MOSCOW)).toBe("FREQ=DAILY");
    expect(serializeRecurrenceRule(applyRecurrencePreset("weekly", emptyRecurrenceDraft()), MOSCOW)).toBe("FREQ=WEEKLY");
    expect(serializeRecurrenceRule(applyRecurrencePreset("monthly", emptyRecurrenceDraft()), MOSCOW)).toBe("FREQ=MONTHLY");
    expect(serializeRecurrenceRule(applyRecurrencePreset("yearly", emptyRecurrenceDraft()), MOSCOW)).toBe("FREQ=YEARLY");
    expect(serializeRecurrenceRule(applyRecurrencePreset("weekdays", emptyRecurrenceDraft()), MOSCOW))
      .toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  it("round-trips weekly multi-day custom interval", () => {
    const draft: RecurrenceDraft = {
      preset: "custom",
      frequency: "WEEKLY",
      interval: 2,
      weekDays: ["TU", "TH"],
      end: { kind: "never" },
    };
    const rule = serializeRecurrenceRule(draft, MOSCOW);
    expect(rule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH");
    expect(roundTrip(draft)).toMatchObject({ frequency: "WEEKLY", interval: 2, weekDays: ["TU", "TH"] });
  });

  it("serializes until using event wall-clock in the event timezone", () => {
    const draft: RecurrenceDraft = {
      preset: "daily",
      frequency: "DAILY",
      interval: 1,
      weekDays: [],
      end: { kind: "until", date: "2026-09-30" },
    };
    const rule = serializeRecurrenceRule(draft, MOSCOW);
    expect(rule).toContain("FREQ=DAILY");
    expect(rule).toContain("UNTIL=20260930T070000Z");
    const parsed = parseRecurrenceRule(rule, MOSCOW);
    expect(parsed.end).toEqual({ kind: "until", date: "2026-09-30" });
  });

  it("serializes all-day until as a DATE value", () => {
    const context: RecurrenceSerializeContext = {
      allDay: true,
      timeZone: "America/New_York",
      start: { year: 2026, month: 9, day: 8, hour: 0, minute: 0, second: 0 },
    };
    const rule = serializeRecurrenceRule({
      preset: "weekly",
      frequency: "WEEKLY",
      interval: 1,
      weekDays: [],
      end: { kind: "until", date: "2026-10-06" },
    }, context);
    expect(rule).toMatch(/UNTIL=20261006$/);
    expect(parseRecurrenceRule(rule, context).end).toEqual({ kind: "until", date: "2026-10-06" });
  });

  it("round-trips count", () => {
    const draft: RecurrenceDraft = {
      preset: "monthly",
      frequency: "MONTHLY",
      interval: 1,
      weekDays: [],
      end: { kind: "count", count: 6 },
    };
    expect(serializeRecurrenceRule(draft, MOSCOW)).toBe("FREQ=MONTHLY;COUNT=6");
    expect(roundTrip(draft).end).toEqual({ kind: "count", count: 6 });
  });

  it("validates interval, count, until and weekly days", () => {
    expect(validateRecurrenceDraft({
      preset: "custom", frequency: "DAILY", interval: 0, weekDays: [], end: { kind: "never" },
    }, "2026-09-08")).toContain("Интервал повторения должен быть не меньше 1.");
    expect(validateRecurrenceDraft({
      preset: "custom", frequency: "DAILY", interval: 1, weekDays: [], end: { kind: "count", count: 0 },
    }, "2026-09-08")).toContain("Число повторений должно быть не меньше 1.");
    expect(validateRecurrenceDraft({
      preset: "custom", frequency: "DAILY", interval: 1, weekDays: [], end: { kind: "until", date: "2026-09-01" },
    }, "2026-09-08")).toContain("Дата окончания повторения не может быть раньше начала события.");
    expect(validateRecurrenceDraft({
      preset: "custom", frequency: "WEEKLY", interval: 1, weekDays: [], end: { kind: "never" },
    }, "2026-09-08")).toContain("Для еженедельного повторения выберите хотя бы один день.");
  });

  it("summarizes in Russian without raw RRULE tokens", () => {
    const summary = summarizeRecurrenceRule({
      preset: "custom",
      frequency: "WEEKLY",
      interval: 2,
      weekDays: ["TU", "TH"],
      end: { kind: "until", date: "2026-09-30" },
    });
    expect(summary).toBe("Каждые 2 недели по вторникам и четвергам до 30 сентября 2026 г.");
    expect(summary).not.toMatch(/WEEKLY|UNTIL|COUNT|FREQ|RRULE/i);
    expect(summarizeRecurrenceRule(applyRecurrencePreset("weekdays", emptyRecurrenceDraft()))).toBe("По будням");
  });

  it("extracts the master RRULE from an iCalendar payload", () => {
    const ics = [
      "BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:series-1",
      "DTSTART;TZID=Europe/Moscow:20260908T100000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU,TH",
      "END:VEVENT",
      "BEGIN:VEVENT", "UID:series-1", "RECURRENCE-ID;TZID=Europe/Moscow:20260915T100000",
      "DTSTART;TZID=Europe/Moscow:20260915T110000",
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    expect(recurrenceRuleFromICalendar(ics)).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
  });

  it("keeps an unsupported source rule until the user changes authored fields", () => {
    const source = "FREQ=MONTHLY;BYDAY=1MO;COUNT=4";
    const parsed = parseRecurrenceRule(source, MOSCOW);
    expect(parsed.preset).toBe("custom");
    expect(serializeRecurrenceRule(parsed, MOSCOW)).toBe(source);
  });
});
