# BUG BACKLOG — Office360 Manual QA 2026-08-11

Branch: `office360-mail-workflow`  
HEAD at session start: `8f5b6ac`  
Source checklist: `docs/qa/yandex-corp-mail-manual-qa-2026-08-11.md`  
Results: `docs/qa/QA_RESULTS_2026-08-11.md`

## Rules

- Add bugs only from **confirmed** manual FAIL / observed defects.
- Do **not** invent root cause without evidence.
- Do **not** paste secrets, tokens, or full personal emails if avoidable.
- Screenshots with sensitive data: keep path local; do not commit binary evidence into git unless sanitized.
- Known code risks (DEF-01…DEF-20) are **hypotheses** until reproduced — list under Watchlist, not as OPEN bugs.

## Index

| ID | Severity | Area | Title | Status |
|---|---|---|---|---|
| MAIL-001 | P0 | Mail | Yandex OAuth callback localhost listener unavailable | CLOSED — PASS |
| MAIL-002 | P0 | Mail | Yandex OAuth login_hint causes invalid_request for typed email | CLOSED — PASS |
| AUTH-001 | P0 | Auth / Mail / Calendar | Yandex OAuth token refresh fails with invalid_client | OPEN — fix applied, pending retest |
| MAIL-003 | P0 | Mail / SMTP / UX | Send mail fails silently | OPEN — fix applied, pending retest |
| MAIL-004 | P0 | Mail / SMTP / Sync | Sent message absent from Sent/Outbox | OPEN — fix applied, pending retest |
| MAIL-010 | P0 | Mail / SMTP / Sent | False send success: toast but absent from Sent | FIX APPLIED (pending retest) |
| AUTH-002 | P1 | Auth / UX | OAuth window remains blank/open after flow | OPEN — fix applied, pending retest |
| MAIL-005 | P1 | Mail / Composer | Composer window remains open after send | OPEN — fix applied, pending retest |
| MAIL-008 | P1 | Mail / Outbox | Duplicate Outbox entry for one send | FIX APPLIED (pending retest) |
| CAL-001 | P1 | Calendar | Yandex CalDAV / calendar:all not demonstrated after OAuth (A2) | OPEN |
| MAIL-006 | P2 | Mail / UX | Send progress toast rendered in composer instead of main shell | OPEN — fix applied, pending retest |
| MAIL-007 | P2 | Mail / Composer | Recipient field has no recent-contact suggestions | OPEN — fix applied, pending retest |
| MAIL-009 | P2 | Mail / Outbox | Outbox item cannot be opened | FIX APPLIED (pending retest) |
| UI-001 | P2 | Localization / Composer | Cc/Bcc not localized | FIX APPLIED / AWAITING MANUAL VERIFY (i18n pass 2026-08-11) |
| MAIL-011 | P1 | Mail / Outbox | Stale/orphan message remains in Outbox | FIX APPLIED / AWAITING MANUAL VERIFY |
| MAIL-012 | P2 | Mail / UX | No right-click context menu on messages | FIX APPLIED / AWAITING MANUAL VERIFY |
| UI-002 | P2 | Mail / Search | Developer search syntax in placeholder | FIX APPLIED / AWAITING MANUAL VERIFY |
| UI-003 | P2 | Localization / Mail | Folder/page titles start lowercase | FIX APPLIED / AWAITING MANUAL VERIFY |
| MAIL-013 | P1/P2 | Mail / UX | Read/unread state visually unclear | FIX APPLIED / AWAITING MANUAL VERIFY |
| MAIL-014 | P1 | Mail / Navigation | Account mail folders hierarchy | FIX APPLIED / AWAITING MANUAL VERIFY |
| MAIL-015 | P1 | Mail / Sync | Incoming mail arrives too slowly | MEASURED / AWAITING MANUAL VERIFY (IDLE deferred) |
| MAIL-016 | P1 | Mail / Outbox | Context menu missing in Outbox | FIX APPLIED / AWAITING MANUAL VERIFY |
| MAIL-017 | P2 | Mail / Attachments | Image attachments have no preview | STILL OPEN — library emoji only; raster thumb/lightbox not confirmed (FINAL MAIL QA) |
| NOTIF-001 | P1 | Notifications / Windows | Windows notifications appear as PowerShell | FIX APPLIED / AWAITING MANUAL VERIFY (runtime BLOCKED 2026-08-11 evening) |
| MAIL-018 | P1 | Mail / Folders | Duplicate «Исходящие» (system + IMAP custom) | OPEN — confirmed FINAL MAIL RUNTIME QA |
| I18N-001 | P2 | Localization / a11y | English aria/menu/time residues in Mail | OPEN — confirmed FINAL MAIL RUNTIME QA |
| MAIL-019 | P1 | Mail / Read state | Open message does not reliably mark read | OPEN — observed FINAL MAIL RUNTIME QA |
| MAIL-020 | P1 | Mail / Send UX / Notifications | Duplicate send toast (legacy + global) | FIX APPLIED / AWAITING MANUAL VERIFY |
| AUTH-004 | P1 | Unified Yandex Auth / Disk / Tracker | Yandex verification-code OAuth flow unusable in desktop UI | FAIL / BLOCKER — code prefers localhost; **WAITING FOR YANDEX CONFIG** |
| AUTH-005 | P1 | Yandex OAuth lifecycle / Disk / Tracker | OAuth callback port 17248 already in use | FIX APPLIED — stale listener on cancel; awaiting runtime retest |
| TRACKER-001 | P1 | Tracker / rate-limit | Duplicate initialize + no 429 cooldown → HTTP 429 | FIX APPLIED / AWAITING MANUAL VERIFY |
| TRACKER-002 | P0 | Tracker / authz | All Tracker writes 403 — **read-only license («режим просмотра»)** | FIX APPLIED / AWAITING MANUAL VERIFY |
| TRACKER-003 | P1 | Tracker / UI | Status & priority filter `<option>` labels empty | OPEN |
| TRACKER-004 | P1 | Tracker / filters | Status/priority (and assignee) filters do not change issue list | OPEN |
| TRACKER-005 | P2 | Tracker / issue detail | No author / assignee / created / updated / deadline in panel | OPEN |
| TRACKER-006 | P2 | Tracker / attachments | Attachment names only — no download/open | OPEN |
| TRACKER-007 | P2 | Tracker / create UX | Create issue = title-only `window.prompt` | OPEN |
| MSG-HYBRID-001 | P1 | Messenger / Efim port | Provider tabs stuck on MAX; Yandex widget not shown | CLOSED / PASS |
| HUB-HYBRID-001 | P2 | Account Hub / i18n | Grant statuses show English CONNECTED / NEEDS ACCESS | CLOSED / PASS |
| MSG-HYBRID-002 | P1 | Messenger widget / runtime mount | Yandex Messenger stuck loading after communications consent | OPEN |

**Counts:** P0=+TRACKER-002 · P1=+TRACKER-003/004 · P2=+TRACKER-005/006/007 · **TRACKER-001 FIX APPLIED** · write path BLOCKED on org role/ACL

---

## Confirmed bugs

# BUG MAIL-001 — Yandex OAuth callback localhost listener недоступен

Severity:
P0

Area:
Mail

Status:
CLOSED — PASS (manual retest 2026-08-11)

Environment:
Tauri / Windows (`npm run tauri dev`) / Yandex corporate OAuth / Office360 0.4.21

Reproducibility:
1/1 FAIL → PASS on retest

Steps:
1. Запустить `npm run tauri dev`.
2. Начать подключение Yandex account (OAuth).
3. Подтвердить consent в браузере Яндекса.
4. Дождаться redirect на `http://localhost:17248/?state=...`.

Expected:
После успешной авторизации Яндекс перенаправляет на localhost callback, Tauri принимает authorization response, сохраняет account/token и закрывает OAuth flow. UI выходит из «Подключение...».

Actual (initial FAIL):
Redirect идёт на `localhost:17248`, но соединение отклоняется (`ERR_CONNECTION_REFUSED`). UI Office360 бесконечно остаётся на «Подключение...».

Actual (retest PASS):
Embedded Yandex ID; callback accepted; OAuth window auto-closed; account added; no system browser.

Evidence:
- initial: Chrome ERR_CONNECTION_REFUSED on localhost:17248
- retest: user confirmed A1 / MAIL-001 PASS (2026-08-11 ~05:38)

Likely layer:
Tauri / OAuth callback server / Rust backend

Notes:
Closed after embedded WebView + callback lifecycle fix verified manually.

---

# BUG MAIL-002 — Yandex OAuth login_hint → invalid_request

Severity:
P0

Area:
Mail/Auth

Status:
CLOSED — PASS (manual retest 2026-08-11)

Environment:
Tauri / Windows (`npm run tauri dev`) / Yandex corporate OAuth

Reproducibility:
1/1 FAIL → PASS on retest

Steps:
1. Connect Yandex with email typed in the Office360 form.
2. Complete / attempt Yandex authorize.

Expected:
User can choose/enter account on official Yandex page; OAuth proceeds.

Actual (initial FAIL):
Yandex returns `invalid_request` («Запрашивается авторизация несуществующим аккаунтом»). Request included `login_hint` from the typed form email.

Actual (retest PASS):
login_hint omitted on connect form; account selected in embedded Yandex ID; flow completes; account added.

Likely layer:
Frontend OAuth URL builder (`AddImapAccount` → `oauthFlow`)

Root cause:
`login_hint` was set from unverified `form.email` before OAuth. Per Yandex docs, nonexistent account in `login_hint` fails the flow.

Fix verified:
- `login_hint` optional; sent only with `confirmedAccount: true`
- Connect form no longer passes typed email as hint
- User selects account inside embedded Yandex OAuth window

---

# BUG AUTH-001 — Yandex OAuth token refresh fails with invalid_client

Severity:
P0

Area:
Auth / Mail / Calendar

Status:
OPEN — fix applied, pending manual retest

Environment:
Tauri desktop / Windows / Yandex OAuth after A1 / 2026-08-11

Expected:
After OAuth grant, app stores enough credentials and refreshes access_token via refresh_token before IMAP/SMTP/CalDAV use.

Actual:
Refresh `POST https://oauth.yandex.ru/token` → `400 invalid_client` / Wrong client secret.
Stored access_token later rejected: `login.yandex.ru/info` → `expired_token`; IMAP XOAUTH2 → AUTHENTICATIONFAILED.
`oauth_client_secret` not persisted on managed Yandex public-client path; `ensureFreshToken` trusts far-future `token_expires_at` and may not refresh.

Effects:
IMAP/Calendar/SMTP session breaks after initial sync; account reuse fails.

Root cause (code-confirmed):
1. Managed Yandex PKCE code exchange can succeed without `client_secret`.
2. Refresh for this Yandex app returns `invalid_client` / Wrong client secret when secret is missing/wrong.
3. Managed connect stored empty `oauth_client_secret` and never resolved a secure-store secret on refresh.
4. `updateAccountTokens` did not persist rotated `refresh_token`.
5. Far-future `token_expires_at` + dead access_token → refresh not attempted until force path.

Fix applied (pending retest):
- Secure setting `yandex_oauth_client_secret`; required on Yandex connect UI; used on refresh.
- Persist rotated refresh_token; normalize/clamp expires_in; `forceRefresh` on IMAP/SMTP auth failure.

---

# BUG MAIL-003 — Send mail fails silently

Severity:
P0

Area:
Mail / SMTP / UX

Status:
OPEN — fix applied, pending manual retest

Environment:
Manual send from Office360 composer after A1 / 2026-08-11

Expected:
Send either delivers + confirms success, or shows a clear error and keeps draft/compose.

Actual:
Message not delivered; no user-visible error/success; OAuth WebView may still be open blank. Terminal shows HTTPS activity. Possible link to AUTH-001 (stale OAuth token / SMTP XOAUTH2) but not asserted without send-path evidence after fix.

Root cause (code-confirmed contributors):
1. SMTP send had no timeout → hang = silent UX after undo-send closes composer.
2. Dead OAuth token + no force-refresh on SMTP auth failure.
3. Auth/timeout could be mis-routed; toast copy was English / easy to miss.

Fix applied (pending retest):
- 45s SMTP send timeout; force token refresh + one SMTP retry on auth failure.
- Send auth/timeout → failed ActionResult + Russian toast; draft restored.

---

# BUG AUTH-002 — OAuth window remains blank/open after flow failure

Severity:
P1

Area:
Auth / UX

Status:
OPEN — fix applied, pending manual retest

Environment:
Embedded `yandex-oauth` WebView / 2026-08-11

Expected:
OAuth window closes on success, error, cancel, or timeout; main UI gets state + message.

Actual:
Empty white WebView remains open; no error shown.

Evidence:
Manual screenshot 2026-08-11

Root cause (code-confirmed):
Window closed only in `finally` after token exchange / userInfo; WebView stayed on localhost blank page during that work; `close()` alone may leave a blank shell.

Fix applied (pending retest):
- Close/destroy immediately after authorization code received.
- Rust `close_oauth_login_window` prefers `hide` + `destroy`, falls back to `close`.

---

# BUG MAIL-004 — Sent message absent from Sent/Outbox

Severity:
P0

Area:
Mail / SMTP / Sync / Folder mapping

Status:
OPEN — fix applied, pending manual retest

Environment:
Manual SMTP retest via Tauri compose window / 2026-08-11

Expected:
After successful send: SMTP accepted; confirmation shown; message in Sent; during undo/queue visible in Outbox/pending.

Actual:
Message absent from both «Отправленные» and «Исходящие».

Root cause (code-confirmed):
Compose WebView owned undo timer + send + sync events; main shell never received `velo-sync-done` / Outbox updates. Online send did not enqueue Outbox (`queued` status).

Fix applied (pending retest):
- Durable handoff to main shell; Outbox `queued` during undo; SMTP + IMAP Sent APPEND + `triggerSync` on main; success toast on main.

---

# BUG MAIL-005 — Composer window remains open after send

Severity:
P1

Area:
Mail / Composer

Status:
OPEN — fix applied, pending manual retest

Expected:
Compose closes after send is accepted into undo queue / send pipeline.

Actual:
«Новое сообщение» stays open (blank) after Send; progress toast inside that window.

Root cause (code-confirmed):
`handleSend` called `closeComposer()` but not `closeStandaloneComposeWindow()`.

Fix applied (pending retest):
Close WebView after durable `requestComposeSend` handoff.

---

# BUG MAIL-006 — Send progress toast rendered in composer instead of main shell

Severity:
P2

Area:
Mail / UX

Status:
OPEN — fix applied, pending manual retest

Expected:
Global «Отправка…» / Undo / success / failure in main Office360 shell.

Actual:
Toast lives in compose WebView and is tied to that window lifecycle.

Root cause (code-confirmed):
`UndoSendToast` in `ComposerWindow`; CustomEvent does not cross WebViews.

Fix applied (pending retest):
Tauri event `office360-compose-send-requested` → main `installComposeSendListener` + `UndoSendToast` / `SendFeedbackToast` only in App.

---

# BUG MAIL-007 — Recipient field has no recent-contact suggestions

Severity:
P2

Area:
Mail / Composer

Status:
OPEN — fix applied, pending manual retest

Expected:
On focus of empty «Кому», up to 5 recent/frequent recipients; on type — autocomplete.

Actual:
Empty field; no suggestions until typed query length ≥ 2.

Root cause (code-confirmed):
`AddressInput` only called `searchContacts` when `value.length >= 2`.

Fix applied (pending retest):
`getRecentContacts(5)` on focus; reuse `contacts` table.

---

# BUG UI-001 — Cc/Bcc not localized

Severity:
P2

Area:
Localization / Composer

Status:
FIX APPLIED / AWAITING MANUAL VERIFY (full i18n pass 2026-08-11)

Current:
`Cc / Bcc` (and field labels `Cc` / `Bcc`)

Expected RU:
`Копия / Скрытая копия` (fields: `Копия`, `Скрытая копия`)

Root cause (code-confirmed):
Hardcoded English strings in `Composer.tsx` / missing i18n keys.

Fix applied (pending retest):
- Keys in `src/i18n.ts` (Cc → Копия, Bcc → Скрытая копия)
- TranslationLayer + Composer label update
- See `docs/qa/LOCALIZATION_AUDIT_2026-08-11.md`

---

# WATCH — LOC-001 Full UI Russian localization

Severity:
P2 (product polish)

Area:
Localization (all modules)

Status:
STATIC CLEAN (`check:i18n` = 0) / **RUNTIME NOT VERIFIED** — do not PASS

Notes:
- Dict ~835 keys; guard `npm run check:i18n`
- Errors/dates/plurals/notifications wired
- Remaining risk: dynamic strings, native tray/window, niche `toLocale*` — needs Tauri walk

---

# BUG MAIL-008 — Duplicate Outbox entry

Severity:
P1

Area:
Mail / Outbox

Status:
FIX APPLIED (pending retest)

Environment:
Manual send retest Tauri / 2026-08-11

Expected:
One Send → exactly one Outbox/pending operation with stable id.

Actual:
«Ожидающих отправки» shows duplicate of the same message.

Root cause:
(1) React StrictMode: async `listen` resolve after unmount left a leaked listener → one emit → two `scheduleComposeSend`.
(2) Non-idempotent UUID inserts into `pending_operations`.

Fix applied:
- StrictMode-safe `installComposeSendListener` (`cancelled` + unlisten-if-late).
- `scheduledRequestIds` + same `requestId` early return.
- `enqueueQueuedComposeSend(requestId)` as PK + `ON CONFLICT DO NOTHING` + lookup by id/resource_id.
- OutboxList client dedupe by id/resource_id.

---

# BUG MAIL-009 — Outbox item cannot be opened

Severity:
P2

Area:
Mail / Outbox

Status:
FIX APPLIED (pending retest)

Expected:
Click queued/failed Outbox item opens draft/message in composer (or status view while sending).

Actual:
Click does nothing (dead list item).

Root cause:
`OutboxList` had no open/click handler; restore payload not stored on enqueue.

Fix applied:
- Store `restore` in pending op params.
- Click opens composer via `restoreCompose` (disabled while `executing`).

---

# BUG MAIL-010 — False send success: toast success but message absent from Sent

Severity:
P0

Area:
Mail / SMTP / Sent reconciliation

Status:
FIX APPLIED (pending retest)

Expected:
Final «Письмо отправлено» only when durable Sent state exists; user sees message in «Отправленные».

Actual:
Global toast «Письмо отправлено» while Sent folder empty.

Root cause:
(1) Final success toast fired right after SMTP / `sendEmail` success.
(2) IMAP path skipped `saveSentMessageLocally` when APPEND to `\Sent` succeeded (assumed sync would fill Sent).
(3) Outbox op deleted before durable local Sent.

Fix applied:
- Always persist local SENT placeholder after SMTP.
- Phases: `smtp_accepted` → `sent_reconciling` → `sent`.
- Interim toast «Обновляем «Отправленные»…»; final toast only on `sent`.
- Outbox delete only after `localPersisted`.
- If IMAP result without local persist → error toast, keep failed outbox.

---

# BUG CAL-001 — Yandex CalDAV / `calendar:all` не подтверждён после OAuth (A2)

Severity:
P1

Area:
Calendar / OAuth scopes

Status:
OPEN

Environment:
Tauri desktop / Windows / Yandex account after A1 PASS / Office360 0.4-dev QA 2026-08-11

Reproducibility:
1/1 (diagnostic after A1)

Steps:
1. Connect Yandex via OAuth (A1 PASS).
2. Do not rely on config scope strings; check runtime CalDAV with saved grant.
3. Inspect local DB calendars + optional `PROPFIND` on `https://caldav.yandex.ru/`.

Expected:
CalDAV accepts OAuth grant (`calendar:all`); principal/home discoverable; calendars listable (or explicit auth error proving scope miss).

Actual:
- `calendars` / `calendar_events` empty; `caldav_principal_url` / `caldav_home_url` null.
- App setting `calendar_enabled=false` (Calendar path not exercised in UI).
- Live CalDAV PROPFIND with stored access_token → 401 (expired_token path), not a clean `insufficient_scope`.
- Token refresh fails: `invalid_client` / Wrong client secret (`oauth_client_secret` not on account).
- Therefore A2 cannot mark Calendar PASS; missing **confirmed runtime Calendar capability**.

Evidence:
- QA_RESULTS A2 section 2026-08-11
- DB: calendar counts 0; no tokens logged

Likely layer:
CalDAV auth / OAuth scopes on Yandex app / calendar enablement / token refresh storage

Notes:
Do not conflate with mail sync UI bugs. Re-test A2 Calendar after: enable calendar, ensure refresh works (or fresh OAuth), then PROPFIND/list calendars. If then 403/`insufficient_scope` — upgrade root cause to missing `calendar:all` on Yandex app grant.

---

## Watchlist (not bugs until reproduced)

| Ref | Risk | Severity if confirmed | Watch files |
|---|---|---|---|
| DEF-01 | Yandex OAuth defaults to login-only scopes | P0/P1 | `providers.ts`, `AddImapAccount.tsx` |
| AUTH-W1 | access_token expired while `token_expires_at` still future; refresh needs missing `oauth_client_secret` | P0/P1 | `oauthTokenManager.ts`, account row |
| DEF-02 | Scheduled Send hardcoded Gmail client | P0 | `scheduledSendManager.ts` |
| DEF-05 | Apply Label / DnD silent no-op on IMAP | P1 | `imapSmtpProvider.ts`, `DndProvider.tsx` |
| DEF-09 | Outbox has no Cancel/Delete | P1 | `OutboxList.tsx` |
| DEF-13 | Composer DnD bypasses 24MB limit | P1 | `Composer.tsx` |
| UX | Empty state when no message selected | P2 | reading pane UI |
| UX | Avatars sometimes missing | P2 | `ContactAvatar.tsx`, `yandexProfile.ts`, `gravatar.ts` |
| Security | npm audit critical/high | see triage | `SECURITY_TRIAGE_2026-08-11.md` |

---

# BUG MAIL-011 — Stale/orphan message remains in Outbox

Severity: P1  
Area: Mail / Outbox  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Expected: Startup reconciliation classifies pending ops; SENT cleaned; impossible stale state → FAILED with Retry; never blind-delete queued user messages.

Actual: Legacy `aaaaa` stuck in Исходящие forever.

Fix applied: `reconcileOutboxPendingOperations()` on App startup; durable Sent → delete op; stale executing/sending/smtp_accepted/sent_reconciling → failed «Не отправлено»; queued without payload → failed; queued with payload → normalize to pending. OutboxList shows FAILED + Retry.

---

# BUG MAIL-012 — No right-click context menu on messages

Severity: P2  
Area: Mail / UX  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Expected: Desktop context menu on list items with Open/Reply/Reply all/Forward/Read/Star/Snooze/Move/Archive/Spam/Delete (disable unavailable).

Fix applied: Allow `[data-office360-context-menu-source]`; ThreadCard + MessageItem mark source; ThreadMenu uses threadMap lookup; capability helper for drafts/trash; RU via i18n.

---

# BUG UI-002 — Developer search syntax exposed to user

Severity: P2  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Fix applied: SearchBar placeholder → `Search mail` / i18n `Поиск в почте`. Operators removed from main placeholder.

---

# BUG UI-003 — Folder/page titles start lowercase

Severity: P2  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Fix applied: `getSystemFolderTitle()` + EmailList; i18n proper-case system names. No blind `capitalize()` on user folders.

---

# BUG MAIL-013 — Read/unread state visually unclear

Severity: P1/P2  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Fix applied: Unread indicator dot; semibold sender/subject; light unread background on ThreadCard.

---

# BUG MAIL-014 — Account mail folders hierarchy

Severity: P1  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Fix applied: Canonical `src/services/imap/folderTree.ts` (duplicate `utils/mailFolderTree.ts` removed); Inbox children collapsible; other folders tree; SPECIAL-USE excluded; expanded state persisted; Labels = tags only (no IMAP folder duplex). Unread folder counts: N/A (no unread field on labels yet).

---

# BUG MAIL-015 — Incoming mail arrives too slowly

Severity: P1  
Status: MEASURED / AWAITING MANUAL VERIFY (IMAP IDLE deferred)

Measured: adaptive polling `SYNC_INTERVAL_VISIBLE_MS=10000` / `SYNC_INTERVAL_HIDDEN_MS=120000`; IMAP IDLE currently NO; focus/visibility → immediate `runPeriodicSync`; online reconnect via App `triggerSync` + queue flush; post-connect `startBackgroundSync`. Interval/IDLE changes deferred to separate decision after Mail UI retest.

---

# BUG MAIL-016 — Context menu missing in Outbox

Severity: P1  
Area: Mail / Outbox / UX  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Actual: ПКМ в «Исходящих» не открывал меню (нет `data-office360-context-menu-source` / outbox menu type).

Fix applied: Outbox capability mapper `outboxContextMenuActions.ts`; `ContextMenuType=outbox`; OutboxList ПКМ + OutboxMenu (queued: Open/Cancel; sending/reconciling: status only; failed: draft/retry/delete). Cancel only for queued/pending (safe `deleteOperation` / `cancelQueuedComposeSend`).

---

# BUG MAIL-017 — Image attachments have no preview

Severity: P2  
Area: Mail / Attachments / UI  
Status: STILL OPEN — FINAL MAIL RUNTIME QA: library emoji icons only; raster thumb/lightbox/download not confirmed

Actual: JPG в открытом письме — только generic attachment card.

Fix applied: safe raster thumbnails in `AttachmentList` (jpeg/png/webp/gif); session cache `attachmentPreviewCache`; click → lightbox; download; skeleton/broken fallback; no SVG/exe preview.

---

# BUG NOTIF-001 — Windows notifications appear as PowerShell

Severity: P1  
Area: Notifications / Windows / Tauri  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Root cause (traced): `tauri-plugin-notification` desktop.rs **не ставит** `app_id` когда exe в `target/debug` или `target/release` → WinRT/notify-rust атрибутирует toast к PowerShell AUMID. Plugin docs: «Shows powershell name & icon in development.»

Fix applied: native WinRT path `show_native_notification` + registry `AppUserModelId\com.office360.desktop` (DisplayName Office360 + IconUri); always use AUMID `com.office360.desktop`; foreground suppression (no OS toast when focused); click focuses main window. Documented: packaged install still preferred for full Start Menu identity; unpackaged + registry works for DisplayName/icon.

---

# BUG MAIL-018 — Duplicate «Исходящие» in folder list

Severity: P1  
Area: Mail / Folders / SPECIAL-USE  
Status: OPEN — confirmed FINAL MAIL RUNTIME QA (`GORGDEV2` `f95b3cf`)

Steps:
1. Open Mail sidebar with Yandex account that has a custom IMAP folder named «Исходящие».
2. Observe system Outbox label and custom folder under «Папки».

Expected: SPECIAL-USE / system Outbox not duplicated as a second identical label.

Actual: Label «Исходящие» appears twice (count=2 in sidebar buttons).

---

# BUG I18N-001 — English system strings remain in Mail UI

Severity: P2  
Area: Localization / a11y / Attachments  
Status: OPEN — confirmed FINAL MAIL RUNTIME QA

Evidence (system UI only; not user email bodies):
- Thread aria: `Unread email from…`, `email from…`, `N unread emails`
- Context menu item: `Mute`
- Subject fallback sometimes `(No subject)` vs `(Без темы)`
- Attachments library relative times: `7h ago`, `11h ago`, `1mo ago`, `21d ago`

---

# BUG MAIL-019 — Opening a message does not reliably mark it read

Severity: P1  
Area: Mail / Read state  
Status: OPEN — observed FINAL MAIL RUNTIME QA

Steps:
1. Ensure a thread shows as unread (`Unread email from…`, accent row).
2. Left-click to open.

Expected: Thread becomes read; unread badge decrements; reading pane shows subject.

Actual: In CDP session, aria often stayed `Unread…`; pane sometimes remained on folder title only. Manual mark-unread via context menu **does** work.

---

# BUG MAIL-020 — Duplicate send toast (legacy + global)

Severity: P1  
Area: Mail / Send UX / Notifications  
Status: FIX APPLIED / AWAITING MANUAL VERIFY

Evidence: manual runtime screenshot 2026-08-11 — black center toast + white right toast both «Отправка письма…» on one Send.

Root cause: `UndoSendToast` (store `undoVisible`, black center) mounted beside `SendFeedbackToast` (CustomEvent `velo-send-feedback`); orchestrator also called `showSendFeedback({ title: "Отправка письма…" })` at `sending`.

Fix applied:
- Removed `UndoSendToast` from `App` / `ThreadWindow` (legacy stub returns null).
- `SendFeedbackToast` is the single global channel: store phases (queued+undo → sending → reconciling) + terminal CustomEvent after `clear()`.
- Orchestrator no longer emits progress CustomEvents while active; terminal success/error after clear only.
- Regression: orchestrator + `SendFeedbackToast` tests (one send → no duplicate «Отправка письма…» event; one toast DOM).

---

# BUG AUTH-004 — Yandex verification-code OAuth flow unusable in desktop UI

Severity:
P1

Area:
Unified Yandex Auth / Disk / Tracker

Status:
**FAIL / BLOCKER FOR DISK+TRACKER E2E** — code fix applied (prefer Mail-style localhost); **WAITING FOR YANDEX CONFIG** before retest

Observed (manual + screenshot, 2026-08-11 evening):
- After Disk/Tracker «Выдать доступ», embedded Yandex ID shows «Код подтверждения» + code.
- Office360 has no code input; code is not auto-captured; OAuth view hard to dismiss → user trapped.

Root cause (code + Graphify + client info):
- `authorizeYandexServices` hardcoded `redirectUri: https://oauth.yandex.ru/verification_code` (OOB / screen-code).
- That forced CEF overlay scrape path (`usesCefScreenCode`) instead of Mail’s `open_oauth_login_window` + `http://localhost:17248` callback server.
- Service OAuth app previously used legacy test Client ID `69e59ec6…` («диск тест», verification_code only).
- **Canonical managed client:** `9a7396c327984bd6afc75debf275850f` («Office360», callback `http://localhost:17248`, Disk+Tracker scopes).

Fix applied (app code):
- Service OAuth uses `YANDEX_DESKTOP_REDIRECT_URI` = `http://localhost:17248` (same as Mail).
- DEFAULT_YANDEX_SERVICE_CLIENT_ID → `9a7396c3…`; legacy `69e59…` migrated away on read.
- CEF/verification_code path: Escape / closed / route-change cancel + safer oauth-code payload parse (fallback only).
- Tests: redirect must not be `verification_code`; desktop redirect helpers.

Yandex Console (canonical already set by user):
- App: Office360 service client `9a7396c327984bd6afc75debf275850f`
- Redirect URI: `http://localhost:17248`
- Scopes: `cloud_api:disk.read/write` (+ info/app_folder), `tracker:read/write` — confirmed via public client-info
- No client secret in logs.

Do **not** treat Disk/Tracker auth as PASS until runtime QA after console change.

---

# BUG AUTH-005 — OAuth callback port 17248 already in use

Severity:
P1

Area:
Yandex OAuth lifecycle / Disk / Tracker

Status:
**FIX APPLIED** — awaiting fresh `tauri dev` retest (port free at diagnosis time)

Observed:
After AUTH-004 localhost redirect, Disk showed English bind failure on port 17248.

Root cause:
`start_oauth_server` holds TcpListener until success/timeout (~300s). Closing OAuth window / failed Yandex page (no localhost hit) settles JS `Promise.race` but **does not cancel** the Rust accept loop → stale bind → next «Выдать доступ» fails.

Fix:
- `stop_oauth_server` + cancel oneshot; window Destroyed / `close_oauth_login_window` signal cancel
- frontend `finally` always stops listener
- new start cancels previous (single active flow)
- bind error → `oauth_callback_port_in_use:{port}` + RU via `formatOAuthCallbackBindError`

Port owner at diagnosis (2026-08-11 ~20:02): **none** (FREE) — leftover session already gone after prior tauri crash.

---

# BUG TRACKER-001 — Tracker duplicate initialize / HTTP 429

Severity:
P1

Area:
Tracker / rate-limit

Status:
**FIX APPLIED / AWAITING MANUAL VERIFY**

Observed (after tauriFetch CORS fix):
UI: «Превышен лимит запросов к Яндекс Трекеру…» (mapped HTTP 429).

Root cause:
1. `useEffect(initialize)` depended on `loadTrackerData` which depended on filter state → every filter change = full myself+metadata+search.
2. Dev StrictMode doubled cold-open init without in-flight dedupe.
3. No Retry-After / cooldown → retry storm risk.

Fix (GORGDEV2, 2026-08-11 evening):
- Initialize only on mount/`accountId`; filters → issues search only (+ assignee debounce).
- Account-scoped session cache + in-flight dedupe for myself/queues/statuses/priorities.
- 429: parse Retry-After (seconds / HTTP-date), fallback 30s, block further Tracker calls, UI cooldown + disabled refresh.
- Regression tests: StrictMode one init, filter→search only, cooldown no network.

Runtime retest:
Wait for server cooldown → one `npm run tauri dev` → open Tracker once → expect ~5 Tracker calls in first 10s.

Commit/push: **not done**

---

# BUG TRACKER-002 — Tracker writes 403 `tracker_forbidden`

Severity:
P0

Area:
Tracker / authorization / license

Status:
**FIX APPLIED / AWAITING MANUAL VERIFY** — ROOT CAUSE = LICENSE READ-ONLY; CODE BUG = UX ONLY (misleading `tracker_forbidden` / «Обновить доступ»). Session `trackerAccessMode=READ_ONLY`, banner, writes disabled; reads preserved.

Environment:
GORGDEV2 · org manual `8493916` · read API PASS · service OAuth client `9a7396c327984bd6afc75debf275850f`

Diagnosis (2026-08-11 ~21:40 ICT):
- Stored scopes include `tracker:read` + `tracker:write` (token NOT stale for write scope).
- OAuth app info includes both Tracker scopes.
- `GET /v3/myself` → `hasLicense: true` (does **not** imply write).
- `PATCH /v3/issues/TRACKER-8` and `POST /v3/issues` → **403** with body:
  «В режиме просмотра нельзя создавать, редактировать и удалять объекты. Чтобы снять ограничения, подключите тариф с Трекером»
- Matches web banner / docs «режим Чтение» ([access#readonly](https://yandex.ru/support/tracker/ru/access#readonly)).
- Comment/upload further writes **not** hammered after edit+create confirmed same class.

Root cause class:
**C + D/F** — Tracker view/read-only access for user/org (tariff or admin «Чтение»), **not** missing `tracker:write` OAuth.

UX patch (2026-08-11):
- Detect view-mode from 403 payload (`tracker_read_only`), not status alone.
- Session `READ_ONLY` until restart / account change / manual refresh.
- Banner + disable create/edit/status/priority/comment/upload; no «Обновить доступ» for this case.
- Split 403: `tracker_read_only` | `tracker_permission_denied` | `tracker_org_forbidden` | `tracker_auth_expired` (401).

Manual verify:
1. Open Tracker on org in view mode → after any write attempt, banner appears, writes disabled, list/open still work.
2. Manual refresh clears mode and allows re-probe.
3. Org with full Tracker tariff → writes work (no false READ_ONLY).

Code bug (transport/headers):
**NO** for 403 itself.

UX bug:
**YES** — all 403 mapped to «Нет доступа к выбранной организации…» (`tracker_forbidden`); should be read-only license copy + disable write controls; do **not** offer «Обновить доступ».

Next:
Admin: full Tracker access / paid seats for user or org → then retest writes. Optionally implement read-only UX (separate step).

---

# BUG TRACKER-003 — Empty status/priority filter labels

Severity:
P1

Area:
Tracker / UI

Status:
OPEN

Observed:
`<select>` options for statuses/priorities have `value` (e.g. `open`, `blocker`) but **empty** visible text (`item.display` blank). Only «Все статусы» / «Все приоритеты» readable. Confirmed CDP: 28 empty status + 7 empty priority options.

---

# BUG TRACKER-004 — Status/priority filters ineffective

Severity:
P1

Area:
Tracker / filters

Status:
OPEN

Observed:
Selecting status=`open` keeps mixed open+closed list (8 rows). Priority=`blocker` likewise does not restrict to blockers. Local text search still works. Assignee string probe did not narrow list.

Notes:
May share root with filter payload shape vs Tracker API and/or empty labels UX. No fix in this pass.

---

# BUG TRACKER-005 — Issue detail missing metadata fields

Severity:
P2

Area:
Tracker / issue detail

Status:
OPEN

Observed:
Panel shows key, summary, description, priority button, transitions, attachments section, comments section. **Not shown:** author, assignee, createdAt, updatedAt, deadline (API fields exist on `TrackerIssue` type / get issue).

---

# BUG TRACKER-006 — Attachments not downloadable/openable

Severity:
P2

Area:
Tracker / attachments

Status:
OPEN

Observed:
Attachment names render as plain `div` text (e.g. TRACKER-7 `image.png` ×2). No link/button for download/open. Upload path blocked by TRACKER-002 (403). plugin-http FormData upload not exercised.

---

# BUG TRACKER-007 — Create issue title-only prompt

Severity:
P2

Area:
Tracker / create UX

Status:
OPEN

Observed:
«Создать задачу» → `window.prompt("Название задачи")` only. No UI for description / assignee / priority (even when write ACL allows). Write currently blocked by TRACKER-002.

---

## ID scheme

| Prefix | Area |
|---|---|
| MAIL- | Mail / Outbox / Scheduled / Sync |
| CAL- | Calendar |
| MSG- | Messenger |
| NOTIF- | Notifications |
| UI- | UI / empty states / polish |
| I18N- | Localization |
| SEC- | Security |


---

# BUG MSG-HYBRID-001 — Messenger provider tabs do not switch (Yandex widget missing)

Severity:
P1

Area:
Messenger / Efim hybrid port

Status:
CLOSED / PASS — fix verified runtime 2026-08-11 (~22:45 ICT)

Class:
Efim port bug — tab click only toggled provider filter; did not set `selectedProviderId`

Environment:
`GORGDEV2-EFIM-INTEGRATION` (post-`3c592fe` working tree) / Tauri + CDP

Reproducibility:
was 1/1 FAIL → PASS after fix

Observed (before fix):
Opening Мессенджеры shows MAX panel. Clicking tabs «Яндекс» / «Telegram» leaves the same MAX session-token UX.

Observed (after fix):
Tabs MAX ↔ Яндекс switch. NEEDS ACCESS shows CTA «Разрешить доступ». Communications consent can complete.

Evidence:
CDP tab retest + Hub RU labels; manual consent completed by user.

Notes:
Widget usability after CONNECTED tracked separately as **MSG-HYBRID-002**.

---

# BUG HUB-HYBRID-001 — Account Hub grant status English labels

Severity:
P2

Area:
Account Hub / i18n UX

Status:
CLOSED / PASS — RU i18n via `translateText` verified runtime 2026-08-11

Class:
Efim port UX polish

Observed (before):
Grant rows showed English `CONNECTED` / `NEEDS ACCESS`.

Observed (after):
«Подключено» / «Требуется доступ» on Hub; no Client ID/Secret leak; `check:i18n` 0 missing.

Evidence:
CDP Hub probe `#/settings/yandex360` — RU matches only; English grant tokens absent.

---

# BUG MSG-HYBRID-002 — Yandex Messenger widget stuck loading after communications consent

Severity:
P1

Area:
Messenger widget / runtime mount

Status:
OPEN

Class:
Efim hybrid / runtime mount (not diagnosed this checkpoint)

Environment:
`GORGDEV2-EFIM-INTEGRATION` / Tauri desktop / after MSG-HYBRID-001 fix

Reproducibility:
manual runtime 1/1 (screenshot 2026-08-11)

Actual:
- communications consent completed
- Yandex tab selectable
- loader renders indefinitely
- widget/iframe content does not appear

Expected:
After CONNECTED communications grant, Yandex Messenger widget mounts and becomes usable.

Evidence:
Manual runtime screenshot 2026-08-11 — Yandex tab selected, endless spinner, no messenger UI.

Hypotheses (not confirmed):
iframe/widget bootstrap · CSP · widget script · session initialization · mount event · host sizing · network

Notes:
Do not start automatic diagnosis in checkpoint freeze; next session owns MSG-HYBRID-002.
