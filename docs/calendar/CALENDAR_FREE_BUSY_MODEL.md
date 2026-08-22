# CAL-107 — Calendar Free/Busy model

Status: implemented on `feat/calendar-yandex360`, 2026-08-22.
Code: `src/services/calendar/freeBusy/`.

CAL-107 is a foundation, not a feature. It answers *who*, *for which interval*, *in which
timezone*, *busy or free*, *why*, and *how much the answer can be trusted*. It does not build a
Scheduling Assistant, does not recommend slots, and does not implement working hours.

## The rule everything else follows

**Absence of data is never free time.** A calendar that was never synced, a range that is only
partially covered, an identity no adapter can answer for, a denied permission and a provider
failure all read as *not free*, and each is distinguishable from the others.

This is enforced structurally rather than by convention: `busy` intervals and *reliability* are
separate fields, and the only accessor that produces `free` is `availabilityStateAt` /
`availabilityStateForInterval`, which requires `reliability === "known"`.

```text
state at instant t:
  a busy interval covers t      -> "busy" (or "tentative")
  nothing covers t, known       -> "free"
  nothing covers t, anything else -> "unknown"
```

## Input contract

Availability is asked about **identities**, never about events:

```ts
interface AvailabilityRequest {
  participants: readonly ParticipantRef[];   // CAL-106 identity, no roles
  range: { start: number; end: number };     // Unix seconds, half-open [start, end)
  timeZone: string;                          // IANA
  options?: { stalenessThresholdSeconds?: number | null; signal?: AbortSignal };
}
```

`CalendarEvent` is not accepted. Attendee **role** is deliberately absent: required/optional is
scheduling-layer metadata, and a person's busy time does not change with the role they were
invited under. The API is participant-plural from the first version so widening the participant
set later is not a breaking change.

## Output contract

```ts
interface ParticipantAvailability {
  participant: ParticipantRef;
  reliability: "known" | "partial" | "unknown" | "permission-denied" | "unsupported" | "error";
  source: "local-cache" | "remote-provider" | "none";
  busy: BusyInterval[];        // merged, clipped, normalized
  range: AvailabilityInterval;
  timeZone: string;
  observedAt: number;          // when it was computed
  dataAsOf: number | null;     // last confirmed provider sync behind these intervals
  diagnostics: AvailabilityDiagnostic[];
}

interface BusyInterval { start: number; end: number; busyType: "busy" | "tentative" }
```

`out-of-office` and `unavailable` busy types are deliberately **not** defined. No connected
provider reports them; adding the values would let the UI imply a distinction nothing can supply.
They belong to the ticket that first integrates a provider which actually returns them.

### Four different concepts, four different types

| Concept | Type | Example |
| --- | --- | --- |
| Event status | `CalendarEventData.status` | `confirmed`, `tentative`, `cancelled` |
| Attendance status | `CalendarAttendee.status` | `accepted`, `declined`, `delegated` |
| Availability state | `AvailabilityState` | `free`, `busy`, `tentative`, `unknown` |
| Availability reliability | `AvailabilityReliability` | `known`, `partial`, `unsupported` |

## Interval semantics

All intervals are **half-open `[start, end)`** Unix-second instants, matching the existing
Calendar range semantics. Nothing inside the Free/Busy core uses a host-local `Date` as a source
of truth; all-day and floating values are resolved through the CAL-102 IANA resolver.

Normalization rules (`mergeBusyIntervals`):

- zero-length and inverted intervals are dropped;
- overlapping intervals of the same type merge;
- where types overlap, severity **busy > tentative > free** wins — but only for the overlapping
  portion, so a busy hour inside a tentative block leaves tentative time on both sides;
- **adjacent** intervals (`a.end === b.start`) merge when the type matches and stay separate when
  it does not, so a busy hour followed by a tentative hour is never flattened into one block;
- everything is clipped to the requested range: an 08:00–15:00 event queried for 10:00–12:00
  contributes exactly 10:00–12:00.

`invertBusyIntervals(range, busy)` returns the complement inside the range. It is pure interval
arithmetic for a single participant; the caller must check `canReportFree` before presenting the
result as genuinely free. There is no group solver.

## Event → busy projection

`projectEventsToBusyIntervals(events, identity, context)` is pure and provider-neutral.

| Input | Result |
| --- | --- |
| `TRANSP:OPAQUE`, or no `TRANSP` (RFC 5545 default) | busy |
| `TRANSP:TRANSPARENT` | no interval |
| `STATUS:CANCELLED` | no interval |
| `STATUS:TENTATIVE` | `tentative` |
| Queried identity has `PARTSTAT:DECLINED` | no interval |
| Queried identity has `PARTSTAT:TENTATIVE` | `tentative` |
| Queried identity accepted / needs-action | busy |
| Unconfirmed local projection (CAL-104 `origin = 'local_projection'`) | `tentative` + diagnostic |
| Required vs optional attendee | identical busy semantics |

Recurrence is not re-implemented. Occurrences arrive already expanded and normalized by CAL-102/
CAL-103, so `RRULE`, `EXDATE`, `RDATE` and `RECURRENCE-ID` overrides behave exactly as they do in
calendar rendering; the test suite asserts this against the same expansion path the views use.

### All-day

An all-day event blocks whole **calendar dates in the effective zone**, resolved as
`[startDate 00:00, endDateExclusive 00:00)` via `zonedWallDateTimeToInstant`. It is never
converted through host-local midnight. The same event blocks a different instant span in each
zone, which is correct:

```text
all-day 2026-03-15, one day
  UTC                 -> 2026-03-15T00:00Z .. 2026-03-16T00:00Z
  Europe/Moscow       -> 2026-03-14T21:00Z .. 2026-03-15T21:00Z
  America/New_York    -> 2026-03-15T04:00Z .. 2026-03-16T04:00Z
  Australia/Lord_Howe -> 2026-03-14T13:00Z .. 2026-03-15T13:00Z
```

### Floating

Office360 stores no account or calendar timezone, so the effective zone for a floating value is
genuinely unknown. The projection resolves floating wall time against the **request** zone and
emits a `floating-timezone-assumed` diagnostic; the service then downgrades reliability to
`partial`. Floating time is therefore never silently treated as host-local truth. An unresolvable
TZID flagged by the CAL-103 codec downgrades reliability the same way.

## Multiple calendars

A participant's availability is the union of **every calendar the account owns**. UI visibility is
a display filter and is deliberately *not* treated as "exclude from Free/Busy" — hiding a calendar
must not silently delete real busy time from a scheduling answer. This is the one place where
Free/Busy intentionally diverges from `CalendarSyncService.loadRange`, which is visibility-scoped
because it feeds the views.

## Cache coverage semantics

The local adapter reads the CAL-104 coverage metadata, which is the same source of truth
`CalendarSyncService` writes:

| Coverage | Events | Reliability | Diagnostic |
| --- | --- | --- | --- |
| `complete`, fresh | any | `known` | — |
| `complete`, older than staleness threshold | any | `partial` | `stale-cache` |
| `partial` | any | `partial` | `partial-coverage` |
| `never-synced` | some (legacy cache) | `partial` | `never-synced` |
| `never-synced` | none | `unknown` | `never-synced` |
| no calendars | — | `unknown` | `no-calendars` |

Stale data is **returned, not discarded**: the intervals remain useful, only the trust drops. The
default staleness threshold is 15 minutes and is overridable per request; `null` disables it.

CAL-107 deliberately **does not trigger a sync**. A Scheduling Assistant changes range and
participants continuously, so refresh policy belongs to that ticket rather than to every
availability query. The adapter therefore reports what the cache honestly contains.

## Privacy boundary

A `ParticipantAvailability` carries no event metadata: no title, description, location, attendee
list, UID, remote id or raw ICS. A `BusyInterval` has exactly three fields — `start`, `end`,
`busyType` — so a future privacy-limited remote response of the form "13:00–14:00 busy" satisfies
the contract with nothing missing. This holds even for the local-derived path, where full event
data *is* available: the service must not become a second way to read event details. Opening an
event stays a separate Calendar lookup.

Diagnostics are a closed set of safe codes. Provider and storage failures are mapped to
`provider-error`; the raw cause never reaches a caller or the UI.

## Adapters and capabilities

`FreeBusyPort` is an **optional adapter**, not a method on `CalendarProvider`. Most providers have
no Free/Busy path, and forcing every provider to stub one out would hide that fact instead of
declaring it.

```ts
interface FreeBusyPort {
  readonly source: AvailabilitySource;
  canAnswer(participant: ParticipantRef): Promise<boolean> | boolean;
  queryAvailability(participants, request): Promise<ParticipantAvailability[]>;
}
```

`FreeBusyService` routes each identity to the first adapter that can answer for it and reports
everyone else as `unsupported`. CAL-107 shipped `LocalAccountFreeBusyAdapter` for the signed-in
account; CAL-110 adds the optional account/provider-scoped remote adapter described in
`CALENDAR_REMOTE_FREE_BUSY.md`.

The capability contract moved to `version: 3` and now separates the two questions, because one
value cannot express "I know my own availability but nobody else's":

```ts
freeBusy: {
  self: "none" | "local-derived" | "remote";
  others: "none" | "remote";
}
```

Google declares `{ self: "local-derived", others: "remote" }`. Generic CalDAV starts at `none`
and changes to `remote` only after RFC 6638 discovery. Yandex remains `none`; deriving another
person's availability from local events or from undocumented endpoints is still forbidden.

`permission-denied` is a distinct reliability value and must never be collapsed into `unsupported`
or into free time when a real remote adapter starts returning it.

## Cancellation

`options.signal` is honoured; an aborted request rejects with an `AbortError` rather than
resolving with a partial answer, so a superseded scheduling query cannot overwrite a newer one.

## Boundaries left for later tickets

**Working hours.** Not implemented. The architecture keeps them separable: "busy" and "outside
working hours" are different reasons to be unavailable, and a scheduler must be able to overlay
working intervals on top of an availability result without either concept contaminating the other.
Nothing in this model encodes a working-hours assumption.

**Scheduling Assistant.** `GroupAvailabilityRequest` / `GroupAvailability` define the future shape
— required participants, optional participants, availability per participant — and nothing else.
No scoring, ranking or slot recommendation exists, and none may be added to this layer.

## Known limitations

1. No account- or calendar-level timezone is stored, so all-day and floating values are resolved
   against the request zone. For all-day this matches how the calendar already renders; for
   floating it is an explicit assumption that downgrades reliability rather than a silent guess.
2. Remote participants require Google or discovery-confirmed generic CalDAV. Yandex and CalDAV
   servers without an RFC 6638 scheduling outbox remain `unsupported`.
3. Availability is computed from the cache without triggering a sync, so a range that has never
   been opened in the UI reads as `unknown` until something syncs it.
4. Coverage is evaluated per requested range against CAL-104 records; CAL-104 does not merge
   adjacent coverage intervals, so a range assembled from two separately synced halves can read
   `partial` even though both halves are complete.
5. `out-of-office` and `unavailable` busy types do not exist yet, by design.
