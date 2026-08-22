# CAL-108 — Scheduling Assistant model

Status: implemented on `feat/calendar-yandex360`, 2026-08-22.
Code: `src/services/calendar/scheduling/`.
Migration: **NONE**. The engine is stateless on top of CAL-107.

CAL-108 is the group availability engine. It is not a visual Scheduling Assistant. A later UI
ticket must consume this contract and must not read Calendar DB, Google DTOs, CalDAV, or ICS
to decide whether a slot is free.

## Layering

```text
SchedulingAssistantService.planMeeting()
        ↓
FreeBusyService.queryAvailability()
        ↓
ParticipantAvailability[]   (CAL-107)
```

The engine never re-projects events, never parses ICS, and never inspects provider payloads.
Busy time arrives as opaque `BusyInterval`s. Remote Free/Busy adapters can plug in under
CAL-107 later without changing this layer.

Required vs optional is scheduling-layer metadata. CAL-107 availability does not carry attendee
role; the same person is busy regardless of how they were invited.

## Request

```ts
interface GroupSchedulingRequest {
  requiredParticipants: readonly ParticipantRef[];
  optionalParticipants?: readonly ParticipantRef[];
  range: { start: number; end: number };   // Unix seconds, half-open
  durationSeconds: number;                 // meeting length; not hardcoded
  timeZone: string;                        // IANA display zone for snapping
  options?: {
    granularitySeconds?: number;           // default 30 minutes; any whole-minute step
    workingHours?: WorkingHoursConstraint; // omitted = constraint disabled
    stalenessThresholdSeconds?: number | null;
    signal?: AbortSignal;
  };
}
```

An identity listed as both required and optional is treated as **required**. There is one
batched availability query for the flattened participant list.

## Slot classification

Computed from **required** participants only:

| Required state present | Classification |
| --- | --- |
| any `busy` | `blocked` |
| else any `unknown` (`unsupported`, `permission-denied`, `error`, `partial`, `unknown`) | `unknown` |
| else any `tentative` | `possible` |
| all required known and free | `confirmed` |

Optional busy never turns a confirmed slot into a blocked one. Absence of data is never free:
a remote participant that CAL-107 reports as `unsupported` yields `unknown`, not `confirmed`.

## Group timeline

`buildGroupTimeline` splits the requested range at every busy-interval boundary. Each segment
exposes index arrays:

```text
requiredFree / requiredBusy / requiredTentative / requiredUnknown
optionalFree / optionalBusy / optionalTentative / optionalUnknown
```

Segments do not store `CalendarEvent`. Participant objects live once on
`GroupSchedulingResult.participants`; slots and segments refer to them by `index`.

## Candidate search and snapping

`findCandidateSlots` walks candidate starts on the **requested display timezone** wall clock,
from local midnight, in `granularitySeconds` steps. A 30-minute grid therefore stays on
`:00` / `:30` local time across DST. `10:07` is never a candidate start.

Duration is independent of granularity. A 90-minute meeting on a 15-minute grid is valid; the
candidate must fit entirely inside the range. The host timezone is never the source of truth.

Typical granularities covered by tests: 15, 30 and 60 minutes. Any positive whole-minute value
is accepted.

## Working hours

Working hours are a **separate constraint**, not a `BusyInterval`.

```ts
interface WorkingHours {
  timeZone: string;          // per participant; may differ from the display zone
  workingDays: number[];     // 0 = Sunday .. 6 = Saturday
  startMinute: number;       // inclusive, from local midnight
  endMinute: number;         // exclusive; must be greater than startMinute
}
```

- No window supplied → constraint disabled. There is no implicit 09:00–18:00.
- `policy: "prefer"` keeps the slot and penalises participants outside their window.
- `policy: "require"` classifies an otherwise feasible slot as `blocked` when a **required**
  participant is outside their window.
- Overnight windows (`endMinute <= startMinute`) are rejected.
- Participant A in `Europe/Moscow` and participant B in `Asia/Bangkok` are resolved through
  the CAL-102 IANA resolver independently of the scheduler display zone.

Outside-working-hours is a distinct `UnavailableReason`. It must not be merged with `busy`.

## Ranking and suggestions

`suggestSlots(candidates, limit = 3)` drops `blocked` slots, then orders by score, then by
start. There is no AI and no randomness.

Classification dominates by construction. Other components are clamped so they cannot reorder
two different classifications. Within `confirmed`:

```text
confirmed + optional free
  > confirmed + optional conflict
  > possible
  > unknown
  > blocked   (never suggested)
```

Weights live in `SLOT_SCORE_WEIGHTS` (`slots.ts`). Earliness is a bounded tie-break only.
Identical input always produces identical suggestions.

## Explainability

Each `CandidateSlot` carries structured reasons a UI can render without event titles:

| `UnavailableReason` | Intended copy |
| --- | --- |
| `busy` | occupied |
| `tentative` | possibly occupied |
| `unknown` | availability unknown |
| `outside-working-hours` | outside working hours |

`requiredConflicts` / `optionalConflicts` point at `participants[index]`. Display names come
from `ParticipantRef`, never from a calendar event.

## Privacy

The assistant payload must not contain:

```text
event title, description, location, raw ICS, UID, provider resource ID
```

`ParticipantAvailability.busy` still has only `start`, `end`, `busyType`. Opening an event
remains a separate Calendar lookup.

## UI contract for CAL-109

A visual Scheduling Assistant should call `planMeeting` (or an application-service wrapper)
and render **only** `GroupSchedulingResult`:

| Field | UI use |
| --- | --- |
| `participants` | rows, required vs optional, identity keys |
| `range`, `timeZone`, `durationSeconds`, `granularitySeconds` | timeline ruler and slot size |
| `availability` | per-participant busy/tentative/unknown blocks |
| `participants[].reliability` | honesty: unsupported is not free |
| `segments` | group overlay / current aggregate state |
| `candidates` | selectable slots with scores |
| `suggestions` | ranked shortlist |
| `workingHoursApplied`, `workingHoursPolicy` | show the constraint separately from busy |
| `requiredConflicts` / `optionalConflicts` | why this slot is worse |

The UI must not:

- query Calendar DB for Free/Busy;
- treat `unknown` / `unsupported` as free;
- draw working-hours overlays as busy intervals;
- implement ranking itself.

CAL-109 is the visual ticket. This engine does not ship participant picker, drag selection,
or a Yandex-like coloured timeline.

## Known limitations

1. Remote participants remain `unsupported` until CAL-110 adds provider Free/Busy adapters.
2. Overnight working hours are not modelled.
3. The engine does not trigger a calendar sync; it reports whatever CAL-107 already knows.
4. Room booking, directory search and working-hours settings UI are out of scope.
