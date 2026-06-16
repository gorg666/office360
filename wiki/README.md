# Office360 Wiki

Эта wiki - living project memory для Office360.

Обновляй её, когда изменение затрагивает system behavior, architecture, provider rules, user-visible workflows, deployment или smoke checks.

## Страницы

- [Обзор системы](system-overview.md) - текущая архитектура и границы продукта.
- [Provider Capabilities](provider-capabilities.md) - provider model, Gmail/Yandex/IMAP capability decisions и UI gating.
- [Microsoft 365 / Exchange Status](microsoft-365-exchange-status.md) - Graph-first decision, IMAP/SMTP compatibility path и unsupported enterprise boundaries.
- [Account Diagnostics](account-diagnostics.md) - ConnectionDiagnostic, Repair Center и privacy-safe support bundle.
- [Contacts and address book](contacts-address-book.md) - full Address Book, directories, rich vCard contacts, mailing lists, CardDAV и LDAP boundaries.
- [Calendar invitations](calendar-invitations.md) - invite detection, thread invite card, local-first RSVP и границы remote delivery.
- [Security & Privacy](security-privacy.md) - SecurityWarning contract, remote content, phishing links, risky attachments и debug redaction.
- [Testing Process](testing-process.md) - обязательные layers проверки, installed desktop smoke и screenshot evidence.
- [Журнал изменений](change-log.md) - важные implementation и behavior changes.
- [Правила ведения wiki](wiki-conventions.md) - как поддерживать wiki полезной.

## Текущее продуктовое направление

Office360 сфокусирован на IMAP/SMTP и Yandex mail workflows. Gmail не является целевым провайдером для default product experience и должен оставаться скрытым, если явно не включён как compatibility path.

Yandex 360 default flow is ordinary work-account OAuth through Yandex ID. Organization administration is a separate admin scenario and must not appear as the primary mailbox setup path.

Microsoft OAuth для Outlook/Hotmail/Live является IMAP/SMTP compatibility path. Native Microsoft 365/Exchange через Graph, shared mailboxes, Exchange calendar и contacts пока planned/unsupported.

## Текущий smoke focus

Для provider-capability изменений проверять:

- Yandex/IMAP account picker не показывает Gmail по умолчанию.
- Yandex/IMAP sidebar не показывает Gmail-native labels.
- Yandex/IMAP context menus не показывают `Apply Label`.
- Yandex/IMAP settings не показывают `Google API`, `Labels` или `Smart Labels`.
- `Move to Folder`, archive, trash, star, mark read, send и sync flows работают.
- Settings > Яндекс 360 показывает account hub, а не raw Admin API token console.

Для account-diagnostics и support bundle изменений проверять:

- IMAP и SMTP failures отображаются отдельными diagnostics.
- Expired OAuth token ведёт к re-auth.
- TLS/certificate failure не выглядит как wrong password.
- Support bundle export не содержит secrets или raw mail.

Для security/privacy изменений проверять:

- Remote images остаются blocked by default, а Spam игнорирует sender allowlist.
- Suspicious link confirmation показывает target URL и displayed link text.
- Risky attachments требуют explicit confirmation перед preview/download.
- Support bundle содержит только summaries security warnings, без raw HTML/body/MIME.

Для Address Book изменений проверять:

- `/contacts` открывается из sidebar и Settings > People.
- Existing inferred contacts видны в `Collected Addresses`, managed contacts - в `Personal Address Book`.
- Rich contact save не ломает compose autocomplete и sender display names.
- vCard import/export не теряет supported rich fields.
- CardDAV/LDAP credentials не появляются в UI status, logs или support bundle.
