# CAL-104 — Calendar sync and cache model

Status: implemented on `feat/calendar-yandex360`, 2026-08-22.

## Ownership and source of truth

Calendar data has three explicit roles:

- **Remote** is the provider-side resource returned by Google Calendar or CalDAV. Provider resource identity is `remoteEventId`; series UID and CAL-102 `occurrenceKey` remain separate identities.
- **Cache** is the last normalized local copy of a remote resource. New cache writes use `calendar_events.origin = 'remote'` and always belong to an account and DB calendar.
- **Local projection** is temporary UI-visible state that is not confirmed by the provider. RSVP projections use `origin = 'local_projection'`, a stable `projection_key`, and `projection_status = 'pending'`. `calendar_id IS NULL` is no longer sufficient to classify a row.

Existing pre-v35 rows are not rewritten. A legacy `invite:<uid>:<recurrence>` row is recognized lazily as a projection; other legacy rows are treated as remote cache. Repeated projection writes use the same account-scoped key and cannot create unbounded duplicates.

## Range semantics

CAL-104 uses one bounded range for the current load:

```text
visible range = remote query range = cache reconciliation range
```

There is no hidden prefetch range yet. Month includes its displayed leading/trailing weeks; Week and Day use their displayed local-day boundaries. A future prefetch policy must introduce a separately named range rather than silently widening reconciliation.

`calendar_sync_coverage` stores account, calendar, Unix-second range, state, attempt/success timestamps, and safe parser counters. Absence means `never-synced`; a row can be `partial` or `complete`. The requested range is usable only when every visible calendar has a complete covering interval. Consequently, zero cached events plus complete coverage means **synced-empty**, while zero events without coverage means **never-synced**.

Pre-v35 non-empty cache remains usable during lazy transition. Empty legacy cache is never guessed complete.

## Load and reconciliation

The production boundary is:

```text
CalendarPage
  -> CalendarSyncService.loadRange(account, range)
     -> provider discovery and bounded fetch
     -> calendar cache repositories
     -> projection reconciliation
     -> coverage and diagnostics
```

`CalendarPage` owns presentation state only. `fetchEvents` means a complete bounded snapshot when it resolves successfully and diagnostics are clean. `syncEvents` remains the provider delta/background contract; CAL-104 does not force it into the visible-range path.

For an authoritative snapshot the repository:

1. upserts every returned normalized event;
2. removes matching local projections;
3. removes overlapping remote cache rows whose provider identity is absent;
4. records complete coverage last.

For a degraded response, valid events are upserted and matching projections may reconcile, but missing cached events are retained and coverage is recorded as partial. Parser warnings therefore never trigger destructive reconciliation.

Google bounded fetch follows every `nextPageToken`; any page failure rejects the entire fetch, so partial pages cannot be marked authoritative. CAL-129 adds durable provider delta ownership: Google and discovery-confirmed RFC 6578 CalDAV/Yandex cursors are stored in `calendars.sync_token`, provider tombstones converge the cache, and cursor commit happens only after the complete batch applies. CalDAV servers without `sync-collection` retain bounded `calendar-query` refresh.

## Failure safety and atomicity

The Tauri SQL plugin uses a connection pool, so the existing `withTransaction` helper is a serialized write queue rather than a manual `BEGIN/COMMIT` transaction. CAL-104 uses the safest available ordering:

- all upserts complete before one set-based missing-row deletion;
- coverage is written only after reconciliation completes;
- degraded responses never run the deletion statement;
- a mid-upsert failure retains old rows and leaves coverage unsuccessful;
- a coverage-write failure may leave a correct newer cache with older metadata, but never marks a half-applied cache successful.

No destructive migration or startup backfill is used.

## RSVP projection lifecycle

Accepted/tentative Mail invitations create or update one pending projection. A matching remote UID/start replaces it during reconciliation. The currently unsupported outbound RSVP queue path removes the optimistic projection before marking the invitation operation blocked, so an unconfirmed event does not remain indefinitely. Declined invitations do not create projections.

## Races and offline behavior

Each `CalendarPage` load receives a monotonically increasing generation. Cache callbacks and final results update presentation state only when their generation is still current. A late Month response cannot replace a newer Week response, and a late account-A response cannot replace account B. It may still safely finish updating account A's scoped DB cache.

On provider failure:

- complete coverage, including an empty range, yields `stale`;
- a non-empty legacy cache also yields `stale` during transition;
- no usable cache/coverage yields `error`;
- provider error text is classified to safe categories and is not rendered directly.

## Legacy normalization

Rows without semantic v34 fields are normalized through the CAL-103 codec. A bounded in-process cache keyed by row ID, `updated_at`, and raw ICS avoids reparsing the same legacy row on every read. The next successful remote upsert persists semantic columns naturally; there is no mass backfill or read-side DB write.

## Known limitations and follow-ups

1. Coverage intervals are compact exact/covering records; CAL-104 does not merge adjacent intervals or implement a general offline interval database.
2. The SQLite/Tauri pool does not expose a safely pinned multi-statement transaction; delta crash safety is idempotent replay with cursor-last ordering.
3. Generic CalDAV without advertised RFC 6578 support cannot observe tombstones outside an authoritative bounded refresh.
4. True multi-statement SQLite transactions need a DB access path that guarantees one pooled connection; current fallback semantics are deliberately non-destructive.
