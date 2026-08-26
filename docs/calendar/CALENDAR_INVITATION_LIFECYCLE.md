# Calendar invitation lifecycle

Status: CAL-122 provider/mail-neutral contract.

## Boundary

The invitation lifecycle coordinates the existing Calendar event model, normalized participant model, iCalendar codec and Mail outbox. It does not introduce a second event model or a second SMTP queue.

`CalendarInvitationMessage` is the normalized action envelope. It carries direction, METHOD, UID, recurrence identity, SEQUENCE, DTSTAMP, one participant key and a source fingerprint. It deliberately excludes raw ICS, event title/body/location, participant details, credentials and headers. Raw ICS remains in the existing invitation/event storage where required for codec round-trip.

Supported methods are `REQUEST`, `REPLY` and `CANCEL`. `action_key` is a deterministic durable idempotency identity. Outbound delivery is per recipient: `participant_key` makes update/cancel/reply state independent for every recipient.

## Inbound pipeline

Gmail delta/full message storage and IMAP message storage call the same ingestion boundary immediately after the message is persisted. Calendar MIME attachments are fetched through the existing provider attachment path. ThreadView may rediscover the payload, but the ledger makes that call idempotent; opening a thread is no longer required.

The pipeline is:

```text
stored Mail message / text-calendar attachment
  -> ical.js codec
  -> sender/organizer/current-account validation
  -> account-serialized UID/SEQUENCE reconciliation
  -> invitation projection or organizer-owned event mutation
  -> calendar_itip_actions ledger
```

Malformed payloads and attachment failures are isolated from Mail sync. REQUEST and CANCEL are trusted only when the Mail sender matches ORGANIZER and the current account is an attendee. REPLY is trusted only when the current account is ORGANIZER and the sender matches the single replying attendee. A mismatch is recorded as `suspicious` and does not mutate Calendar state.

Reconciliation uses UID + RECURRENCE-ID + SEQUENCE, then DTSTAMP. A lower sequence is stale. The same durable action is duplicate. At the same sequence a later DTSTAMP may advance state; otherwise it is ignored. Inbound work is serialized per account so parallel Mail sync cannot apply an older REQUEST after a newer one.

REQUEST updates the existing invitation/projection identity. REPLY changes only the matching attendee PARTSTAT on the organizer-owned event. Unknown UID/attendee is diagnostic-only. CANCEL marks the series or the addressed occurrence cancelled; a remote occurrence mutation requires canonical series/occurrence identity and never falls back to mutating the whole series.

## RSVP

Mail invite cards and Calendar event details both enter the iTIP lifecycle service.

- Mail RSVP updates local invitation/participant state and queues a METHOD:REPLY message to ORGANIZER.
- Provider-backed Calendar RSVP uses the provider's direct response path, updates the cached attendee PARTSTAT, and records the provider-confirmed delivery as delivered.

Attendance state and delivery state are different fields. `queued` is not `delivered`. SMTP success advances the ledger and invitation queue state to delivered; retryable failures become `retry_scheduled`; permanent/auth failures become failed/blocked without pretending delivery succeeded.

## Outbound meeting lifecycle

Successful Calendar create/update/delete mutations run a post-write delivery hook:

- create with attendees: METHOD:REQUEST per recipient;
- update: same UID, provider-returned incremented SEQUENCE, REQUEST to current recipients;
- attendee removal: CANCEL only to removed recipients;
- series deletion: CANCEL with the same UID and incremented SEQUENCE;
- single-occurrence update/cancel: canonical RECURRENCE-ID, including TZID for timed-zoned identity.

Internal inbound reconciliation sets `suppressInvitationDelivery`; therefore an inbound REPLY cannot cause an outbound REQUEST loop. If the Calendar provider write succeeds but Mail queueing fails, the mutation result is `partial` and does not report a clean end-to-end success.

The generated ICS preserves organizer/SENT-BY, required/optional ROLE, PARTSTAT, recurrence rules and the provider reminder metadata permitted by the Calendar codec. Outbound REQUEST/CANCEL is authorized only when the current account is the organizer or the explicit SENT-BY delegate; only a just-created event may infer a missing ORGANIZER from that account. Desktop reminder delivery history, snooze and dismiss state are never serialized.

## Delivery and persistence

Migration v39 creates `calendar_itip_actions` and four indexes only. There is no backfill and no modification of existing Mail, invitation or Calendar rows. Ledger rows are created lazily during normal inbound ingestion or outbound delivery.

Outbound MIME uses the existing `sendMessage` pending operation and existing Gmail/SMTP execution path. The pending operation is deterministically keyed by the action. A terminal failed/blocked operation can be explicitly re-queued without creating another logical action. Normal bounded Mail retry policy remains authoritative.

## Privacy and limitations

The ledger contains identities and state required for reconciliation, not event content. Free/Busy continues to consume `ParticipantRef[]` and never reads invitation/event detail through this lifecycle.

Provider-native RFC 6638 scheduling is not claimed. Google direct RSVP may deliver through its provider API; email iTIP covers the application-level outbound lifecycle. No real mail, RSVP, event cancellation or cloud event write is required for acceptance. `this-and-future` remains unsupported.
