import ICAL from "ical.js";
import { instantSecondsToWallDateTime, zonedWallDateTimeToInstant, type WallDateTime } from "./time";

export const WEEK_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

export type RecurrencePreset = "none" | "daily" | "weekly" | "monthly" | "yearly" | "weekdays" | "custom";
export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; date: string }
  | { kind: "count"; count: number };

export interface RecurrenceDraft {
  preset: RecurrencePreset;
  frequency: RecurrenceFrequency;
  interval: number;
  weekDays: WeekDay[];
  end: RecurrenceEnd;
  sourceRule?: string | null;
}

export interface RecurrenceSerializeContext {
  allDay: boolean;
  timeZone: string;
  start: WallDateTime;
}

const WEEKDAY_SET = new Set<string>(WEEK_DAYS);
const WEEKDAYS_PRESET: readonly WeekDay[] = ["MO", "TU", "WE", "TH", "FR"];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FREQUENCIES = new Set<RecurrenceFrequency>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

export function recurrenceContextFromForm(input: {
  startTime: string;
  allDay: boolean;
  timeZone: string;
}): RecurrenceSerializeContext {
  const date = input.startTime.slice(0, 10);
  const match = DATE_RE.exec(date);
  const year = match ? Number(match[1]) : 1970;
  const month = match ? Number(match[2]) : 1;
  const day = match ? Number(match[3]) : 1;
  if (input.allDay || !input.startTime.includes("T")) {
    return {
      allDay: true,
      timeZone: input.timeZone,
      start: { year, month, day, hour: 0, minute: 0, second: 0 },
    };
  }
  const time = input.startTime.slice(11);
  const [hour = "0", minute = "0", second = "0"] = time.split(":");
  return {
    allDay: false,
    timeZone: input.timeZone,
    start: {
      year,
      month,
      day,
      hour: Number(hour) || 0,
      minute: Number(minute) || 0,
      second: Number(second) || 0,
    },
  };
}

export function emptyRecurrenceDraft(): RecurrenceDraft {
  return {
    preset: "none",
    frequency: "WEEKLY",
    interval: 1,
    weekDays: [],
    end: { kind: "never" },
  };
}

export function stripRecurrenceRulePrefix(value: string): string {
  return value.replace(/^\s*RRULE:/i, "").trim();
}

export function recurrenceRuleFromICalendar(source: string | null | undefined): string | null {
  if (!source?.trim()) return null;
  try {
    const calendar = ICAL.Component.fromString(source);
    const master = calendar.getAllSubcomponents("vevent")
      .find((component) => !component.hasProperty("recurrence-id"));
    const value = master?.getFirstPropertyValue("rrule");
    if (!value) return null;
    return stripRecurrenceRulePrefix(String(value));
  } catch {
    const match = /(?:^|\r?\n)RRULE:([^\r\n]+)/i.exec(source);
    return match?.[1]?.trim() || null;
  }
}

export function parseRecurrenceRule(
  rule: string | null | undefined,
  context?: Pick<RecurrenceSerializeContext, "allDay" | "timeZone">,
): RecurrenceDraft {
  if (!rule?.trim()) return emptyRecurrenceDraft();
  const sourceRule = stripRecurrenceRulePrefix(rule);
  if (!sourceRule) return emptyRecurrenceDraft();
  let recur: InstanceType<typeof ICAL.Recur>;
  try {
    recur = ICAL.Recur.fromString(sourceRule);
  } catch {
    return { ...emptyRecurrenceDraft(), preset: "custom", sourceRule };
  }
  const frequency = String(recur.freq ?? "WEEKLY").toUpperCase() as RecurrenceFrequency;
  const interval = Math.max(1, Number(recur.interval) || 1);
  const weekDays = byDayValues(recur);
  const end = parseEnd(recur, context);
  const draft: RecurrenceDraft = {
    preset: "custom",
    frequency: FREQUENCIES.has(frequency) ? frequency : "WEEKLY",
    interval,
    weekDays,
    end,
    sourceRule,
  };
  draft.preset = detectPreset(draft, recur);
  return draft;
}

export function serializeRecurrenceRule(
  draft: RecurrenceDraft,
  context: RecurrenceSerializeContext,
): string | null {
  if (draft.preset === "none") return null;
  const errors = validateRecurrenceDraft(draft, calendarDateFromWall(context.start));
  if (errors.length > 0) throw new Error(errors[0]);
  if (draft.sourceRule) {
    const parsed = parseRecurrenceRule(draft.sourceRule, context);
    if (sameRecurrenceSemantics(parsed, draft)) return stripRecurrenceRulePrefix(draft.sourceRule);
  }
  const data: Record<string, unknown> = {
    freq: frequencyOf(draft),
    interval: Math.max(1, Math.trunc(draft.interval) || 1),
  };
  const weekDays = weekDaysOf(draft);
  if (weekDays.length > 0) data.byday = weekDays;
  if (draft.end.kind === "count") data.count = Math.max(1, Math.trunc(draft.end.count));
  if (draft.end.kind === "until") data.until = untilTime(draft.end.date, context);
  return ICAL.Recur.fromData(data).toString();
}

export function validateRecurrenceDraft(draft: RecurrenceDraft, eventStartDate: string): string[] {
  if (draft.preset === "none") return [];
  const errors: string[] = [];
  if (!Number.isInteger(draft.interval) || draft.interval < 1) {
    errors.push("Интервал повторения должен быть не меньше 1.");
  }
  if (draft.end.kind === "count" && (!Number.isInteger(draft.end.count) || draft.end.count < 1)) {
    errors.push("Число повторений должно быть не меньше 1.");
  }
  if (draft.end.kind === "until") {
    if (!DATE_RE.test(draft.end.date)) {
      errors.push("Укажите дату окончания повторения.");
    } else if (draft.end.date < eventStartDate) {
      errors.push("Дата окончания повторения не может быть раньше начала события.");
    }
  }
  if (frequencyOf(draft) === "WEEKLY" && draft.preset === "custom" && weekDaysOf(draft).length === 0) {
    errors.push("Для еженедельного повторения выберите хотя бы один день.");
  }
  return errors;
}

export function summarizeRecurrenceRule(draft: RecurrenceDraft): string {
  if (draft.preset === "none") return "Не повторять";
  const interval = Math.max(1, Math.trunc(draft.interval) || 1);
  const frequency = frequencyOf(draft);
  let summary = "";
  if (draft.preset === "weekdays" || sameDays(weekDaysOf(draft), WEEKDAYS_PRESET) && frequency === "WEEKLY" && interval === 1) {
    summary = "По будням";
  } else if (frequency === "DAILY") {
    summary = interval === 1 ? "Каждый день" : `Каждые ${interval} дня`;
    if (interval >= 5) summary = `Каждые ${interval} дней`;
  } else if (frequency === "WEEKLY") {
    const days = weekDaysOf(draft);
    const dayPart = days.length > 0 ? ` по ${formatWeekDays(days)}` : "";
    summary = interval === 1 ? `Каждую неделю${dayPart}` : `Каждые ${interval} недели${dayPart}`;
    if (interval >= 5) summary = `Каждые ${interval} недель${dayPart}`;
  } else if (frequency === "MONTHLY") {
    summary = interval === 1 ? "Каждый месяц" : `Каждые ${interval} месяца`;
    if (interval >= 5) summary = `Каждые ${interval} месяцев`;
  } else {
    summary = interval === 1 ? "Каждый год" : `Каждые ${interval} года`;
    if (interval >= 5) summary = `Каждые ${interval} лет`;
  }
  if (draft.end.kind === "until") {
    const formatted = formatUntilDate(draft.end.date);
    if (formatted) summary += ` до ${formatted}`;
  } else if (draft.end.kind === "count") {
    summary += ` · ${draft.end.count} ${pluralize(draft.end.count, "повторение", "повторения", "повторений")}`;
  }
  return summary;
}

export function applyRecurrencePreset(preset: RecurrencePreset, current: RecurrenceDraft): RecurrenceDraft {
  if (preset === "none") return { ...emptyRecurrenceDraft(), end: current.end.kind === "never" ? current.end : { kind: "never" } };
  const next: RecurrenceDraft = {
    ...current,
    preset,
    sourceRule: undefined,
    interval: preset === "custom" ? Math.max(1, current.interval) : 1,
    weekDays: preset === "weekdays" ? [...WEEKDAYS_PRESET] : preset === "custom" ? current.weekDays : [],
    frequency: frequencyForPreset(preset, current.frequency),
  };
  return next;
}

export function sameRecurrenceSemantics(a: RecurrenceDraft, b: RecurrenceDraft): boolean {
  if (a.preset === "none" && b.preset === "none") return true;
  if (frequencyOf(a) !== frequencyOf(b)) return false;
  if (Math.max(1, a.interval) !== Math.max(1, b.interval)) return false;
  if (!sameDays(weekDaysOf(a), weekDaysOf(b))) return false;
  if (a.end.kind !== b.end.kind) return false;
  if (a.end.kind === "count" && b.end.kind === "count") return a.end.count === b.end.count;
  if (a.end.kind === "until" && b.end.kind === "until") return a.end.date === b.end.date;
  return true;
}

function frequencyForPreset(preset: RecurrencePreset, fallback: RecurrenceFrequency): RecurrenceFrequency {
  switch (preset) {
    case "daily": return "DAILY";
    case "weekly":
    case "weekdays": return "WEEKLY";
    case "monthly": return "MONTHLY";
    case "yearly": return "YEARLY";
    default: return fallback;
  }
}

function frequencyOf(draft: RecurrenceDraft): RecurrenceFrequency {
  if (draft.preset === "custom" || draft.preset === "none") return draft.frequency;
  return frequencyForPreset(draft.preset, draft.frequency);
}

function weekDaysOf(draft: RecurrenceDraft): WeekDay[] {
  if (draft.preset === "weekdays") return [...WEEKDAYS_PRESET];
  if (frequencyOf(draft) !== "WEEKLY") return [];
  return uniqueWeekDays(draft.weekDays);
}

function detectPreset(draft: RecurrenceDraft, recur: InstanceType<typeof ICAL.Recur>): RecurrencePreset {
  if (hasUnsupportedParts(recur)) return "custom";
  if (draft.end.kind !== "never") {
    const withoutEnd = { ...draft, end: { kind: "never" as const } };
    const preset = detectPreset(withoutEnd, recur);
    return preset === "custom" ? "custom" : preset;
  }
  if (draft.interval !== 1) return "custom";
  if (draft.frequency === "DAILY" && draft.weekDays.length === 0) return "daily";
  if (draft.frequency === "WEEKLY" && sameDays(draft.weekDays, WEEKDAYS_PRESET)) return "weekdays";
  if (draft.frequency === "WEEKLY" && draft.weekDays.length === 0) return "weekly";
  if (draft.frequency === "MONTHLY" && draft.weekDays.length === 0) return "monthly";
  if (draft.frequency === "YEARLY" && draft.weekDays.length === 0) return "yearly";
  return "custom";
}

function hasUnsupportedParts(recur: InstanceType<typeof ICAL.Recur>): boolean {
  const parts = (recur.parts ?? {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(parts)) {
    if (name.toUpperCase() === "BYDAY") {
      const days = Array.isArray(value) ? value : [value];
      if (days.some((day) => /^\d/.test(String(day)) || /^-/.test(String(day)))) return true;
      continue;
    }
    if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) return true;
  }
  return false;
}

function byDayValues(recur: InstanceType<typeof ICAL.Recur>): WeekDay[] {
  const parts = (recur.parts ?? {}) as Record<string, unknown>;
  const raw = parts.BYDAY ?? parts.byday;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return uniqueWeekDays(list.flatMap((value) => {
    const match = /([A-Z]{2})$/i.exec(String(value).trim());
    const day = match?.[1]?.toUpperCase();
    return day && WEEKDAY_SET.has(day) ? [day as WeekDay] : [];
  }));
}

function uniqueWeekDays(days: readonly WeekDay[]): WeekDay[] {
  const seen = new Set<WeekDay>();
  const ordered: WeekDay[] = [];
  for (const day of WEEK_DAYS) {
    if (days.includes(day) && !seen.has(day)) {
      seen.add(day);
      ordered.push(day);
    }
  }
  return ordered;
}

function sameDays(a: readonly WeekDay[], b: readonly WeekDay[]): boolean {
  return uniqueWeekDays(a).join(",") === uniqueWeekDays(b).join(",");
}

function parseEnd(
  recur: InstanceType<typeof ICAL.Recur>,
  context?: Pick<RecurrenceSerializeContext, "allDay" | "timeZone">,
): RecurrenceEnd {
  if (typeof recur.count === "number" && recur.count > 0) return { kind: "count", count: recur.count };
  if (!recur.until) return { kind: "never" };
  const until = recur.until as { isDate?: boolean; year: number; month: number; day: number; toUnixTime?: () => number; toJSDate?: () => Date };
  if (until.isDate || context?.allDay) {
    return { kind: "until", date: `${pad(until.year, 4)}-${pad(until.month)}-${pad(until.day)}` };
  }
  const unix = typeof until.toUnixTime === "function"
    ? until.toUnixTime()
    : Math.floor((until.toJSDate?.() ?? new Date(0)).getTime() / 1000);
  const wall = instantSecondsToWallDateTime(unix, context?.timeZone ?? "UTC");
  return { kind: "until", date: calendarDateFromWall(wall) };
}

function untilTime(date: string, context: RecurrenceSerializeContext): InstanceType<typeof ICAL.Time> {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error("Укажите дату окончания повторения.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (context.allDay) {
    return ICAL.Time.fromData({ year, month, day, isDate: true });
  }
  const instant = zonedWallDateTimeToInstant({
    year,
    month,
    day,
    hour: context.start.hour,
    minute: context.start.minute,
    second: context.start.second,
  }, context.timeZone);
  return ICAL.Time.fromJSDate(new Date(instant * 1000), true);
}

function calendarDateFromWall(wall: Pick<WallDateTime, "year" | "month" | "day">): string {
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

function formatUntilDate(value: string): string | null {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatWeekDays(days: readonly WeekDay[]): string {
  const names: Record<WeekDay, string> = {
    MO: "понедельникам",
    TU: "вторникам",
    WE: "средам",
    TH: "четвергам",
    FR: "пятницам",
    SA: "субботам",
    SU: "воскресеньям",
  };
  const labels = days.map((day) => names[day]);
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} и ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} и ${labels[labels.length - 1]}`;
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}
