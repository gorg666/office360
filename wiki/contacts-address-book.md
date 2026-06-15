# Contacts and address book

Эта страница фиксирует текущее состояние Address Book после EPIC-13.

## Модель данных

- `contacts` остается compatibility aggregate для mail flows: primary email, display name, avatar, frequency, notes и sync metadata.
- `contact_identities` остается email index для autocomplete/sidebar/thread display compatibility.
- `contact_directories` хранит address books:
  - `Personal Address Book` для user-managed local contacts;
  - `Collected Addresses` для inferred contacts из mail activity;
  - CardDAV directories;
  - LDAP read-only directories.
- Rich fields хранятся отдельно:
  - `contact_methods` для repeated email/phone/url/impp;
  - `contact_addresses` для structured postal addresses;
  - `contact_special_dates` для birthday/anniversary/custom dates;
  - `contact_lists` и `contact_list_members` для mailing lists.
- Migration v31 backfills existing contacts into Personal/Collected directories and mirrors existing `contact_identities` into `contact_methods(kind='email')`.

## UI behavior

- Основной entry point: `/contacts`, sidebar item `Contacts`.
- Address Book UI использует трехпанельный desktop layout:
  - resizable directories/address books column with the primary `New contact` action and secondary address-book/import actions;
  - contact and mailing list results;
  - contact preview/details, inline contact editor, mailing-list editor, or import wizard.
- New/edit contact opens in the right details pane, not a modal. Dirty inline forms require confirmation before switching contacts, directories, lists, or import.
- Contact column widths persist in local storage under `contacts.columnWidths.v1`; double-clicking a resize handle resets defaults.
- Import opens a Thunderbird-like right-pane wizard. vCard import is functional with target address book selection; CSV/TSV, LDIF, SQLite and Mork are visible placeholders marked `Coming later`.
- Contact photo is edited inside the inline contact editor. Users can set a remote photo URL, upload a local image, or remove the photo; uploaded images are center-cropped to a square avatar and saved as managed local files under app data `contact-avatars/`, while `contacts.avatar_url` stores the resulting local path or remote URL.
- New local/CardDAV/LDAP address books are configured in a modal; directory setup fields are not shown inline in the navigation pane.
- Settings > People больше не является contact/address-book entry point; contacts are managed only from the sidebar `Contacts` route, while Settings keeps Subscriptions.
- Contact sidebar получил quick action `Open in Address Book`.

## Rich contact cards

Supported first EPIC-13 fields:

- display name, first name, last name, nickname;
- multiple typed emails with primary semantics;
- phones, websites, IMPP/chat handles;
- structured postal addresses;
- timezone, organization, title, role;
- notes, birthday, anniversary and custom dates.

`contacts.email` продолжает быть primary compatibility email. Сохранение rich contact обновляет и `contact_methods`, и `contact_identities`.

## vCard compatibility

Supported import/export fields:

- `UID`, `FN`, `N`, `NICKNAME`;
- multiple `EMAIL`, `TEL`, `URL`, `IMPP`;
- `ADR`, `TZ`, `NOTE`;
- `ORG`, `TITLE`, `ROLE`;
- `BDAY`, `ANNIVERSARY`.

Raw vCard сохраняется в `contacts.vcard_raw` when imported/synced. Unsupported vCard properties are not guaranteed to roundtrip yet.

## CardDAV

- CardDAV directories use existing `tsdav` with `defaultAccountType: "carddav"`.
- UI supports manual CardDAV URL, `.well-known/carddav` discovery, connection test, and sync.
- Sync fetches remote vCards, parses supported fields, stores ETags and remote URLs, and imports cards into the selected directory.
- Passwords are stored through encrypted settings and referenced from `contact_directories.auth_ref`.
- Current sync strategy is full-fetch/upsert. Conflict-safe writeback is prepared through ETag metadata, but destructive overwrite must stay guarded.

## LDAP

- LDAP directories are read-only in EPIC-13.
- UI stores host, port, security mode, base DN, filter, bind DN, and encrypted password reference.
- Desktop backend exposes `ldap_test_connection` and `ldap_search` through the Rust `ldap3` client.
- Search results are limited, mapped to display name/email/organization/title, and can be cached into the selected LDAP directory as read-only contacts.
- LDAP write operations are out of scope. Full LDAP query/result mapping should plug into the existing read-only directory shape without another migration.

## Mail interactions

- Composer autocomplete uses `searchRecipientSuggestions`, which returns contact suggestions and mailing lists.
- Inferred contacts continue to be created from mail activity through `upsertContact` and now land in `Collected Addresses`.
- Managed/local contacts continue to protect user-edited display names from inferred upserts.
- Contact sidebar stats, notes, same-domain contacts, attachments, and auth context remain local mail-derived.

## Privacy and security

- CardDAV/LDAP passwords, auth headers, tokens, raw MIME, raw message bodies, and full DB dumps must not be logged or exported.
- Managed contact avatar files are only removed from the app-owned `contact-avatars/` directory; remote photo URLs are never deleted by cleanup code.
- LDAP is opt-in and read-only.
- Remote directory lookup/sync runs only after the user configures a directory.
