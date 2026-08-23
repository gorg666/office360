# CAL-125 — Recurring create and participant roles

Status: **PASS** on `feat/calendar-yandex360`.
Migration: **NONE**.
Live smoke: Create → Cancel only; no real Yandex Save.

## Boundary

Create/edit UI authors recurrence and required/optional attendees through existing domain contracts. React does not implement RRULE, EXDATE, RECURRENCE-ID, DST or identity merge.

| Concern | Owner |
| --- | --- |
| RRULE parse/serialize/validate/summary | `src/services/calendar/domain/recurrenceRule.ts` |
| Recurrence presets and custom panel | `src/components/calendar/recurrence/RecurrenceRuleEditor.tsx` |
| Required/optional authoring | `src/components/calendar/participants/` |
| Create payload | `EventCreateModal` → `CalendarPage` → `CalendarMutationService.create` |
| Series RRULE edit | `EventDetailModal` with `scope=series` |
| Occurrence safety | editor `readOnly`; mutation omits `recurrenceRule` unless `scope=series` |
| Mail REQUEST | CAL-122 / existing codec (`RRULE` + `ROLE`) |
| Reminders | CAL-118 `ReminderEditor` unchanged |
| Scheduling Assistant | current occurrence start/end only |

`this-and-future` remains unsupported and is not offered as a working create/edit choice.

## Recurring create

`EventCreateModal` always shows the recurrence fieldset, including drafts opened from Day/Week/Month selection.

Presets (Russian production copy):

- Не повторять
- Каждый день → `FREQ=DAILY`
- Каждую неделю → `FREQ=WEEKLY`
- Каждый месяц → `FREQ=MONTHLY` (same calendar day)
- Каждый год → `FREQ=YEARLY` (same month/day)
- По будням → `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`
- Настроить…

Custom minimum:

- frequency + interval ≥ 1
- weekly: one or more days `Пн…Вс`
- end: never / until date / after N occurrences (N ≥ 1)
- until date ≥ event start date

UNTIL for timed events uses the event wall-clock in the event timezone, converted to UTC DATE-TIME (CAL-102). All-day UNTIL is a DATE value. Host-local `Date` arithmetic is not used to build the rule.

Human-readable summary is Russian (`data-testid="recurrence-summary"`). Raw RRULE is not shown.

nth-weekday monthly (`BYDAY=1MO`) is not a required editor surface. An unsupported source rule is kept until the user changes authored fields.

## Edit

Series master / `scope=series`: the current master RRULE is loaded and can be replaced through the same editor.

Single occurrence: the recurrence editor is read-only. Save does not send `recurrenceRule`, so the master RRULE cannot be overwritten accidentally.

## Participants

Authoring UI minimum is required/optional:

- new participant defaults to **required** (`ROLE=REQ-PARTICIPANT`)
- in-place role change does not create a second attendee
- CAL-106 identity normalization still blocks duplicates
- organizer is not an editable participant row
- current-user RSVP identity is unchanged

Roles persist through the existing participant model (provider → cache → UI). Scheduling Assistant re-queries when a role changes: required affects confirmed-slot classification; optional affects ranking only. Recurring create does not compute availability for future instances.

## Invitation lifecycle

A recurring create with attendees still goes through CAL-122. Generated REQUEST keeps `RRULE` plus `ROLE=REQ-PARTICIPANT` / `ROLE=OPT-PARTICIPANT`. Live smoke must not send real mail.

## Tests

- domain roundtrip: UI draft → serialize → parse → same semantics
- create presets, custom interval/days, until, count, all-day, validation
- participant add/change/no-duplicate
- Scheduling Assistant role re-query
- series edit loads and replaces RRULE; occurrence save omits it
- outbound REQUEST fixture with RRULE + ROLE
- CAL-111/112, CAL-118 and CAL-122 regressions remain in the full battery
