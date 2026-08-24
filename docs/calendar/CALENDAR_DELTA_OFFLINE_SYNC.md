# Calendar durable delta and offline policy

Date: 2026-08-24 (Asia/Bangkok)
Ticket: CAL-129
Migration: NONE

## Ownership

`CalendarSyncCoordinator` is the only owner of provider calendar discovery, delta cursor consumption and range refresh. Background polling, startup/reconnect, manual refresh and `CalendarSyncService.loadRange` all enter that coordinator. Delta work is single-flight per account; equal visible-range refreshes are single-flight per account/range. No two independent consumers can advance the same calendar cursor concurrently.

`CalendarSyncService` remains the cache-first UI boundary. It publishes cached rows immediately, asks the coordinator for a remote refresh, then reloads cache/coverage. `gmail/syncManager` no longer contains a second calendar discovery/apply loop.

## Durable state and commit rule

Existing `calendars.sync_token` and `calendars.ctag` store opaque provider cursors. v35 `calendar_sync_coverage` remains the source for visible-range completeness, attempt/success timestamps and parser degradation. No v40 schema is needed.

`applyCalendarSyncBatch` runs under the process-wide SQLite write lock in this order:

1. idempotent event upserts;
2. projection reconciliation;
3. provider tombstones / authoritative-snapshot cleanup;
4. cursor update last.

The Tauri SQL pool cannot provide a reliable multi-statement JS transaction on one pinned connection, so the crash contract is replay safety rather than rollback: failure before step 4 leaves the old cursor and the same provider batch is replayed. A cursor is never advanced past an unapplied change set.

## Google

- Initial sync is an unfiltered event-collection snapshot and persists `nextSyncToken` from the final page.
- Incremental requests reuse the same cursor and follow every `nextPageToken`; cancelled resources become tombstones.
- HTTP 410 / explicit invalid-token response returns `cursorInvalidated`.
- The coordinator clears only the durable cursor, performs one controlled initial snapshot, converges the cache, then commits the replacement cursor.
- A second invalidation in the same recovery is a failure, not an infinite loop.

## CalDAV and Yandex

The shared CalDAV adapter asks the server for `supported-report-set`. When `sync-collection` is advertised it uses RFC 6578 with an opaque `DAV:sync-token`, `sync-level=1`, ETag and calendar-data properties. Changed hrefs without inline calendar data are retrieved through calendar multiget. A resource-level 404 is a deletion; non-delete failed responses and malformed objects are isolated, valid resources remain usable, and the cursor is not advanced.

If RFC 6578 is not advertised, the adapter uses the existing controlled bounded `calendar-query` path. A complete response is authoritative only inside its reported coverage window, so in-range deletions converge without treating it as a full-collection snapshot; malformed/partial responses retain missing rows. The fallback does not invent a cursor. Yandex follows this exact standards-based branch; there is no provider-name or private-API bypass.

## Offline policy

Offline reads are supported from the canonical cache. Calendar views label cached state as stale/offline, CAL-127 search remains local, and CAL-121 reminder reconciliation/delivery continues from cached event/reminder rows.

Offline Calendar writes are intentionally unsupported:

- create, update and delete return typed `status: offline` before provider I/O;
- direct provider RSVP returns the same typed result;
- ACL grant/update/revoke throws typed `CalendarAclError(code=offline)`;
- no event or ACL operation is silently inserted into the Mail pending-operation queue.

The existing queue is retained only for its established Mail/iTIP delivery contract. Reconnect triggers normal coordinator sync. Provider-newer/stale-ETag races remain deterministic: HTTP 409/412 maps to `conflict`; remote deletion becomes `calendar-unavailable` after refresh. There is no silent last-write-wins behavior.

## Privacy and diagnostics

Diagnostics log event/reason and existing redacted account/calendar identifiers only. Cursor/token values, credentials, event payloads and participant details are never logged.

## Known limitations

- No OS background Calendar sync while the desktop process is fully terminated.
- RFC 6578 result truncation (`507 number-of-matches-within-limits`) is treated as incomplete and retried from the old cursor; no continuation extension is assumed.
- The bounded CalDAV fallback cannot observe out-of-range tombstones until an authoritative covered range is refreshed.
