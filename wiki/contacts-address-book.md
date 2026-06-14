# Contacts and address book

Эта страница фиксирует текущее состояние address book foundation после EPIC-07.

## Модель данных

- `contacts` остается compatibility aggregate и сохраняет старые поля: `email`, `display_name`, `avatar_url`, `frequency`, `last_contacted_at`, `notes`.
- `contacts.email` теперь трактуется как primary email identity, чтобы старые call sites продолжали работать.
- `contact_identities` хранит все email identities контакта:
  - `contact_id`;
  - normalized `email`;
  - optional label/display name;
  - `is_primary`.
- Migration v29 backfills one primary identity for each existing contact row.

## Managed vs inferred

- Inferred contacts продолжают появляться из mail activity через `upsertContact`.
- Managed contacts помечаются `contact_type = 'managed'` и `user_edited = 1`.
- Inferred upsert может обновить frequency и `last_contacted_at`, но не должен перетирать user-edited display name.
- Notes, avatars, same-domain contacts, attachments, recent conversations и auth context остаются частью текущего sidebar workflow.

## vCard compatibility

First slice поддерживает core fields:

- `UID`
- `FN`
- `EMAIL`
- `NOTE`
- `ORG`
- `TITLE`

Raw vCard сохраняется в `contacts.vcard_raw` как compatibility metadata. Live CardDAV/provider sync пока вне scope.

## UI behavior

- Composer autocomplete ищет по `contacts.email`, `contacts.display_name`, `contact_identities.email` и identity display name.
- Suggestions ранжируются по identity match, managed contact, primary identity и frequency.
- Settings > People > Contacts редактирует display name и comma-separated identities.
- Contact sidebar показывает дополнительные identities для managed contact, но не меняет существующие contextual panels.

## Future work

- Выбрать первый sync target: CardDAV, Google People API, Microsoft Graph contacts или Yandex 360 contacts.
- Добавить полноценный address book route, если Settings editor станет слишком плотным.
- Решить, должны ли sidebar stats агрегироваться по всем identities контакта или только по открытому sender email.
