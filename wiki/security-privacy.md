# Security & Privacy

Эта страница фиксирует текущие правила reader security для Office360 Mail.

## SecurityWarning contract

Reader security warnings собираются вокруг общего `SecurityWarning` contract:

- `remote_content` - remote images/tracking pixels.
- `suspicious_link` - phishing heuristics and display/target mismatch.
- `sender_auth` - SPF/DKIM/DMARC aggregate failure.
- `unsafe_attachment` - executable/script/archive-risk attachments.
- `encrypted_message`, `signature_status`, `spoofing_risk` - зарезервированы для P1 OpenPGP/S/MIME и sender trust work.

Severity values: `info`, `warning`, `danger`. Actions are explicit and user-visible: `allow_once`, `always_allow_sender`, `inspect`, `download`, `open_external`, `report`, `dismiss`.

## Remote content

Remote images are blocked before rendering by moving remote `http`/`https` image URLs into `data-blocked-src` and replacing `src` with a transparent local data URI.

Rules:

- `Load once` affects only the current render.
- `Always allow sender` is scoped by `accountId + senderAddress`.
- Spam messages ignore sender allowlist and do not offer persistent allowlist.
- `data:` and `cid:` images are preserved for local/inline content.

## Links

Expanded HTML messages run the phishing scanner and pass the scan result to `EmailRenderer`.

Rules:

- Medium/high risk links are intercepted before `openUrl`.
- Confirmation shows the target URL and the displayed link text.
- Display/target mismatch remains visible to the user before opening externally.
- Dangerous schemes are still removed by sanitization before render.

## Attachments

Attachments with executable/script package extensions or archive-risk types require explicit confirmation before preview/download.

Examples include `.exe`, `.app`, `.dmg`, `.pkg`, `.js`, `.vbs`, `.ps1`, `.sh`, `.jar`, `.zip`, `.rar`, `.7z`, `.tar`, `.gz`.

Safe previewable types keep the existing flow.

## Debug bundle privacy

Debug bundles may include security warning summaries only:

- warning id;
- account/message ids;
- kind/severity;
- sanitized reason and recommended action;
- action names.

Debug bundles must not include raw HTML, message body, raw MIME, attachment payloads, OAuth tokens, passwords, auth headers, or private URL query payloads.

## Yandex OAuth vs Passport

Office360 API authorization (OAuth access/refresh tokens) and the macOS WKWebsiteDataStore Passport session are separate security domains. One user-visible Yandex login may establish both because the authorize page runs in the account WK store. Tokens are not written as cookies, cookies are not minted from tokens, and sessions are not copied between accounts.
