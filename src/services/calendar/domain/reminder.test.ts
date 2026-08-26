import {
  createCalendarReminder,
  normalizeCalendarReminderPolicy,
  parseCalendarReminderPolicy,
  serializeCalendarReminderPolicy,
} from "./reminder";

describe("Calendar reminder domain", () => {
  it.each(["inherit", "none"] as const)("preserves the %s policy", (kind) => {
    expect(normalizeCalendarReminderPolicy({ kind })).toEqual({ kind });
  });

  it("normalizes multiple reminders, removes duplicates, and sorts farthest first", () => {
    const policy = normalizeCalendarReminderPolicy({
      kind: "custom",
      reminders: [
        createCalendarReminder(15, "minutes"),
        createCalendarReminder(1, "days"),
        createCalendarReminder(1, "hours", "email"),
        createCalendarReminder(15, "minutes"),
      ],
    });

    expect(policy).toEqual({
      kind: "custom",
      reminders: [
        createCalendarReminder(1, "days"),
        createCalendarReminder(1, "hours", "email"),
        createCalendarReminder(15, "minutes"),
      ],
    });
  });

  it("supports at-event-time and minutes, hours, and days", () => {
    expect(createCalendarReminder(0, "minutes").trigger.duration.seconds).toBe(0);
    expect(createCalendarReminder(5, "minutes").trigger.duration.seconds).toBe(300);
    expect(createCalendarReminder(2, "hours").trigger.duration.seconds).toBe(7200);
    expect(createCalendarReminder(3, "days").trigger.duration.seconds).toBe(259200);
  });

  it.each([
    () => createCalendarReminder(-1, "minutes"),
    () => createCalendarReminder(Number.MAX_SAFE_INTEGER, "days"),
    () => normalizeCalendarReminderPolicy({
      kind: "custom",
      reminders: [{ method: "notification", trigger: { kind: "before-start", duration: { seconds: 61 } } }],
    }),
    () => normalizeCalendarReminderPolicy({
      kind: "custom",
      reminders: [{ method: "audio" as "notification", trigger: { kind: "before-start", duration: { seconds: 60 } } }],
    }),
  ])("rejects invalid duration or method input", (build) => {
    expect(build).toThrow();
  });

  it("round-trips the versioned persistence envelope and rejects unknown data", () => {
    const policy = { kind: "custom", reminders: [createCalendarReminder(10, "minutes")] } as const;
    expect(parseCalendarReminderPolicy(serializeCalendarReminderPolicy(policy))).toEqual(policy);
    expect(parseCalendarReminderPolicy('{"version":2}')).toBeNull();
    expect(parseCalendarReminderPolicy("not-json")).toBeNull();
  });
});
