# VELO / Office360 Mail QA Defects — June 2026

## Context

На встрече 01.06.26 была поставлена задача проверить почтовый workflow VELO / Office360 при переходе на Яндекс.Почту и корпоративную почту через IMAP/SMTP, найти 20 дефектов и подготовить их к защите на следующей встрече. Цель этого документа — зафиксировать подтверждённые технические и продуктовые риски, выделить самые сильные кейсы и предложить порядок исправлений.

## Environment

- Branch: `office360-mail-workflow`
- Current HEAD: `372a3c5` (`fix(mail): gate folder editing by provider capability`)
- Checks passed: `npx tsc --noEmit`, targeted Vitest suites, `cargo check`
- GitVerse sync: clean at the start of this documentation task

## What was checked

- Yandex OAuth / account setup
- IMAP/SMTP receive and send
- Compose standalone window
- Inline reply / forward
- Outbox / Sent / Scheduled
- Folders / labels
- Contacts and autocomplete
- Search / unread / smart folders
- Tray / notifications / shortcuts
- Localization (RU/EN)
- Documentation and development process

## Top 5 meeting-grade defects

### 1. Scheduled Send does not support Yandex/IMAP (DEF-02)

The scheduled-send worker always obtains a Gmail client instead of using the active account provider. A scheduled message created for Yandex/IMAP therefore cannot be sent through SMTP. This blocks an explicit corporate workflow and can leave an invisible failed record. Affected providers: Yandex, IMAP. Suggested fix: route scheduled sends through `EmailProvider`/`sendEmail`, or capability-gate the feature until supported.

### 2. Bulk actions bypass the provider abstraction (DEF-04)

Bulk Archive/Delete/Spam call Gmail APIs directly and remove messages from the UI before the remote call succeeds. For Yandex/IMAP this can show a false success while the server remains unchanged. Affected providers: Yandex, IMAP. Suggested fix: use the common email-action layer and keep optimistic state recoverable.

### 3. IMAP autosave can duplicate drafts (DEF-03)

IMAP APPEND creates a pseudo draft ID that cannot later be mapped to a server UID. Each autosave update may append another draft without deleting the previous one. Affected providers: Yandex, IMAP. Suggested fix: use UIDPLUS `APPENDUID` or resync the created draft before update/delete.

### 4. Notification actions can target the wrong message (DEF-17)

Reply/Archive actions use one global `lastNotificationContext`. When two notifications exist, acting on the older one may use the context of the newest message. Affected providers: all. Suggested fix: bind a stable notification ID to its own thread/account context.

### 5. Outbox content is stored unencrypted (DEF-06)

The offline queue stores the complete raw MIME payload, including body and attachments, in plaintext SQLite JSON. This is a material corporate data-at-rest risk. Affected providers: all. Suggested fix: encrypt queue payloads with an OS-protected key and document the storage model.

## Full list of 20 defects

### DEF-01 — Yandex OAuth defaults to login-only scopes

- **Severity:** High
- **Area:** Account setup / OAuth
- **Provider:** Yandex
- **Status:** confirmed from code; release configuration needs manual verification
- **Problem:** Without `VITE_YANDEX_OAUTH_SCOPES`, the application requests login scopes but not required IMAP/SMTP mail scopes.
- **Impact:** OAuth can complete, but the mail account cannot be saved as a working account.
- **Suggested fix:** Ship verified mail scopes in release configuration and add a startup/configuration diagnostic.
- **Meeting defense:** yes

### DEF-02 — Scheduled Send is Gmail-only

- **Severity:** Critical
- **Area:** Scheduled Send
- **Provider:** Yandex / IMAP
- **Status:** confirmed from code
- **Problem:** The scheduled worker calls `getGmailClient()` for every account.
- **Impact:** Scheduled Yandex/IMAP messages fail instead of using SMTP.
- **Suggested fix:** Send through the provider abstraction or hide the feature for unsupported providers.
- **Meeting defense:** yes

### DEF-03 — IMAP autosave can create duplicate drafts

- **Severity:** High
- **Area:** Compose / Drafts
- **Provider:** Yandex / IMAP
- **Status:** confirmed from code; needs manual server verification
- **Problem:** Generated IMAP draft IDs cannot be deleted or updated by UID, so autosave appends replacements.
- **Impact:** Multiple stale drafts accumulate and users can send the wrong version.
- **Suggested fix:** Capture `APPENDUID` or resolve the created draft through sync before updating it.
- **Meeting defense:** yes

### DEF-04 — Bulk Archive/Delete/Spam uses Gmail API directly

- **Severity:** High
- **Area:** Message actions
- **Provider:** Yandex / IMAP
- **Status:** confirmed from code
- **Problem:** Bulk handlers bypass `EmailProvider` and remove rows from the UI before Gmail-only calls complete.
- **Impact:** False success and server/client divergence for corporate mailboxes.
- **Suggested fix:** Use `archiveThread`, `trashThread`, and `spamThread` through the common action layer.
- **Meeting defense:** yes

### DEF-05 — Apply Label is a successful no-op on IMAP

- **Severity:** High
- **Area:** Labels
- **Provider:** Yandex / IMAP
- **Status:** confirmed from code
- **Problem:** Local `thread_labels` changes, while IMAP `addLabel/removeLabel` only logs a warning and returns success.
- **Impact:** Classification appears saved but is absent on the server and can disappear after sync.
- **Suggested fix:** Add `supportsMessageLabels` capability and hide/gate Apply Label for IMAP.
- **Meeting defense:** yes

### DEF-06 — Outbox stores full MIME payload in plaintext

- **Severity:** High
- **Area:** Offline queue / Security
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** `rawBase64Url`, including attachments, is serialized into `pending_operations.params` in ordinary SQLite.
- **Impact:** Anyone who can copy the profile database can recover queued corporate mail.
- **Suggested fix:** Encrypt queue payloads using an OS-keychain-protected key.
- **Meeting defense:** yes

### DEF-07 — Cached mail database is not encrypted at rest

- **Severity:** High
- **Area:** Storage / Security
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** Message bodies, FTS content, drafts, scheduled mail and metadata are stored in plain `office360.db`; only credentials are encrypted.
- **Impact:** Lost devices, profile backups or local access can expose corporate correspondence.
- **Suggested fix:** Adopt SQLCipher/encrypted storage or formally require and verify full-disk encryption.
- **Meeting defense:** yes

### DEF-08 — Outbox operations can remain stuck in `executing`

- **Severity:** High
- **Area:** Outbox / Reliability
- **Provider:** All
- **Status:** confirmed from code; crash scenario needs manual verification
- **Problem:** The processor selects only `pending`; no startup recovery resets stale `executing` rows after a crash.
- **Impact:** A message can remain “Sending…” forever and never be retried.
- **Suggested fix:** Add execution leases and reset stale rows during startup.
- **Meeting defense:** yes

### DEF-09 — Outbox has no Cancel/Delete action

- **Severity:** Medium
- **Area:** Outbox UX
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** Failed messages can be retried, but pending/failed messages cannot be cancelled or removed from the UI.
- **Impact:** An erroneous offline message may be sent automatically when connectivity returns.
- **Suggested fix:** Add confirmed Cancel/Delete actions that remove the queue entry safely.
- **Meeting defense:** yes

### DEF-10 — Scheduled messages have no management UI

- **Severity:** High
- **Area:** Scheduled Send UX
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** Records can be created and processed, but no visible list, failed status, edit or cancel flow consumes the scheduled-mail DB APIs.
- **Impact:** Users cannot review or stop future corporate messages.
- **Suggested fix:** Add a Scheduled view with status, edit, cancel and retry controls.
- **Meeting defense:** yes

### DEF-11 — Scheduled attachments can be assigned to the wrong record

- **Severity:** High
- **Area:** Scheduled Send / Attachments
- **Provider:** All
- **Status:** confirmed from code; concurrency needs manual verification
- **Problem:** The returned insert ID is ignored; attachments are written to the latest row for the account in a second query.
- **Impact:** Two compose windows can cross-attach confidential files to the wrong recipient.
- **Suggested fix:** Update by the ID returned from `insertScheduledEmail`, preferably in one transaction.
- **Meeting defense:** yes

### DEF-12 — Scheduled retry treats SMTP 5xx as transient

- **Severity:** High
- **Area:** SMTP retry
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** Any `5xx` code is classified as retryable, although SMTP 5xx normally represents a permanent rejection.
- **Impact:** Permanent failures can retry indefinitely without a visible final failure.
- **Suggested fix:** Reuse the shared network error classifier; normally retry 4xx and fail 5xx.
- **Meeting defense:** yes

### DEF-13 — Drag-and-drop bypasses the 24 MB attachment limit

- **Severity:** High
- **Area:** Compose / Attachments
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** File picker validates total size, while the drop handler reads and adds every file without validation.
- **Impact:** Large MIME payloads can exhaust memory or be rejected by SMTP.
- **Suggested fix:** Use one attachment validator for picker and drag-and-drop paths.
- **Meeting defense:** yes

### DEF-14 — Multi-file selection can exceed the total attachment limit

- **Severity:** Medium
- **Area:** Compose / Attachments
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** Each selected file is compared with the initial total; files accepted earlier in the same loop are not included.
- **Impact:** Two individually valid files can produce an oversized message.
- **Suggested fix:** Maintain an accumulated size during validation or validate the complete batch first.
- **Meeting defense:** yes

### DEF-15 — Attachment rejection is only logged to the console

- **Severity:** Medium
- **Area:** Compose UX
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** An oversized file is silently skipped with `console.warn`; there is no user-visible error.
- **Impact:** A user can send a message believing the required document is attached.
- **Suggested fix:** Show an inline error/toast with filename, reason and allowed limit.
- **Meeting defense:** yes

### DEF-16 — Removing an account has no confirmation

- **Severity:** High
- **Area:** Account settings
- **Provider:** All
- **Status:** confirmed from code
- **Problem:** The Remove button calls account deletion directly.
- **Impact:** One accidental click can remove local mail, drafts, scheduled records and account settings.
- **Suggested fix:** Add a confirmation dialog showing the account address and local-data consequences.
- **Meeting defense:** yes

### DEF-17 — Notification actions use the last global context

- **Severity:** High
- **Area:** Notifications
- **Provider:** All
- **Status:** confirmed from code; needs platform manual verification
- **Problem:** Notification Reply/Archive handlers read `lastNotificationContext` rather than the context of the clicked notification.
- **Impact:** Users may reply to or archive the wrong conversation.
- **Suggested fix:** Store and resolve context by notification ID/payload.
- **Meeting defense:** yes

### DEF-18 — Invalid IMAP dates are replaced with the current time

- **Severity:** Medium
- **Area:** IMAP sync / Sorting
- **Provider:** Yandex / IMAP
- **Status:** confirmed from code; malformed-date fixture needs manual verification
- **Problem:** A parsed date of zero is replaced with `Date.now()`.
- **Impact:** Old messages can jump to the top and distort date search and workflow priority.
- **Suggested fix:** Prefer IMAP INTERNALDATE/received timestamp and mark unknown dates explicitly.
- **Meeting defense:** yes

### DEF-19 — Composer contains untranslated Russian source strings

- **Severity:** Medium
- **Area:** Localization
- **Provider:** All
- **Status:** confirmed from code; English UI needs manual pass
- **Problem:** Attachment and Undo Send components contain Russian JSX strings without complete reverse translations.
- **Impact:** English locale displays mixed RU/EN UI and looks unfinished.
- **Suggested fix:** Keep English source strings in JSX and Russian translations in `i18n.ts`.
- **Meeting defense:** yes

### DEF-20 — Mail workflow documentation referenced a stale Outbox commit

- **Severity:** Low
- **Area:** Docs / Process
- **Provider:** All
- **Status:** confirmed from repository history
- **Problem:** The workflow spec referenced `01b5e47`, which is not in the current branch, instead of current commit `8ca5be2`; no consolidated known-issues document exists.
- **Impact:** Requirements, implementation and QA evidence are harder to trace during review.
- **Suggested fix:** Use current commit references and maintain a provider capability/known-issues matrix.
- **Meeting defense:** yes

## Already fixed

Commit `372a3c5` — `fix(mail): gate folder editing by provider capability`:

- Gmail/Google folder and label editing remains allowed.
- IMAP/Yandex create, rename and delete editing is capability-gated.
- Unsupported edit/delete actions are hidden; add actions are disabled with an explanation.
- Provider mapping and LabelEditor unit tests were added.

This fix does not implement IMAP/Yandex folder CRUD and does not resolve message-level Apply Label (DEF-05).

## Quick wins

- Introduce one attachment validator for picker and drop (DEF-13, DEF-14).
- Show a toast/inline error for rejected attachments (DEF-15).
- Add a confirmation dialog before account removal (DEF-16).
- Add `docs/known-issues.md` with a provider capability matrix (DEF-20).
- Reset stale `executing` Outbox operations on startup (DEF-08).
- Add Outbox Cancel/Delete controls (DEF-09).

## Needs manual verification

1. Yandex OAuth with the exact release scopes and client ID.
2. Scheduled Send through a real Yandex SMTP account.
3. IMAP draft duplication after several autosave cycles.
4. Bulk Archive/Delete/Spam on Yandex with server-state verification.
5. Reply/Archive actions with two simultaneously visible notifications.
6. Drag-and-drop of one oversized file and a multi-file oversized batch.
7. Composer and Undo Send in English locale.
8. Crash/restart while an Outbox operation is in `executing`.
9. SMTP 550 handling for a scheduled message.
10. Two simultaneous compose windows scheduling different attachments.

## Recommended implementation order

1. Provider capability and Gmail-only paths for Yandex/IMAP.
2. IMAP draft identity and update/delete reliability.
3. Outbox and Scheduled reliability, recovery and control surfaces.
4. Attachment validation and user feedback.
5. Notification action identity.
6. Yandex OAuth release configuration.
7. Corporate data-at-rest security.
8. UX, localization and documentation.

## Manual QA map

Run the scenarios in this order so that account setup problems do not invalidate later results:

1. **Account setup and credentials** — connect Yandex OAuth, then app-password/manual IMAP; verify IMAP and SMTP separately. Key files: `src/components/accounts/AddImapAccount.tsx`, `src/services/oauth/providers.ts`, `src/services/email/imapSmtpProvider.ts`.
2. **Core receive/send** — initial sync, delta sync, normal send, SMTP rejection, offline send and reconnect. Key files: `src/services/imap/imapSync.ts`, `src/services/emailActions.ts`, `src/services/queue/queueProcessor.ts`.
3. **Compose lifecycle** — standalone compose, cancel/close, autosave, send failure, inline reply/forward, attachments. Key files: `src/components/composer/Composer.tsx`, `src/components/email/InlineReply.tsx`, `src/services/composer/draftAutoSave.ts`.
4. **Outbox and Scheduled** — retry, crash recovery, cancellation expectations, scheduled Yandex send and failed status. Key files: `src/components/outbox/OutboxList.tsx`, `src/services/snooze/scheduledSendManager.ts`.
5. **Folders and message actions** — sync folders, bulk actions, move, Apply Label and capability-gated editing. Key files: `src/components/layout/EmailList.tsx`, `src/components/layout/Sidebar.tsx`, `src/services/email/providerCapabilities.ts`.
6. **Notifications and navigation** — tray compose/check mail, global shortcut, two-notification action identity, mailto deep link. Key files: `src/services/notifications/notificationManager.ts`, `src/services/deepLinkHandler.ts`, `src-tauri/src/lib.rs`.
7. **Search, contacts and localization** — unread counts, smart folders, autocomplete, local contact collection, RU/EN pass. Key files: `src/services/search/searchQueryBuilder.ts`, `src/services/db/contacts.ts`, `src/i18n.ts`.
