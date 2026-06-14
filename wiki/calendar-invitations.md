# Calendar invitations

Статус: EPIC-08 first slice

## Что добавлено

Office360 распознает calendar invite payloads из писем и показывает их в mail thread как отдельную invite card.

Поддержано:

- `text/calendar` / raw `BEGIN:VCALENDAR` + `BEGIN:VEVENT` в body.
- `.ics` / `text/calendar` attachments, если attachment content можно получить через provider `fetchAttachment`.
- iCalendar fields: `METHOD`, `UID`, `SEQUENCE`, `RECURRENCE-ID`, `STATUS`, `DTSTART`, `DTEND`, `ORGANIZER`, `ATTENDEE`, `PARTSTAT`, `TZID`.
- Additive table `calendar_invitations` для message/thread context, raw iCalendar, RSVP state и queue status.
- Thread invite card с event title/time/organizer, cancellation/update state, timezone warning и Accept/Tentative/Decline.
- Local-first RSVP: user decision сохраняется сразу, accepted/tentative projection попадает в local calendar event store.
- `calendarRsvp` pending operation для future remote delivery.

## Границы первого slice

Remote provider RSVP delivery пока не реализован. Queue processor обрабатывает `calendarRsvp` отдельно от mail actions и переводит операцию в blocked state с `unsupported_capability`, чтобы не имитировать успешный sync.

Это намеренно:

- local decision не теряется;
- UI показывает queued/blocked state;
- existing email queue actions не получают неизвестный operation type;
- future Google/CalDAV/iMIP adapters смогут использовать уже сохраненный payload.

## Data model

`calendar_invitations` key:

- `account_id`
- `event_uid`
- `recurrence_key`

`SEQUENCE` защищает от перезаписи более нового приглашения старым update. `RECURRENCE-ID` хранится отдельно, чтобы recurring instance update не смешивался с master event.

## Smoke checklist

- Открыть thread с raw iCalendar body и увидеть invite card.
- Проверить cancellation payload: card показывает `Cancelled`, RSVP buttons скрыты.
- Проверить timezone payload с `TZID`: card показывает timezone warning.
- Нажать Accept/Tentative/Decline: RSVP state меняется, появляется queued/delivery status.
- Убедиться, что обычные mail queue actions продолжают исполняться через `emailActions`, а `calendarRsvp` идет через calendar executor.
