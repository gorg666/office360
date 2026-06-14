# Office360 Wiki

Эта wiki - living project memory для Office360.

Обновляй её, когда изменение затрагивает system behavior, architecture, provider rules, user-visible workflows, deployment или smoke checks.

## Страницы

- [Обзор системы](system-overview.md) - текущая архитектура и границы продукта.
- [Provider Capabilities](provider-capabilities.md) - provider model, Gmail/Yandex/IMAP capability decisions и UI gating.
- [Account Diagnostics](account-diagnostics.md) - ConnectionDiagnostic, Repair Center и privacy-safe debug export.
- [Contacts and address book](contacts-address-book.md) - contact aggregate, identities, vCard compatibility и текущие границы sync scope.
- [Calendar invitations](calendar-invitations.md) - invite detection, thread invite card, local-first RSVP и границы remote delivery.
- [Security & Privacy](security-privacy.md) - SecurityWarning contract, remote content, phishing links, risky attachments и debug redaction.
- [Журнал изменений](change-log.md) - важные implementation и behavior changes.
- [Правила ведения wiki](wiki-conventions.md) - как поддерживать wiki полезной.

## Текущее продуктовое направление

Office360 сфокусирован на IMAP/SMTP и Yandex mail workflows. Gmail не является целевым провайдером для default product experience и должен оставаться скрытым, если явно не включён как compatibility path.

## Текущий smoke focus

Для provider-capability изменений проверять:

- Yandex/IMAP account picker не показывает Gmail по умолчанию.
- Yandex/IMAP sidebar не показывает Gmail-native labels.
- Yandex/IMAP context menus не показывают `Apply Label`.
- Yandex/IMAP settings не показывают `Google API`, `Labels` или `Smart Labels`.
- `Move to Folder`, archive, trash, star, mark read, send и sync flows работают.

Для account-diagnostics изменений проверять:

- IMAP и SMTP failures отображаются отдельными diagnostics.
- Expired OAuth token ведёт к re-auth.
- TLS/certificate failure не выглядит как wrong password.
- Debug export не содержит secrets или raw mail.

Для security/privacy изменений проверять:

- Remote images остаются blocked by default, а Spam игнорирует sender allowlist.
- Suspicious link confirmation показывает target URL и displayed link text.
- Risky attachments требуют explicit confirmation перед preview/download.
- Debug bundle содержит только summaries security warnings, без raw HTML/body/MIME.
