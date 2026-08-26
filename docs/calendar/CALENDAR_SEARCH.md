# Calendar event search

Дата: 2026-08-24. Ticket: CAL-127.

## Contract

`CalendarSearchService` is the provider-neutral boundary for event search. `CalendarSearchRequest` contains the stable account identity, a text query, optional local calendar IDs, an optional half-open date range and a bounded limit. `CalendarSearchResult` is a privacy-safe projection: event/resource/series/occurrence identity, calendar identity/name, title, location, time, all-day flag and matched semantic fields. It never contains raw iCalendar, description bodies, attendee envelopes, credentials or provider URLs.

Search is local-cache-first. Provider data reaches the same `calendar_events` projection through the existing Google and CalDAV/Yandex sync paths, so the search service has no provider-specific branch and performs no network request.

## Fields and matching

The local query matches:

- `summary` (title);
- `description`;
- `location`;
- organizer identity;
- participant identity/display name/email/URI from canonical v1 or legacy attendee JSON.

Participant matching uses SQLite `json_tree` over valid JSON and an explicit semantic-key allowlist. It does not use a regular expression over serialized JSON and does not parse all cached events in JavaScript. `%`, `_` and `\` in user input are escaped as literal LIKE characters. Because SQLite core `lower()` is ASCII-only, the query supplies deterministic original/lower/upper/title-case Unicode variants; this covers normal RU/EN casing without moving the scan into JavaScript.

The query is a single account- and calendar-scoped SQL statement with a hard maximum of 100 results (UI default 30). It selects only safe result columns and never selects `ical_data`, `attendees_json` or `description`. A two-character UI/service minimum prevents broad one-character scans. The current implementation uses the existing cache indexes and bounded result set; an FTS schema is intentionally deferred until corpus measurements justify a separately approved migration.

## Scope, filters and privacy

- Account scope is mandatory.
- Calendar filter accepts stable local calendar IDs only after intersecting them with calendars belonging to the account.
- Search includes visible and hidden calendars when event details are readable. UI visibility is not an access boundary.
- `provider_presence='removed'` calendars and `STATUS:CANCELLED` events are excluded.
- `free-busy-only` calendars are removed before the DB query and again before resolving a result into `EventDetailModal`.
- Detail resolution repeats account, readable-calendar, provider-presence and cancellation checks. A stale result therefore cannot bypass a permission refresh.
- The UI offers `all cached dates` and the current Month/Week/Day range. “All” means all locally cached provider data, not an unbounded remote-provider search.

## Recurrence result policy

Search returns at most one row per canonical series identity (`series_uid`, falling back to resource identity). The representative is deterministic:

1. nearest occurrence at or after the request's `now`;
2. otherwise the most recent past occurrence;
3. stable event ID tie-break.

The result preserves `seriesUid` and `occurrenceKey`, and opening it resolves that exact cache row through the existing event-detail path. Search does not expand recurrence and does not create a second occurrence model.

## UI and accessibility

The Calendar toolbar owns a compact search field. Input is debounced for 220 ms. The overlay has explicit short-query, loading, empty, error and result states; calendar/date filters; and result context (date/time, calendar, location and matched fields). `ArrowUp`/`ArrowDown` move selection, `Enter` opens the selected result in the existing `EventDetailModal`, and `Escape` clears/closes search. Mouse hover/click shares the same selected-result path.

## Migration and known limits

Migration: **NONE**. Existing `calendar_events`, attendee envelopes, access metadata and presence metadata are sufficient. No backfill or runtime DB rewrite is performed.

Search is limited to data already present in the local cache. SQLite's built-in text comparison is used; no provider-specific aliasing, stemming, transliteration or fuzzy ranking is attempted. Adding FTS, remote search or advanced linguistic normalization requires a separate scope and migration gate.
