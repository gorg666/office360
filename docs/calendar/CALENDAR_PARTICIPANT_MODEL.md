# CAL-106 — Calendar participant model

Status: implemented on `feat/calendar-yandex360`, 2026-08-22. Automated verification complete; live Month/Week/Day runtime smoke PASS (`CALENDAR_RUNTIME_BASELINE.md`).

## Domain boundary

Calendar uses one provider-neutral participant contract in `src/services/calendar/domain/participant.ts`:

- `ParticipantRef` owns identity, independently of a particular invitation;
- `CalendarOrganizer` is separate from `CalendarAttendee[]` and may carry `SENT-BY`;
- `CalendarAttendee` owns attendance role, response status, independent RSVP request flag, participant type, delegation and provider extension values;
- roles are `required`, `optional`, `chair`, `non-participant`, `unknown`;
- statuses are `needs-action`, `accepted`, `tentative`, `declined`, `delegated`, `unknown`;
- participant types are `individual`, `group`, `room`, `resource`, `unknown`.

`RSVP=TRUE/FALSE` is not inferred from `PARTSTAT`. Organizer order and attendee order never define identity.

## Identity and duplicate merge

Identity priority is stable account ID, provider ID, normalized email, then normalized URI. Display name is presentation only. Email normalization trims input, removes `MAILTO:`, follows the existing Office360 case-insensitive comparison convention, and normalizes internationalized domains. It deliberately does not strip plus aliases or Gmail dots.

Duplicate attendees are merged in first-seen order. A non-empty display name enriches an empty one; explicit non-default role/status/type enrich defaults or unknown values; delegation lists are identity-deduplicated; maximum `additionalGuests` is retained. Different normalized emails are never merged merely because display names match.

Current-user and organizer relations are computed from account/provider/email identity. Ambiguous input returns no match.

## Persistence and legacy compatibility

No migration is required. `calendar_events.attendees_json` and `calendar_invitations.attendees_json` now accept a versioned event-scoped participant envelope containing organizer plus attendees. Existing JSON arrays remain readable through `parseCalendarParticipants`; `organizer_email` remains a compatibility projection. Provider refreshes and ordinary writes persist the canonical envelope lazily. There is no startup backfill, row rewrite, reset, or new table.

The Month/Week/Day load remains one range query returning all event participant payloads. Participant normalization is in-process per row, so there is no request-per-attendee or N+1 query.

## Provider mapping

CalDAV/iCalendar maps `ORGANIZER`, `ATTENDEE`, `CN`, `ROLE`, `PARTSTAT`, `CUTYPE`, `RSVP`, `SENT-BY`, `DELEGATED-TO`, and `DELEGATED-FROM` through the CAL-103 codec. Create and explicit attendee updates serialize the same contract; unrelated updates preserve existing attendee properties.

Google maps `email`, `displayName`, `organizer`, `self`, `optional`, `responseStatus`, `resource`, and `additionalGuests`. Google has one resource boolean rather than distinct RFC room/resource values, so inbound Google resources normalize as `resource`; a domain `room` is written as Google `resource` and cannot round-trip its narrower type through that API.

Calendar RSVP and Mail invitation projection both use the normalized attendee set when a current attendee identity is available. CAL-122 uses that same attendee set for REPLY reconciliation and outbound REQUEST/CANCEL generation. Delivery/queue state remains separate from attendance status.

## UI and Mail

Calendar event details render the normalized organizer and attendees, show optional/chair/informational roles, and locate the current attendee through identity helpers. Mail invitation ingestion uses the same codec/domain projection. Required/optional ROLE, PARTSTAT, participant identity and organizer/SENT-BY now survive the application iTIP delivery path described in `CALENDAR_INVITATION_LIFECYCLE.md`.

## Future Free/Busy boundary

Free/Busy is not implemented by CAL-106. Its future request contract must accept:

```ts
participants: ParticipantRef[]
```

It must not require `CalendarAttendee[]` or a full `CalendarEvent`, because availability belongs to identity and must not disclose event details.

## Known limitations

1. There is no organization directory or participant picker; stable account/provider IDs are used only when a provider supplies them.
2. Google cannot preserve the RFC distinction between `room` and generic `resource`.
3. Provider-native RFC 6638 scheduling, Free/Busy mutation and room booking remain outside this model; application email iTIP delivery is owned by CAL-122.
4. Live Week/Day smoke (2026-08-22) confirmed rendering and event details for an existing Yandex event with organizer and attendees; the opened fixture did not show the optional-role chip text. Optional role remains confirmed by Month smoke and `EventDetailModal.test.tsx`. No cloud mutations were performed.
