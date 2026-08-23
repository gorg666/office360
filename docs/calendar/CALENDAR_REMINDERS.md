# Calendar reminder metadata

Status: CAL-118, 2026-08-23 (Asia/Bangkok).

## Domain contract

`src/services/calendar/domain/reminder.ts` owns the provider-neutral contract. An event has an explicit reminder policy:

- `inherit` — use the calendar/provider defaults;
- `none` — explicitly disable reminders;
- `custom` — one or more `CalendarReminder` values.

A reminder uses a relative `before-start` trigger with a canonical whole-minute duration in seconds and a method of `notification` or `email`. The model is not a Google DTO, `VALARM`, DB row, or React form state. Zero seconds is the explicit “at event time” preset; custom numeric input must be positive. Values are bounded to 28 days, duplicate `(method, duration)` values are removed, and the deterministic order is farthest before start to nearest, then method.

The versioned DB envelope is `{ version: 1, policy }`. Migration v36 only appends nullable `calendar_events.reminders_json TEXT`; it performs no update or backfill. Existing rows remain `NULL`. Legacy CalDAV rows may derive the policy in memory from `ical_data`; legacy Google rows remain unknown until a normal provider refresh. Only normal sync/write persists the canonical envelope.

## Provider mappings

Google maps `useDefault=true` (or absent metadata) to `inherit`, `useDefault=false` with no overrides to `none`, and popup/email overrides to custom notification/email reminders. Writes use the inverse mapping. Google permits at most five overrides and durations from 0 through 40,320 minutes.

CalDAV/Yandex maps each relative-to-start `VALARM` independently. `ACTION:DISPLAY` becomes `notification`; `ACTION:EMAIL` is readable as `email`, but CalDAV/Yandex write capability deliberately advertises notification only because Office360 has not validated provider-side email delivery. Multiple DISPLAY alarms are written with relative `TRIGGER` durations. `inherit` cannot be represented in a resource and is rejected before provider I/O.

Absolute triggers, `RELATED=END`, positive/after-start triggers, malformed durations, and unsupported actions are omitted from the normalized policy with a safe diagnostic. They do not make the containing `VEVENT` unreadable. Unrelated CalDAV updates preserve the original alarm subcomponents; an explicit reminder update replaces them. Office360-authored DISPLAY alarms use a generic description and do not persist alarm payload text, recipients, or other private presentation data in the semantic envelope.

## Time, recurrence, and mutations

Durations remain relative to the event's semantic `DTSTART`. All-day reminders therefore follow the provider/calendar interpretation of the all-day date and are never converted through the host timezone. Timed-zoned and floating events keep the CAL-102 time contract; reminder metadata does not recalculate an instant locally.

Recurrence masters carry their reminder policy and materialized instances reference the same semantic policy rather than creating cache rows for each alarm. A remotely supplied override has its own explicit alarm set. A single-occurrence edit clones the master component before applying changes, so an unrelated edit preserves its alarms. Series update, drag, resize, Month moves, and timed/all-day conversion omit the reminder field unless the user explicitly edits it; Google PATCH and CalDAV component mutation consequently preserve existing provider state.

## UI and privacy boundaries

Create and edit surfaces are capability-driven. Supported actions include calendar default, none, event time, standard minute/hour/day presets, multiple reminders, method selection, and a bounded custom number with minutes/hours/days. A legacy unknown value is shown as “leave unchanged” and is not silently written as `none`.

Remote Free/Busy projection accepts only time/attendance geometry. It neither reads nor returns reminder metadata or raw alarm content.

CAL-118 does not schedule Windows toasts, background timers, snooze/dismiss actions, or app-closed delivery. After CAL-120 reassigned the number to the final parity audit, that notification engine remains an unnumbered P0 backlog boundary until the owner selects scope.

## Known limitations

1. Absolute, after-start, and relative-to-end alarms are diagnostic-only.
2. Incoming CalDAV EMAIL alarms are readable but cannot be authored until provider delivery behavior is validated.
3. Unknown alarm properties are preserved only while the original ICS component is updated without an explicit reminder change; they are intentionally absent from the canonical semantic envelope.
