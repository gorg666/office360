# Calendar reminder delivery runtime

CAL-121 turns the provider-neutral reminder metadata from CAL-118 into local desktop delivery. It does not change Google, CalDAV, or Yandex event reminder metadata.

## Contracts

`CalendarReminder` remains an event-level definition. `ReminderOccurrence` is one concrete firing for one event occurrence and one reminder definition. `ReminderDelivery` is the durable local lifecycle for that firing. `ReminderScheduler` performs bounded materialization, reconciliation and delivery.

The deterministic delivery identity includes account ID, calendar ID, provider event resource identity, canonical occurrence identity, canonical reminder identity and scheduled Unix instant. `delivery_key` is the primary-key dedupe boundary. The delivered transition is persisted before the OS notification side effect, so lease recovery cannot replay a toast. A crash inside that narrow boundary can miss a notification but preserves at-most-once delivery. `source_fingerprint` contains only non-sensitive identity/time/reminder state. A start, end, status, occurrence or reminder mutation changes the fingerprint and cancels obsolete pending delivery. Title-only edits do not reschedule.

## Durable state and lifecycle

Append-only migration v38 creates `calendar_reminder_deliveries`. It does not alter or backfill `calendar_events` or `reminders_json`.

Statuses are `scheduled`, `delivering`, `delivered`, `dismissed`, `snoozed`, `cancelled`, and `failed`. Claiming changes a due row from `scheduled` to `delivering` under the shared SQLite write lock and assigns a bounded lease. An expired lease is recoverable after restart. Successful OS submission marks the row `delivered`; permission or notification errors become a safe `failed` diagnostic.

Dismiss marks only the concrete delivered reminder handled. Snooze marks that delivery `snoozed` and inserts a linked scheduled child. Neither operation changes provider reminder metadata. Presets are 5, 10, 30 and 60 minutes.

## Scheduling policy

The rolling window is deterministic: previous 6 hours for catch-up and next 30 days for future materialization. The event source query extends the future edge by the CAL-118 maximum reminder lead time of 28 days.

Missed reminders inside the six-hour catch-up window are delivered at startup/resume. Older scheduled rows are cancelled without showing stale notifications. The runtime uses one timer for the next due row with a 15-minute clock/timezone-change safety recheck; it does not poll the event database every second. It also reconciles after Calendar sync, browser online/focus/visibility changes and explicit scheduler signals.

## Recurrence and time

The scheduler consumes cache rows already normalized by the CAL-102/CAL-103 recurrence and time pipeline. It does not expand RRULE itself. Canonical `occurrence_key` keeps weekly instances, EXDATE filtering, RECURRENCE-ID overrides and moved single occurrences distinct. Series and occurrence edits change source identity/time and cancel obsolete pending deliveries.

Timed-zoned, floating and all-day rows use their resolved semantic `start_time`. A row without a resolved semantic `time_kind` is skipped; the scheduler never interprets it in the host timezone. CAL-118 legacy CalDAV rows may lazily derive reminder and time semantics from cached iCalendar data. Google legacy reminder state remains unknown until ordinary refresh.

Only explicit `notification` reminders produce local desktop delivery. `email` remains provider delivery metadata. `inherit` remains the provider/calendar-default contract; Office360 does not invent a concrete local instant when the provider default alarm list is unavailable.

## Desktop behavior and permission

Delivery uses the existing Tauri notification plugin and Windows Office360 WinRT/AUMID implementation. The in-app reminder center provides deterministic Snooze, Dismiss and Open actions because native action buttons are not consistently supported across current desktop targets.

Permission is tracked as `unknown`, `granted`, `denied`, or locally `disabled`. Denial or an unavailable permission API does not crash Calendar. It records a non-sensitive failed delivery code and surfaces an in-app diagnostic.

Closing the main window leaves the Tauri process alive in the system tray, so timers continue. A fully terminated application has no OS background service and cannot deliver in real time. Startup catch-up covers recent missed reminders after the application starts again.

## Privacy

The delivery table never stores title, description, location, attendees or credentials. Notification copy is resolved immediately before delivery from the current cache row. When `canSeeEventDetails` is false, the serialized UI/toast payload is exactly generic (`Calendar reminder` / `Busy event`) and contains no private event fields.

## Reconciliation and provider safety

Normal Calendar sync emits a local reconcile signal after cache persistence. Missing, deleted, cancelled, moved or reminder-mutated sources cancel obsolete pending/failed claims in the active window. Delivered history remains. Identical startup, sync and rerender inputs use `INSERT OR IGNORE` on the deterministic delivery key.

Local delivery, snooze and dismiss perform no provider event write, invitation delivery or ACL mutation. Read-only events may deliver when their reminder metadata and details are legitimately readable.
