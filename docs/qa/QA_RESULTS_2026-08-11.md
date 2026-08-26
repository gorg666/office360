# OFFICE 360 MANUAL QA — 2026-08-11

Checklist source: `docs/qa/yandex-corp-mail-manual-qa-2026-08-11.md`  
Branch: `office360-mail-workflow`  
Mode: observe + evidence only (no code fixes)

## Environment

| Field | Value |
|---|---|
| branch | `office360-mail-workflow` |
| HEAD | `8f5b6ac` |
| runtime | Tauri desktop (Windows) — live manual QA |
| Windows version | Windows 10/11 build `10.0.26200` |
| Office360 version | `0.4.21` (`package.json` / `src-tauri/Cargo.toml`) |
| test account type | Yandex corporate mail (IMAP/SMTP) — details not recorded |
| backend/account state | Yandex account connected (A1 PASS; no secrets stored) |
| test start time | 2026-08-11 ~05:15 Asia/Bangkok (UTC+7) |
| secrets | **not stored** (no email/password/token in this file) |

## Summary

| Metric | Count |
|---|---|
| PASS | 1 (A1 initial connect only; lifecycle NOT verified) |
| FAIL | 1 (A2 — Calendar) + send UX retest FAIL (MAIL-008/009/010) |
| BLOCKED | A3 deferred until AUTH-001 + MAIL-003 + MAIL-010 closed |
| NOT TESTED | remaining checklist items |
| P0 | AUTH-001, MAIL-003, MAIL-004, MAIL-010 (+ MAIL-001/002 CLOSED) |
| P1 | CAL-001, AUTH-002, MAIL-005, MAIL-008 |
| P2 | MAIL-006, MAIL-007, MAIL-009, UI-001 |
| P3 | 0 |

> Update this table as results arrive. Bugs live in `BUG_BACKLOG_2026-08-11.md`.

---

## Mail

### A. Account connect

#### A1 — OAuth corporate Yandex
- **Status:** PASS (initial OAuth authorization / account creation only)
- **Expected:** After Yandex consent, redirect to localhost callback; Tauri accepts response; account/token saved; UI leaves "Подключение..."
- **Actual:** Embedded Yandex ID WebView; callback accepted; account added. **SESSION LIFECYCLE NOT VERIFIED** — later access_token rejected (`expired_token` / IMAP AUTHENTICATIONFAILED); refresh → `400 invalid_client` / Wrong client secret; OAuth WebView can remain blank; send failed without clear UX.
- **Evidence:** Manual retest 2026-08-11 (~05:38) initial connect PASS; post-connect lifecycle FAIL (see AUTH-001, AUTH-002, MAIL-003)
- **Notes:** MAIL-001 + MAIL-002 remain CLOSED (callback + login_hint fixed). Do not treat A1 as end-to-end OAuth session PASS.

#### A2 — Scope guard (runtime capabilities)
- **Status:** FAIL
- **Expected:** With saved Yandex grant: profile + IMAP + Calendar usable; SMTP may defer to send test
- **Actual:** PROFILE PASS · IMAP PASS · CALENDAR FAIL · SMTP DEFERRED TO SEND TEST → **A2 FAIL** (Calendar)
- **Evidence (no tokens):**
  - **PROFILE:** After A1, account row has email, display_name, `avatar_url` (Yandex avatars host) → `login:email` / `login:info` / `login:avatar` used at connect. Live re-probe of *stored* access_token → `login.yandex.ru/info` **401** `expired_token` (not `insufficient_scope`).
  - **IMAP:** Post-A1 Tauri logs: `imap.yandex.ru:993` `auth_method=oauth2`, `IMAP SELECT INBOX: exists=1768`, raw fetch Parsed; also Sent/Drafts. Live re-probe with same stored access_token → `AUTHENTICATIONFAILED` (stale token). `oauth_granted_scopes` in DB = NULL (config strings not proof).
  - **CALENDAR:** `calendars`=0, `calendar_events`=0; `caldav_principal_url` / `caldav_home_url` null; settings `calendar_enabled=false`. Live CalDAV `PROPFIND https://caldav.yandex.ru/` with stored token → **401** (OAuth/Bearer). Refresh `POST oauth.yandex.ru/token` → **400** `invalid_client` / Wrong client secret (`oauth_client_secret` empty on account). No successful CalDAV response → **cannot confirm `calendar:all`**.
  - **SMTP:** No send performed → **DEFERRED TO SEND TEST** (not A2 FAIL by itself).
- **Notes:** A2 FAIL is Calendar-only for capability gate. Related observation (not counted as A2 scope miss): access_token dead while `token_expires_at` still far future → app `ensureFreshToken` may not refresh; refresh needs client secret not stored. See CAL-001.

#### A3 — Manual IMAP / app password fallback
- **Status:** NOT TESTED
- **Expected:** Inbox syncs after manual IMAP setup
- **Actual:** —
- **Evidence:** —
- **Notes:** —

### B. Mail core

#### B1 — Inbox sync
- **Status:** NOT TESTED
- **Expected:** Messages appear in Inbox
- **Actual:** —
- **Evidence:** —
- **Notes:** Also track latency / manual refresh / restart (see Incoming detail)

#### B2 — Send
- **Status:** FAIL (manual retest after MAIL-004…007 fix); **fix applied for MAIL-008/009/010 — pending retest**
- **Expected:** Delivered; one Outbox pending; opens on click; appears in Sent; final success toast only then
- **Actual:** Duplicate Outbox entries; Outbox click dead; toast «Письмо отправлено» but Sent empty (MAIL-008, MAIL-009, MAIL-010)
- **Evidence:** Manual Tauri retest 2026-08-11 ~06:16
- **Notes:** Do not advance QA checklist until retest PASS; A3 still blocked

---

## Session log addition

| Time | Event |
|---|---|
| ~06:16 | Send UX retest FAIL — MAIL-008/009/010 opened; stay on send pipeline |
| ~06:30 | MAIL-008/009/010 fix applied (dedupe, Outbox open, Sent reconciliation toasts); unit tests + cargo/tsc; **manual retest required** |

#### B3 — Sent folder
- **Status:** NOT TESTED
- **Expected:** Message present in Yandex Sent and Office360 Sent
- **Actual:** —
- **Evidence:** —
- **Notes:** Split Yandex vs Office360 if mismatch

#### B4 — Reply / Forward
- **Status:** NOT TESTED
- **Expected:** Correct recipients, subject, thread, Sent state
- **Actual:** —
- **Evidence:** —
- **Notes:** Cover Reply, Reply All, Forward separately if possible

#### B5 — Draft autosave
- **Status:** NOT TESTED
- **Expected:** Draft persists (watch for IMAP duplicates DEF-03)
- **Actual:** —
- **Evidence:** —
- **Notes:** —

### C. Outbox / Scheduled

#### C1 — Offline → Outbox
- **Status:** NOT TESTED
- **Expected:** Operation appears in Outbox queue
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### C2 — Outbox Retry
- **Status:** NOT TESTED
- **Expected:** Retry available on failed items
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### C3 — Outbox Cancel / Delete
- **Status:** NOT TESTED
- **Expected:** Document absence (DEF-09 expected: no Cancel/Delete)
- **Actual:** —
- **Evidence:** —
- **Notes:** Confirm UI inventory only

#### C4 — Scheduled Send on Yandex
- **Status:** NOT TESTED
- **Expected:** Likely FAIL — hardcoded Gmail client (DEF-02)
- **Actual:** —
- **Evidence:** —
- **Notes:** Do not demo as working

### D. Attachments / DnD

#### D1 — Attachment picker > 24MB
- **Status:** NOT TESTED
- **Expected:** Block / warn
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### D2 — Composer DnD > 24MB
- **Status:** NOT TESTED
- **Expected:** Likely bypass (DEF-13)
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### D3 — DnD message → label / Starred / Spam
- **Status:** NOT TESTED
- **Expected:** Likely silent no-op on IMAP (DEF-05)
- **Actual:** —
- **Evidence:** —
- **Notes:** —

### Mail detail — Incoming
- **Status:** NOT TESTED
- Letter exists in Yandex: —
- Appears in Office360: —
- Latency: —
- Manual refresh required: —
- After restart: —
- Correct folder: —
- Unread state: —
- **Evidence:** —
- **Notes:** If present in Yandex but missing in Office360 → separate bug

### Mail detail — Outgoing
- **Status:** NOT TESTED
- Send from Office360: —
- Delivered to recipient: —
- In Yandex Sent: —
- In Office360 Sent: —
- After refresh/restart: —
- **Evidence:** —
- **Notes:** —

### Mail detail — Reply flows
- **Status:** NOT TESTED
- Reply: —
- Reply All: —
- Forward: —
- Thread preserved: —
- Recipients: —
- Subject: —
- Sent state: —
- **Evidence:** —
- **Notes:** —

### Mail detail — Folder sync
- **Status:** NOT TESTED
- Inbox: —
- Sent: —
- Drafts: —
- Archive: —
- Trash: —
- **Evidence:** —
- **Notes:** Mark N/A if feature not implemented

### E5 — Disk
- **Status:** **FAIL / BLOCKED (AUTH-004)** — not PASS
- **Expected:** «Выдать доступ» → Yandex consent → window closes → Disk loads (no verification code UX)
- **Actual:** verification_code / trapped OAuth view (pre-fix); code now prefers `http://localhost:17248` like Mail — **needs Yandex Console redirect + retest**
- **Evidence:** Screenshot AUTH-004; Graphify + `authorizeYandexServices` hardcoded OOB redirect
- **Notes:** Do not mark Disk/Tracker E2E auth PASS until AUTH-004 closed

### E5b — Tracker
- **Status:** **FAIL / BLOCKED (AUTH-004)** — same service OAuth path as Disk
- **Expected:** Same as Disk Target UX
- **Actual:** Same blocker
- **Evidence:** Shared `authorizeYandexServices`
- **Notes:** —

---

## Notifications

#### N1 — New mail notification (app active)
- **Status:** NOT TESTED
- **Expected:** Windows/Tauri notification for new mail
- **Actual:** —
- **Evidence:** —
- **Notes:** Test via Tauri runtime, not plain Chromium

#### N2 — New mail notification (minimized / background)
- **Status:** NOT TESTED
- **Expected:** Notification still fires
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### N3 — Messenger message notification (if available)
- **Status:** NOT TESTED
- **Expected:** Notification or documented N/A
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### N4 — Calendar event notification (if implemented)
- **Status:** NOT TESTED
- **Expected:** Notification or documented N/A
- **Actual:** —
- **Evidence:** —
- **Notes:** —

---

## Calendar

#### CAL1 — Load calendars
- **Status:** NOT TESTED
- **Expected:** Real calendars from backend
- **Actual:** —
- **Evidence:** —
- **Notes:** Mark MOCK if fallback UI only

#### CAL2 — Load events
- **Status:** NOT TESTED
- **Expected:** Events from real backend
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL3 — Day / Week / Month views
- **Status:** NOT TESTED
- **Expected:** Views render correct events
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL4 — Create event
- **Status:** NOT TESTED
- **Expected:** Persists on backend and reloads
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL5 — Edit event
- **Status:** NOT TESTED
- **Expected:** Changes persist
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL6 — Delete event
- **Status:** NOT TESTED
- **Expected:** Removed on backend and UI
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL7 — Timezone
- **Status:** NOT TESTED
- **Expected:** Correct local display
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### CAL8 — Recurring events (if supported)
- **Status:** NOT TESTED
- **Expected:** Recurrence behaves correctly or N/A
- **Actual:** —
- **Evidence:** —
- **Notes:** —

---

## Messenger

#### M1 — Chat list
- **Status:** NOT TESTED
- **Expected:** Chats load
- **Actual:** —
- **Evidence:** —
- **Notes:** Mark MOCK if decorative

#### M2 — Open chat
- **Status:** NOT TESTED
- **Expected:** Chat opens
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M3 — History load
- **Status:** NOT TESTED
- **Expected:** History loads
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M4 — Send message
- **Status:** NOT TESTED
- **Expected:** Message sent to real backend
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M5 — Receive message
- **Status:** NOT TESTED
- **Expected:** Incoming message appears
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M6 — Unread state
- **Status:** NOT TESTED
- **Expected:** Unread counts/state correct
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M7 — Avatars in messenger
- **Status:** NOT TESTED
- **Expected:** Avatar or fallback
- **Actual:** —
- **Evidence:** —
- **Notes:** —

#### M8 — Empty / error states
- **Status:** NOT TESTED
- **Expected:** Clear empty/error UX
- **Actual:** —
- **Evidence:** —
- **Notes:** —

---

## Localization

#### L1 — Russian UI primary surfaces (checklist E2)
- **Status:** NOT TESTED
- **Expected:** Main screens in RU
- **Actual:** —
- **Evidence:** —
- **Notes:** Collect English leftovers below — do not translate in this task

### Localization findings

| current | location | expected RU | evidence |
|---|---|---|---|
| — | — | — | — |

---

## UI / Polish

#### UI1 — Empty state when no message selected
- **Status:** NOT TESTED
- **Expected:** Pleasant placeholder (future P2 task — do not implement now)
- **Actual:** —
- **Evidence:** screenshot path (local only if sensitive)
- **Notes:** Record UX issue as P2 in backlog after observe

#### UI2 — Avatars on several messages/contacts (checklist E1)
- **Status:** NOT TESTED
- **Expected:** Avatar or clear fallback; note failures
- **Actual:** —
- **Evidence:** —
- **Notes:** Record: missing for whom / fallback / network / broken URL / delay / after restart

#### UI3 — General polish notes
- **Status:** NOT TESTED
- **Expected:** —
- **Actual:** —
- **Evidence:** —
- **Notes:** —

---

## Security (read-only)

See `docs/qa/SECURITY_TRIAGE_2026-08-11.md`.

- npm audit total: **12** (critical **2**, high **6**, moderate **2**, low **2**)
- `npm audit fix` **not** run
- Dependencies **not** updated

---

## Session log

| Time | Event |
|---|---|
| ~05:15 | QA_RESULTS / BUG_BACKLOG / SECURITY_TRIAGE created; awaiting A1 |
| ~05:21 | A1 FAIL — localhost:17248 ERR_CONNECTION_REFUSED; MAIL-001 opened; OAuth fix in progress |
| ~05:40 | MAIL-001 fix applied (oauth.rs + oauthFlow.ts + gmail/auth.ts); awaiting manual retest with listener LISTENING before browser |
| ~05:50 | MAIL-002 opened (login_hint invalid_request); Yandex OAuth moved to in-app WebView `yandex-oauth`; login_hint optional; awaiting manual retest |
| ~05:38 | A1 PASS — embedded Yandex OAuth; MAIL-001 PASS; MAIL-002 PASS; account added |
| ~06:16 | B2 retest FAIL — MAIL-008/009/010 |
| ~06:30 | MAIL-008/009/010 fix applied — pending retest |
| ~07:00 | MAIL-011…015 + UI-002/003 fix applied (Outbox reconcile, context menu, titles, unread, folder tree, sync measure) — **manual retest required**; bugs NOT closed |
| ~07:45 | Scope polish: folderTree canonical only; Outbox FAILED «Не отправлено»; Sidebar Labels≠IMAP duplex; context capability helper; tests — **AWAITING MANUAL VERIFY**; no PASS; IDLE not implemented |
| ~08:00 | MAIL-016 Outbox ПКМ; MAIL-017 image thumbs; NOTIF-001 native WinRT+AUMID (no PowerShell path) — **FIX APPLIED / AWAITING MANUAL VERIFY**; no Calendar/Messenger |
| ~08:15 | Full RU localization pass: i18n dict 835 keys, `check:i18n` = 0 missing, errors/dates/plurals/notifications; audit → `docs/qa/LOCALIZATION_AUDIT_2026-08-11.md`. **Runtime DOM/Tauri Latin scan NOT done → localization NOT PASS** |

---

## Localization (2026-08-11)

| Metric | Value |
|---|---|
| BEFORE EN UI candidates | ~275–305 |
| AFTER `check:i18n` missing | **0** |
| Dict keys | 835 |
| Runtime Latin scan | **NOT RUN** |
| Product localization status | **AWAITING MANUAL / RUNTIME VERIFY** (do not PASS) |

Details: `docs/qa/LOCALIZATION_AUDIT_2026-08-11.md`

Do **not** start Calendar/Messenger/A3 from this pass.

---

## FINAL MAIL RUNTIME QA — 2026-08-11 (~18:15–18:30 ICT)

| Field | Value |
|---|---|
| branch | `GORGDEV2` |
| HEAD | `f95b3cf` |
| runtime | `npm run tauri dev` + WebView2 CDP (`9222`) |
| account | Yandex OAuth connected (username redacted) |
| code changes | **none** (observe-only) |
| commit/push | **not done** |

### Checklist

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Outbox / Send | **PARTIAL** | Self-test `QA-FINAL-*` delivered; appears in **Отправленные** without restart; **Исходящие** empty after send. Intermediate «ровно 1 в Outbox» + final toast timing **not observed** (send too fast / toast gone). |
| 2 | Attachments | **PARTIAL / FAIL lean** | Attachments library lists JPG/PNG (emoji 🖼, not raster thumbs). Click→enlarged preview / download / broken fallback **not confirmed** in this pass. |
| 3 | Windows notifications | **BLOCKED** | App stayed foreground during agent CDP; OS toast sender/icon/deep-link **not observed**. |
| 4 | Read / Unread | **PARTIAL** | Unread visually distinct (`Unread email…` aria + accent row). ПКМ «Отметить непрочитанным» **PASS**. Auto mark-read on open **not reliably confirmed** (aria stayed Unread; reading pane subject sometimes missing). Unread badge moves (e.g. 465→462). |
| 5 | Mail folders | **PARTIAL** | All system folders present (RU). Custom IMAP under «Папки» present. **FAIL:** `Исходящие` appears **twice** (system + custom). Expand/collapse toggles **not found** (`aria-expanded` empty). |
| 6 | Context menu | **PARTIAL** | Inbox / Sent / custom folder ПКМ **PASS** (RU actions). Outbox empty → no message ПКМ (**N/A**). Menu contains English **Mute**. |
| 7 | Search | **PARTIAL** | Placeholder **«Поиск в почте»** PASS; no `from:`/`to:`/`has:attachment` in ordinary UI. Functional filter for `QA-FINAL` **not confirmed** via CDP (controlled input). |
| 8 | Localization runtime | **FAIL (residuals)** | English system strings: `Unread email from…`, `email from…`, `N unread emails`, menu **Mute**, `(No subject)`, Attachments relative times `7h ago` / `11h ago` / `1mo ago`. User content/filenames excluded. |
| 9 | Foreground sync latency | **PARTIAL** | Self-send visible in **Вся почта** within ~1–2 min of checks; **not** in Primary «Входящие — Основные». Clean Yandex→Inbox stopwatch **not** obtained → **MAIL-SYNC not opened**. Model still: FG 10s / BG 120s / focus sync / no IDLE. |
| 10 | Docs | **DONE** | This section + BUG_BACKLOG + `.ai/CURRENT_STATE.md` |

### MAIL VERDICT

**PARTIAL** — send/Sent path works; several prior fixes still incomplete at runtime; localization residuals confirmed; notifications blocked.

### NEXT

Do **not** start Calendar until blockers below are closed or explicitly waived. Fix track: I18N-001, MAIL-018 (dup Исходящие), read-on-open, attachment preview retest, NOTIF-001 manual.

---

## MAIL-020 — Duplicate send toast (2026-08-11 evening)

| Field | Value |
|---|---|
| branch | `GORGDEV2` |
| severity | P1 |
| status | **FIX APPLIED / AWAITING MANUAL VERIFY** |
| commit/push | **not done** |

| Check | Result |
|---|---|
| Root cause identified | PASS — dual producers: UndoSendToast + showSendFeedback |
| Legacy path disabled | PASS — UndoSendToast unmounted; stub null |
| Canonical single toast | PASS — SendFeedbackToast store+event |
| Unit regression | PASS — composeSendOrchestrator + SendFeedbackToast tests |
| Manual send retest | **REQUIRED** |

Do **not** start Calendar from this fix.

---

## TRACKER-001 — Rate-limit / duplicate initialize (2026-08-11 evening)

| Field | Value |
|---|---|
| branch | `GORGDEV2` |
| severity | P1 |
| status | **FIX APPLIED / AWAITING MANUAL VERIFY** |
| commit/push | **not done** |

| Check | Result |
|---|---|
| Root cause | PASS — filter→full init + StrictMode double + no cooldown |
| Init once / filter→search only | PASS (unit) |
| Session metadata cache + in-flight dedupe | PASS (unit) |
| 429 Retry-After + cooldown block | PASS (unit) |
| Manual cold-open request count (~5) | **REQUIRED** after server cooldown |

Org `8493916`: assumed stored; validity **unknown** until `/v3/myself` = 200.

---

## TRACKER FUNCTIONAL QA (2026-08-11 ~21:40 ICT)

| Field | Value |
|---|---|
| branch | `GORGDEV2` |
| mode | RUNTIME PASS observe-only — **no code fixes**, no commit/push |
| org | **manual `8493916`** (confirmed valid for **read**; do not change) |
| runtime | `npm run tauri dev` + CDP `9222` |
| account | `korotkov.g@office-360.ru` (no tokens logged) |
| Graphify | NOT NEEDED (bugs filed from runtime; no code change) |

### Verdict matrix

| Area | Result | Notes |
|---|---|---|
| Issue list | **PASS** | Queue `TRACKER` («Главное рабочее пространство»): 8 issues; key/status/summary/priority/assignee visible; open vs closed by status text; scroll (`scrollHeight` > `clientHeight`) |
| Filters | **FAIL** | Local text search **PASS**. Status/priority selects change value but list stays mixed (8 rows). Empty option labels (28 status / 7 priority). Assignee text filter did not narrow list in CDP probe. Second queue absent (only TRACKER + «Мои задачи») |
| Issue open | **PASS** (partial fields) | Opened TRACKER-8 (open), TRACKER-7 (closed), TRACKER-4 (closed + unassigned). Description + priority button + comments/attachments sections. **Missing in UI:** author, assignee, created/updated, deadline |
| Edit | **BLOCKED** | Writes → HTTP **403** `tracker_forbidden` (earlier session probe: update/create/comment/upload) |
| Create | **BLOCKED** | Same 403; create UX is title-only `prompt` (description/assignee/priority not in dialog) |
| Comments | **BLOCKED** | Write 403; read section present (empty on sampled issues) |
| Attachments | **PARTIAL / BLOCKED write** | Read: TRACKER-7 shows `image.png` ×2 as plain text. **No download/open control**. Upload blocked 403. FormData path not exercised |
| Rate-limit | **PASS** (client) | Aggressive CDP earlier hit 429 → RU cooldown message + refresh disabled; after wait list recoverable. Clean functional pass ended with `banner=null`. Filter churn did not show metadata storm in this pass (resource timing limited for plugin-http) |
| Localization/UI | **FAIL** (labels) | Shell RU OK («Яндекс Трекер», filters, comments/attachments). **P1:** blank status/priority option texts. Detail metadata gaps. Attachments not actionable |

### Auto org

- Manual org **`8493916`** confirmed valid for Tracker **read** (myself/queues/issues).
- **Do not change org** in this pass.
- Auto-detection UX → separate follow-up against this real org.

### Bugs filed

- TRACKER-002 (P0) write 403  
- TRACKER-003 (P1) empty filter labels  
- TRACKER-004 (P1) status/priority filters ineffective  
- TRACKER-005 (P2) missing detail metadata  
- TRACKER-006 (P2) attachments no download/open  
- TRACKER-007 (P2) create = title-only prompt  

**Overall VERDICT: PARTIAL** — read/list/open usable; filters/labels/detail UX fail; all writes blocked by 403.


---

## EFIM HYBRID RUNTIME QA — 2026-08-11 ~22:25 ICT

| Field | Value |
|---|---|
| branch | `GORGDEV2-EFIM-INTEGRATION` |
| HEAD | `3c592febce7596892678b525661c6e9631d8b6a8` |
| base | `2aaa905` (protected) |
| mode | MANUAL RUNTIME SMOKE — observe only, **no code changes**, no commit/push/merge |
| runtime | `npm run tauri dev` + CDP `9222` |
| account | active `*@office-360.ru` (second local account `*@yandex.ru` used only for switch) |
| evidence | `docs/qa/evidence/hybrid-runtime-2026-08-11/` (local screenshots + JSON; no secrets) |
| Graphify | NOT NEEDED (no code fix this pass) |

### Matrix

| Area | Result | Evidence / notes |
|---|---|---|
| Startup | **PASS** | App up `#/mail/inbox`; IMAP sync alive; account auto-loaded; no forced OAuth |
| Mail auth | **PASS** | Inbox loads; no 17248 conflict observed; no manual refresh setup |
| Sidebar icons | **PASS** | CDP: all 7 services found, Lucide SVG 18×18, opacity 1, no emoji; RU labels. Screenshots `01-sidebar-mail.png`, `11-disk.png` |
| Mail unread badge | **PASS** | Start 8 → open unread 7 → `markThreadRead(false)` 8 → `markThreadRead(true)` 7; live without restart |
| Outbox badge | **PASS** | Исходящие badge hidden at 0 (no fake count) |
| Tasks badge | **PASS** | Задачи badge `1` preserved |
| Disk | **PASS** | `#/disk` lists file + quota; `hasYandexServiceAuth=true`; client const `9a7396c3…`; no Client ID prompt |
| Tracker | **PARTIAL** | `#/tracker` loads; stored org `8493916`; no CORS/429 on open; workspace UI present; issue list empty in this session; empty `<option>` labels remain (**TRACKER-003**); filters not re-validated as PASS (**TRACKER-004**); no write attempted |
| Messenger | **FAIL / BLOCKED** | Provider tabs MAX/Яндекс/Telegram do not change panel (stuck on MAX UX). No Yandex widget iframe. Hub: communications **NEEDS ACCESS** (consent not completed this pass). Bot token not leaked. Unread badge: **NOT IMPLEMENTED / NO SOURCE** |
| Telemost smoke | **PASS** | `#/telemost` UI + meeting card; CEF host surface present; after «Новая видеовстреча» `office360-cef-subprocess` processes observed; no separate Passport wall in main UI this pass |
| Account Hub | **PASS** (UX note) | Human grants: Почта / Диск и Трекер / Мессенджер и Телемост; Core+Work CONNECTED; Communications+Admin NEEDS ACCESS; no Client ID/Secret in UI. **P2:** raw English `CONNECTED` / `NEEDS ACCESS` strings |
| Account switch | **PASS** | 2 accounts present; switch office-360.ru → yandex.ru; unread badge 7 → `99+`; restored |

### Bugs from this pass

- **MSG-HYBRID-001** (P1) — CLOSED/PASS after fix (tabs + communications CTA)
- **HUB-HYBRID-001** (P2) — CLOSED/PASS after RU i18n status labels
- **MSG-HYBRID-002** (P1) — OPEN — Yandex Messenger widget stuck loading after communications consent

### VERDICT (initial hybrid smoke @ `3c592fe`)

**PARTIAL** — core mail + Disk + sidebar/badges + Telemost smoke + Hub structure OK; Messenger blocked/failed at tab/consent stage; Tracker remaining known gaps. **NOT READY TO MERGE BACK TO GORGDEV2**.

---

## EFIM HYBRID CHECKPOINT — 2026-08-11 ~22:50 ICT

| Field | Value |
|---|---|
| branch | `GORGDEV2-EFIM-INTEGRATION` |
| previous HEAD | `3c592fe` |
| mode | Fix MSG-HYBRID-001 + HUB-HYBRID-001; freeze/docs; **do not fix MSG-HYBRID-002**; commit+push integration branch only |
| Graphify | NOT NEEDED (freeze/push) |

### Integration matrix (current)

| Area | Result |
|---|---|
| Mail | **PASS** |
| Sidebar icons | **PASS** |
| Mail unread badge | **PASS** |
| Outbox badge | **PASS** |
| Tasks badge | **PASS** |
| Disk | **PASS** |
| Tracker | **PARTIAL** (TRACKER-003/004 etc. known) |
| Telemost smoke | **PASS** |
| Account Hub | **PASS** (RU: «Подключено» / «Требуется доступ») |
| Messenger | **PARTIAL / P1** — tabs+consent OK; widget loader stuck (**MSG-HYBRID-002**) |

### Messenger follow-up (manual)

| Check | Result |
|---|---|
| MSG-HYBRID-001 tabs MAX ↔ Яндекс | **PASS** |
| NEEDS ACCESS → CTA «Разрешить доступ» | **PASS** |
| Communications consent completes | **PASS** (manual) |
| After CONNECTED: usable Yandex Messenger UI | **FAIL** — endless spinner; widget/iframe content not visible |

### Open blocker

**MSG-HYBRID-002** (P1 OPEN) — after successful communications consent, Yandex tab remains on infinite loader; expected: widget mounts and becomes usable. Hypotheses only (not diagnosed): iframe/widget bootstrap, CSP, widget script, session init, mount event, host sizing, network.

### Overall

**INTEGRATION PARTIAL** — **NOT READY TO MERGE BACK TO GORGDEV2**.
