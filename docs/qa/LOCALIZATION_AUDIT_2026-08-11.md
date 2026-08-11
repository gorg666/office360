# LOCALIZATION AUDIT — Office360 — 2026-08-11

APOSTLE: Graphify queried (i18n / TranslationLayer / Sidebar / Mail / Composer / notifications). Graphify **not** regenerated (generated graphify-out not updated in git).

## Canonical i18n

| Piece | Path |
|---|---|
| Dictionary (EN key → RU) | `src/i18n.ts` (~835 keys) |
| DOM layer | `src/components/i18n/TranslationLayer.tsx` |
| Default locale | `ru` (`DEFAULT_LOCALE`) |
| Dates | `src/utils/date.ts` → `ru-RU` |
| Plurals | `src/utils/pluralRu.ts` |
| User-facing errors | `src/utils/userFacingError.ts` + `networkErrors.ts` |
| Native notifications | `src/services/notifications/notificationManager.ts` |
| Guard | `npm run check:i18n` → `scripts/i18n-audit.mjs` |
| Extra merge | `scripts/i18n-extra-ru.json` + `scripts/merge-i18n-extra.mjs` |

Pattern: UI source strings remain English keys; TranslationLayer + `translateText()` resolve to Russian. Do **not** mass-hardcode RU in components.

## Metrics

| | Count |
|---|---|
| **BEFORE** unique user-visible EN candidates (filtered scan) | ~275–305 |
| **AFTER** `check:i18n` missing candidates | **0** |
| Dictionary keys | **835** |
| Allowlisted (email, URL, brand, protocol, user content, MIME, routes) | N/A — excluded from scan by design |

**Target:** 0 untranslated system UI strings except allowlist.  
**PASS (localization product):** **NO** — runtime DOM/Tauri walk not completed this session.

## BEFORE sample (representative; not exhaustive)

| Source | Current text | Location | User-visible | Action |
|---|---|---|---|---|
| MAIL | Cc / Bcc | Composer | Yes | Key in `i18n.ts` (+ Composer Bcc label RU) |
| MAIL | Inbox, Sent, Draft, Spam… | Sidebar / folders | Yes | Dict + special-use mapping |
| MAIL | Send, Retry, Undo, Open | Composer / Outbox / menus | Yes | Dict |
| MAIL | New mail | Notifications | Yes | `notificationManager` RU |
| MAIL | (No subject) | Thread list | Yes | Dict |
| COMMON UI | Cancel, Settings, Search, Loading… | Global | Yes | Dict |
| SETTINGS | About / Quick steps paragraphs | Settings panels | Yes | Dict (multiline normalize in audit) |
| ERRORS | Failed to fetch / AuthenticationFailed / SMTP 535 | Toasts / sync | Yes | `toUserFacingError` |
| DATES | Yesterday / Monday / August | Lists / calendar | Yes | `ru-RU` + translate Yesterday |
| ACCESSIBILITY | title / aria-label / placeholder | DOM attrs | Yes | TranslationLayer attrs |
| WINDOW/TRAY | New mail / Open / Retry | Win toast actions | Yes | notificationManager |
| CALENDAR | Day/Week/Month actions | Calendar UI | Yes | Dict (EN keys → RU via layer) |
| MESSENGER | Chat empty / send | Messenger | Yes | Dict |
| CONTACTS | Name, Email, Phone labels | Contacts | Yes | Dict |
| FILES | Download, Delete, Upload | Files | Yes | Dict |

## AFTER residual risk

| Risk | Notes |
|---|---|
| Runtime Latin in DOM | Manual / Playwright scan not run → may find split strings, dynamic concat, AI panels |
| Custom IMAP folder names | Intentionally **not** translated |
| User content | Intentionally not translated |
| `en-US` leftovers in niche date pickers / AI | Spot-check remaining `toLocale*` |
| Hardcoded RU in a few places | Composer Bcc label, some error formatters — prefer keys long-term |

## Automated guard

```bash
npm run check:i18n
```

- Scans TSX props / JSX text / toast literals with Latin letters
- Normalizes whitespace before dict lookup
- `--fail` exits non-zero on missing candidates
- Allowlist filters technical / brand / path noise inside the script

## Tests

- `src/i18n.localization.test.ts` — keys, plurals, errors, relative date
- Run: `npx vitest run src/i18n.localization.test.ts`

## Runtime QA (required for PASS)

Manual / Tauri checklist (not done → do not mark localization PASS):

1. Mail: folders, composer (Кому/Копия/Скрытая копия), Outbox statuses, context menus  
2. Calendar / Messenger / Contacts / Files / Settings  
3. Windows toast title/body/actions in Russian; window title  
4. Force network/auth error → Russian toast, no raw `invalid_client`  
5. Optional: Playwright DOM scan with allowlist for emails/URLs  

## Graphify

| | |
|---|---|
| queried | Yes — i18n, TranslationLayer, Sidebar, Composer, MailLayout, notifications |
| affected subgraph | community ~56 (i18n), layout/mail/composer/notifications |
| updated | **No** (no graph regen committed) |
