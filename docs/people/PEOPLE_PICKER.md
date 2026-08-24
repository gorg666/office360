# Office360 People Directory and Picker

## Status

PEOPLE-001 establishes one provider-neutral identity search and selection path for Mail recipients, Calendar attendees and Calendar ACL principals. It does not create an organization directory database, contacts sync or a second provider-specific UI model.

## Domain contract

`PersonIdentity` is the presentation/search boundary. It contains a canonical email identity plus optional provider ID, display name, first/last name, job title, organization, department and avatar URL. `source` and `sources` record whether the result came from the organization directory, contacts, recent recipients, Calendar history or valid manual entry.

The downstream write contracts remain intentionally narrow:

- Mail passes only selected email addresses into the existing SMTP composer state;
- Calendar converts the identity into the existing `ParticipantRef`/`CalendarAttendee` model and preserves Required/Optional role separately;
- Calendar ACL passes the selected email principal to `CalendarAclService`.

Provider payloads and directory credentials never enter those write models.

## Identity and merge policy

Email normalization uses the existing Office360 `normalizeEmail` convention after trimming and removing a leading `MAILTO:`. It is comparison-only: the display-form address is retained. No Gmail-dot, plus-address or provider-alias rewriting occurs.

Results deduplicate by normalized email. A duplicate is merged deterministically:

1. organization directory presentation;
2. contact presentation;
3. recent recipient usage;
4. Calendar participant history;
5. manual email.

Richer non-empty name, job, organization, department and avatar fields survive the merge. Same display name with different emails remains two identities.

## Search and ranking

`PeopleSearchService` searches local and supported provider sources concurrently, then merges and ranks them. Matching is Unicode-normalized and case-insensitive for email, first name, last name, full name (both orders), display name, job title, organization and department. Exact email/name matches rank above prefixes, substrings and recent-use boosts.

Local fallback is read from existing contacts and a bounded, account-scoped Calendar attendee history query. The load path is batched: one contacts query plus one Calendar-history query, not a query per event or attendee. A syntactically valid manual email is always selectable. Invalid arbitrary text is not converted into an identity.

## Yandex 360 directory

The Yandex adapter uses only the official read-only Directory API:

- `GET https://api360.yandex.net/directory/v1/org`;
- `GET https://api360.yandex.net/directory/v1/org/{orgId}/users`;
- optional department lookup for presentation.

Live organization search is advertised only when the current Yandex admin grant includes `directory:read_organization` and `directory:read_users`. Missing/denied permission is an explicit `permission-denied` capability; it does not break local/manual search. Department presentation is best-effort when `directory:read_departments` is unavailable. Organization, user and department pagination is bounded, and normalized directory results use a two-minute in-memory cache with single-flight loading. Nothing is persisted and no private API or scraping is used.

## Picker behavior

`PeoplePicker` is the shared accessible combobox. It provides:

- 200 ms debounced search after focus/input;
- rich name/email/job/department rows;
- mouse and Arrow Up/Down, Enter, Tab, comma, Escape and Backspace behavior;
- multi-select chips or single-select mode;
- valid manual email entry;
- loading, empty and directory-fallback states;
- `combobox`, `listbox`, `option`, expanded-state and active-descendant semantics.

Mail To/Cc/Bcc use multi-select chips. Calendar participant chips preserve display name and keep Required/Optional as the Calendar authoring role. ACL uses single-select and retains all CAL-119/CAL-128 capability and owner protections.

## Privacy, persistence and limitations

No schema change or migration is required. Search does not log names, email queries, provider responses, OAuth tokens or credentials. Directory data is short-lived in process memory only. Existing contacts and Calendar cache remain the sole local fallback sources.

This ticket does not implement contacts synchronization, room booking, free/busy, directory administration, provider writes or organization-wide offline directory storage. Accounts without the required Yandex admin grant continue with local/manual selection.
