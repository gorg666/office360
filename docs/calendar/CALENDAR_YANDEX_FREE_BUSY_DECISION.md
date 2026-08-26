# CAL-123 — Yandex remote Free/Busy decision

Дата: 2026-08-23 (Asia/Bangkok)

Decision: **REMOTE_SUPPORTED**.

Office360 may use its existing RFC 6638 adapter for Yandex only when live DAV discovery exposes the complete scheduling contract. There is no Yandex-name hardcode: the same gate applies to generic CalDAV.

## Supported contract

The public standards path is CalDAV Scheduling [RFC 6638](https://www.rfc-editor.org/rfc/rfc6638.html). Yandex officially documents CalDAV connectivity for [desktop clients](https://yandex.ru/support/yandex-360/customers/calendar/web/ru/data-exchange/synchronization/sync-desktop) and for [Yandex 360 service applications](https://yandex.ru/support/yandex-360/business/admin/ru/security-service-applications). The Yandex help pages do not separately document a Free/Busy REST API; Office360 does not infer support from the web UI. Support is established by RFC-defined DAV properties and the `calendar-auto-schedule` DAV token returned by the authenticated CalDAV endpoint itself.

The runtime gate requires all of:

- current principal;
- `calendar-user-address-set`;
- `schedule-inbox-URL`;
- `schedule-outbox-URL`;
- a successful principal `OPTIONS` response advertising `calendar-auto-schedule`.

Missing properties are `unsupported`. HTTP 401 is `auth-required`; HTTP 403 is `permission-denied`; transport/malformed failures stay errors. No incomplete result enables remote capability.

## Sanitized runtime evidence

Read-only discovery was run through the existing Office360 Yandex OAuth/session lifecycle against two local development accounts:

| Account classification | Result |
| --- | --- |
| personal Yandex domain | `supported` |
| custom domain (organization status intentionally not inferred) | `supported` |

No account ID, email, URL, token, credential, Authorization header or raw DAV XML was retained in diagnostics.

| Resource / fact | Personal | Custom domain |
| --- | --- | --- |
| server root | `ok` | `ok` |
| principal | `ok` | `ok` |
| calendar home | `ok` | `ok` |
| calendar collection | `ok` | `ok` |
| scheduling inbox | `ok` | `ok` |
| scheduling outbox | `ok` | `ok` |
| `current-user-principal` | present | present |
| `principal-URL` | present | present |
| `calendar-home-set` | present | present |
| `calendar-user-address-set` | present | present |
| `schedule-inbox-URL` | present | present |
| `schedule-outbox-URL` | present | present |
| `calendar-auto-schedule` | present | present |
| `calendar-query` | advertised | advertised |
| `calendar-multiget` | advertised | advertised |
| `free-busy-query` on collection | not advertised | not advertised |
| `PROPFIND` / `REPORT` methods | advertised/working | advertised/working |
| `read-free-busy` collection privilege | not advertised | not advertised |

`free-busy-query` on a calendar collection is a different mechanism from remote participant scheduling. Its absence does not negate the complete RFC 6638 outbox contract. Conversely, collection report support alone would never enable remote participant queries.

No VFREEBUSY POST was sent during live acceptance. Even a self-target scheduling POST can have provider-side scheduling effects. Request/response behavior, privacy projection and per-recipient error mapping remain covered by deterministic RFC fixtures.

## Account scope

Discovery produced the same complete scheduling contract for a personal-domain account and a custom-domain account. Office360 therefore does not impose a guessed personal/business or same-organization rule. Eligibility and privacy can still vary per recipient; the server schedule response is authoritative and maps unavailable recipients to `permission-denied` or `error`, never free.

## Product behavior and privacy

- `freeBusy.self = local-derived` remains unchanged.
- `freeBusy.others` starts as `none` and becomes `remote` only after successful RFC 6638 discovery.
- Unsupported required participants keep candidate slots `unknown`, never confirmed/free.
- Unsupported optional participants do not block a required slot, but remain visibly unknown.
- UI copy distinguishes provider limitation from an error: `Занятость недоступна через подключённый календарь`.
- Remote results contain only participant identity, reliability and busy geometry (`start`, `end`, `busyType`). Titles, descriptions, locations, attendees, UIDs and raw ICS never cross the adapter boundary.

## Explicit exclusions

No web scraping, browser cookies, private frontend RPC, reverse-engineered API, headless web login, cloud event write, RSVP, invitation send, ACL mutation, migration or production change was used.

Final waiver: **not required**. The former parity P0 is closed by a standards-discovered provider contract, not by a private Yandex implementation.
