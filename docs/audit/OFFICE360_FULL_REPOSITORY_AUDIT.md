# Office360 full repository audit

Audit ID: `REPO-AUDIT-001`

Date: 2026-08-25 (Asia/Bangkok)

Repository: `gorg666/office360`

Audited feature HEAD: `df3611bc37508c626bc94d5bdaad7a3a7b3374d5`

Audited main HEAD: `88ee55d6e3234f9de527e6a2ddc6664fd46e1c21`

## Scope and method

This was a read-only code, history, branch, build, configuration, dependency, security and architecture audit. The only repository change made by the audit is this document. No branch was merged, deleted, reset, rebased or force-pushed; no dependency, migration, production configuration, database or credential was changed.

Evidence sources:

- fresh `git fetch --all --prune`, local and remote refs, ancestry, tree and patch comparisons;
- GitHub API/CLI for repository defaults, PR #4, branch protection, rulesets, workflows and recent runs;
- Graphify query over the existing `graphify-out/graph.json` (7,156 nodes);
- targeted source inspection and static searches;
- npm/Cargo dependency inspection and read-only `npm audit`;
- executable validation on both `origin/main` and `feat/calendar-yandex360`.

Secrets were never printed. Content scanning reported file names/categories only. The local file whose name suggests a PAT backup was deliberately not opened.

## Executive summary

The feature branch is build-healthy and has a green local test gate. PR #4 is technically mergeable and has no Git conflict with `main`, but GitHub still reports `REVIEW_REQUIRED` and no approval; it must not be merged until the protected-branch review requirement is satisfied.

`origin/main` is buildable but not test-healthy: TypeScript, frontend production build and `cargo check` pass, while full Vitest fails in 8 files / 11 tests. The feature branch passes the corresponding full suite and changes the affected CalDAV/OAuth paths, so no other feature branch needs to be merged before PR #4.

The repository has three high-priority integration/configuration risks:

1. GitHub's actual default branch is the stale `chore/office360-plugin-installed-refresh`, 97 commits behind `main`. Clone defaults, new PR defaults and default-branch-aware automation therefore point at the wrong line.
2. `origin/macos/arm64` defines migration v34 as `accounts.yandex_uid`, while PR #4 defines v34 as Calendar time semantics. The macOS branch cannot be merged directly after Calendar without an explicit migration reconciliation/renumber gate.
3. On checkout of `origin/main`, local ignored-state differences expose an untracked `.mcp.json.bak-github-pat-*` artifact plus `.tmp-efim*` directories. The file was not read and is not tracked, but it should be handled as a potentially live credential artifact outside Git.

There is no evidence that PR #4 would delete or conceal unique commits from other branches. The macOS and two standalone Yandex auth commits remain separate and must be reviewed later. Merging PR #4 first is the recommended repository order after approval.

## Direct answers

- **Is main currently healthy?** Partially. It compiles and builds, but its full Vitest gate is red (8 files / 11 tests), there is no validating PR CI, and the latest Release Please run failed.
- **Is PR #4 safe to merge after approval?** Yes, with conditions: re-fetch/recheck `origin/main`, require the configured approval, keep merge-commit strategy, and do not fold in the macOS branch during that merge.
- **Should another unmerged branch be merged first?** No. `GORGDEV2` and `GORGDEV2-EFIM-INTEGRATION` are already ancestors of PR #4. macOS/auth work requires independent review and the v34 collision must be resolved first.
- **Could PR #4 hide/drop another branch's work?** No by ancestry/content. It does not contain the macOS line or standalone `efim-11-08-auth`, but those refs remain intact. Later integration may conflict; it is not silent loss.
- **Is the default-branch misconfiguration dangerous?** Yes (P1). It changes clone/PR defaults and caused Release Please to operate on the obsolete branch. Workflows explicitly triggered on `main` still target `main`, and no GitHub Pages site was found.

## Git topology

### Repository state

| Item | Result |
|---|---|
| Current branch | `feat/calendar-yandex360` |
| Feature HEAD | `df3611bc37508c626bc94d5bdaad7a3a7b3374d5` |
| `origin/main` | `88ee55d6e3234f9de527e6a2ddc6664fd46e1c21` |
| Feature divergence from main | 48 ahead / 0 behind before this audit commit |
| Local branches | 10 |
| Origin branch refs | 59 (excluding the symbolic alias) |
| Active in last 30 days | 14 |
| Stale over 30 days | 45 |
| Fully merged into main | 28 |
| Unmerged with commits outside main | 31 |
| Local working tree before audit doc | clean |
| GitHub default branch | `chore/office360-plugin-installed-refresh` |
| Local `origin/HEAD` | same stale branch; not a local-only issue |

### PR #4

| Field | Value |
|---|---|
| Base / head | `main` <- `feat/calendar-yandex360` |
| Head SHA | `df3611bc37508c626bc94d5bdaad7a3a7b3374d5` |
| State | open |
| Mergeable | yes |
| Merge state | blocked |
| Review decision | `REVIEW_REQUIRED` |
| Reviews | 0 |
| Required approvals | 1; stale approvals dismissed |
| Required status checks | none |
| PR status checks | none |

### Significant branch matrix

`Behind` and `unique` are relative to `origin/main` at the audit SHA.

| Branch | Behind | Unique | State / purpose | Risk | Recommendation |
|---|---:|---:|---|---|---|
| `origin/main` | 0 | 0 | protected integration line | Tests red; not GitHub default | KEEP |
| `origin/feat/calendar-yandex360` | 0 | 48 | Calendar CAL-101…131 plus PEOPLE-001 | Approval/CI gate only | MERGE after approval |
| `origin/GORGDEV2` | 0 | 5 | auth/tracker/mail stabilization | Entirely ancestor of PR #4 | ARCHIVE after PR merge |
| `origin/GORGDEV2-EFIM-INTEGRATION` | 0 | 7 | Yandex services/hybrid navigation | Entirely ancestor of PR #4 | ARCHIVE after PR merge |
| `origin/efim-11-08-auth` | 0 | 2 | standalone Yandex OAuth grants | Unique vs PR #4; overlaps auth files | KEEP for semantic review |
| `origin/macos/office360-stabilization` | 0 | 12 | early macOS/Telemost stabilization | Five commits outside PR #4 | ARCHIVE in favor of arm64 after review |
| `origin/macos/arm64` | 0 | 22 | current macOS/Telemost line | **Migration v34 collision** | KEEP; blocked from merge |
| `origin/macos/x86_64` | 0 | 22 | same content/history as arm64 | Exact duplicate tree/ref target | ARCHIVE; one canonical macOS ref only |
| `origin/GORGDEV` | 343 | 1 | i18n/mail precursor | Already ancestor of feature, heavily behind | ARCHIVE |
| `origin/baseline/office360-2026-08-11` | 60 | 1 merge-only | historical mail workflow baseline | Multiple merge bases | KEEP as tagged/baseline history, not merge |
| `origin/chore/office360-plugin-installed-refresh` | 97 | 0 | agent/plugin tooling checkpoint | Wrong GitHub default | DELETE only after default is corrected |
| `origin/release-please--branches--chore/office360-plugin-installed-refresh--components--office360` | 97 | 1 | orphan release PR branch | Generated against wrong default | DELETE after confirmation |
| `origin/release-please--branches--main--components--velo` | 150 | 1 | old release automation branch | Stale generated branch | DELETE after confirmation |
| `origin/office360-mail-workflow` | 345 | 0 | old mail workflow | Fully merged | ARCHIVE/delete after confirmation |
| `origin/office360-files-section` | 369 | 1 | attachment files view | Old unique commit, large drift | ARCHIVE; semantic cherry-pick only if still wanted |
| `origin/office360-i18n` | 361 | 1 | old mail navigation translations | Old unique commit; newer i18n exists | ARCHIVE |
| `origin/office360-linux-alt-first-run` | 363 | 1 | Linux/Yandex IMAP first run | Old unique fix | KEEP for targeted review, not direct merge |
| `origin/my_feauture` | 369 | 2 | files commit plus message `test` | Abandoned/unclear experiment | DELETE after confirmation |
| `origin/feat/jmap-email-provider` | 283 | 2 | JMAP experiment | One patch already equivalent; one unique | ARCHIVE until JMAP is rescheduled |
| `origin/feat/local-ai-ollama-lmstudio` | 207 | 2 | local AI work | Implementation patch equivalent, docs unique | ARCHIVE; docs review only |
| `origin/fix/release-workflow-and-v1` | 188 | 3 | alternate release consolidation | One patch equivalent, two unique | KEEP for CI/release redesign review |
| `origin/feat/auto-advance-after-removal` | 167 | 2 | old mail UX experiment | Large drift | ARCHIVE |
| Dependabot branches (9) | 150–152 | 1 each | automated dependency updates | Stale, superseded versions must be re-audited | DELETE after confirmation; recreate fresh |

Fully merged feature/fix lines include epic 01 and 04–13, account diagnostics support, compose polish, folder/search/security/contact fixes, the old release branch, `efim-10-08`, Telemost isolation, and the original Office360/API/mail-workflow branches. They carry no commits outside `main` and are cleanup candidates after owner confirmation.

### Same content under different histories

- `origin/main` and `origin/fix/telemost-cef-profile-isolation` have the same tree; the fix branch is fully merged.
- `origin/macos/arm64` and `origin/macos/x86_64` point to the same commit/tree.
- `origin/feat/epic-03-sync-health-offline-queue` and `origin/fix/epic-03-review-hardening` have the same tree; the latter is merged and the former has a redundant unique-history commit.
- `origin/chore/office360-plugin-installed-refresh` and `origin/feat/epic-02-account-diagnostics` have the same tree but different branch meaning.
- `origin/release0.1.0` and `origin/fix/compose-popout-production-polish` have the same tree.
- Patch comparison shows an implementation patch in JMAP and local-AI histories is already equivalent to feature history, while each branch retains one unique feature/docs patch.

## Commit history audit

The latest approximately 200 reachable commits plus all feature history were reviewed.

Findings:

- `0b57b03` is a stash-side commit named `untracked files on GORGDEV...` with 236 files / about 164k inserted lines. It is reachable from `refs/stash`, not a branch tip. Do not treat it as product history or merge it.
- `e8df6a2` is another stash/WIP merge object deleting about 8k lines. It is not a remote branch commit.
- Large integration commits (`88ee55d`, `12d615d`, `eda4589`, `182f2e5`, `2aaa905`) mix many modules and deserve semantic rather than file-level conflict resolution.
- Explicit revert pairs exist for startup navigation and OAuth Chromium behavior (`82bb83f`, `969420a`). Later fixes should be checked against intent before cherry-picking old branches.
- Ambiguous messages include `test`, Russian one-line MVP descriptions, and legacy non-Conventional commits. Release Please logs show that many historical messages cannot be parsed as Conventional Commits.
- No accidentally tracked executables, databases, logs, temp directories, screenshots or Graphify output were found at the audited feature HEAD.
- Largest tracked binary assets are expected app icons/marketing images; no suspicious archive or installer was found in HEAD.

## Migration matrix

The feature chain is continuous, unique by number and ordered 1…39. Main ends at v33.

| Version | Module / purpose | Introducing commit |
|---:|---|---|
| 1 | Initial mail/account/settings schema | `9d6a847` |
| 2 | Message FTS | `9d6a847` |
| 3 | List-Unsubscribe storage | `9d6a847` |
| 4 | Filters/templates/image allowlist | `9d6a847` |
| 5 | Pins, AI cache, categories, initial Calendar, contacts/attachments | `9d6a847` |
| 6 | Follow-ups/notifications/unsubscribe/bundles | `e955299` |
| 7 | Send-as aliases | `83dd109` |
| 8 | Smart folders | `1d703c9` |
| 9 | Mail auth results | `decd8d8` |
| 10 | Muted threads | `bf38828` |
| 11 | Phishing scan cache/allowlist | `cbdf214` |
| 12 | Quick steps | `482c7be` |
| 13 | Contact notes | `33558b1` |
| 14 | IMAP/SMTP provider support | `3ed7623` |
| 15 | IMAP OAuth2 fields | `b042a12` |
| 16 | IMAP username override | `da56279` |
| 17 | Pending operations/local drafts | `ec384fa` |
| 18 | Writing profiles/tasks | `c75dfc5` |
| 19 | CalDAV calendars | `08e05ff` |
| 20 | IMAP attachment repair/reset | `2c40b51` |
| 21 | Repeat corrected attachment resync | `2c40b51` |
| 22 | Smart label rules | `986a7ae` |
| 23 | Invalid-certificate setting | `a5f7cec` |
| 24 | Remote-image default update | `b91a0fe` |
| 25 | Task event/Telemost fields | `b91a0fe` |
| 26 | Account diagnostics | `dc77fc0` |
| 27 | Queue observability | `2c714c3` |
| 28 | Folder metadata/reference health | `9df4b28` |
| 29 | Contact aggregates/identities | `62fd750` |
| 30 | Calendar invitations/RSVP | `d12a0e6` |
| 31 | Rich address book/directories/lists | `282cb86` |
| 32 | OAuth granted scopes | `7c5f80c` |
| 33 | Repair duplicate OAuth scopes branch collision | `7e78976` |
| 34 | Calendar time semantics/occurrence identity | `1b11cf3` |
| 35 | Calendar sync coverage/projection lifecycle | `e9de6da` |
| 36 | Calendar reminder semantic envelope | `46dcb4a` |
| 37 | Calendar access/provider presence | `4be8742` |
| 38 | Durable reminder deliveries | `7839344` |
| 39 | Durable iTIP action/delivery ledger | `c559ccc` |

### Migration health

- Feature: no gaps or duplicate version numbers; v34–v39 executable fresh/existing/legacy verifiers pass.
- Main and GORGDEV/auth/early macOS lines: continuous through v33.
- **Collision:** `origin/macos/arm64`/`x86_64` v34 adds `accounts.yandex_uid`; PR #4 v34 adds Calendar time fields. Direct merge is prohibited until the macOS migration is assigned a new post-v39 number and tested, with explicit migration approval.
- v32 and v33 intentionally repeat `oauth_granted_scopes`; the runner tolerates duplicate-column errors and has a preflight repair. This is documented technical debt rather than a number collision.
- Historical migrations are not uniformly append-only: v20/21 delete attachment/sync rows, v24/27/31 update existing rows, and startup repair can delete `_migrations.version=18` before rerun. These operations are not part of Calendar v34–v39.
- `withTransaction` serializes JS writes but does not issue a true pooled SQLite `BEGIN/COMMIT`; multi-statement atomic rollback is not guaranteed.

## Architecture map

| Layer | Primary areas | Audit summary |
|---|---|---|
| Shared UI | `src/components`, router, Zustand stores | React/Tauri desktop UI; several very large components |
| Mail | composer, email actions, Gmail/IMAP providers | Provider factory exists; legacy direct DB imports remain widespread |
| Calendar | domain, providers, sync coordinator, iTIP/reminders | Strong provider-neutral contracts and extensive tests on feature |
| People | People domain/search/providers/PeoplePicker | Unified across Mail composer, Calendar participants and ACL |
| Accounts/Auth | account DB, OAuth flows, provider readiness | Multiple Yandex auth paths and credential compatibility fallbacks |
| Sync/queues | Gmail sync manager, IMAP sync, Calendar coordinator, pending operations | Separate owners and locks exist; global Mail flight serializes accounts |
| SQLite/cache | `src/services/db`, Tauri SQL | Central connection/write queue, but not true SQL transaction atomicity |
| Native | `src-tauri/src` | IMAP/SMTP/OAuth/notifications/platform integration; sparse Rust tests |

### Cross-layer and god-module findings

- Graphify identifies `getDb()` and `useAccountStore` as the strongest cross-community bridges.
- Production components/stores directly import DB modules in many paths (Mail list/actions, composer, contacts, settings, Calendar list, queues). This is established architecture debt and complicates atomicity/testing.
- Largest modules by lines: `SettingsPage.tsx` 2,374; `MessengerSideStrip.tsx` 1,886; `ContactsPage.tsx` 1,670; `db/contacts.ts` 1,475; `migrations.ts` 1,398; `imapSync.ts` 1,341; `AddImapAccount.tsx` 1,328; `caldavProvider.ts` 1,043.
- Provider-name checks are justified in factories/adapters/discovery/auth (`providerFactory`, Yandex work-account detection, free/busy adapter). UI leaks remain in Settings, AccountSwitcher, AccountRepairCenter, MoveToFolderDialog and Yandex service pages; capability/descriptor mapping should replace behavior checks where practical.
- Calendar maintains one domain model for Google/CalDAV/Yandex. No second Calendar attendee UI model was found.

### PEOPLE-001 verification

- Mail `AddressInput`, Calendar `ParticipantAuthoring`, and `CalendarAclDialog` all use the shared `PeoplePicker` and `PersonIdentity` model.
- Search/dedupe/provider fallback logic is centralized under `src/services/people`.
- Remaining identity-entry candidates outside PEOPLE-001: TaskDetailModal required/optional participants are comma-separated email strings; Tracker assignee remains a raw filter string. Account setup email fields are configuration identities and should not use PeoplePicker.
- Telemost uses email arrays to open composer/invite actions; that is a transport boundary, not an authoring picker, but should continue to normalize before send.

## Sync and concurrency

- Mail sync owns a module-global `syncPromise`, pending account set and adaptive 10s-visible/120s-hidden timer. It prevents overlapping runs but serializes all accounts behind one flight.
- CalendarSyncCoordinator owns per-account delta flights and per-account/range flights. It is the only identified Calendar cursor consumer, handles invalid cursors, and fences duplicate refreshes.
- CalDAV provider session lifecycle has its own single-flight/reuse boundary.
- Queue processor and startup/foreground triggers call the shared Mail sync entry point rather than creating a second Mail cursor owner.
- SQLite writes use a JS promise queue and bounded busy retries. This orders one WebView's writes but does not provide durable transaction rollback across pooled calls or across other processes/WebViews.
- 124 production `console.error`, 99 `console.warn` and 17 `console.log` call sites create noisy observability. Several settings writes intentionally swallow rejection (`catch(() => {})`), and reminder/UI operations include fire-and-forget paths. No literal empty `catch {}` block was found, but compact promise catches hide persistence failure.
- No static evidence of an infinite retry loop was found; retry counts/backoff are bounded in the audited queue/migration/network paths.

## CI and build findings

### GitHub configuration

- Four active workflows exist: Release Please, Build & Release, Build & Package, Update Homebrew Tap.
- There is no pull-request validation workflow for TypeScript, Vitest, Calendar TZ, frontend build or Rust.
- `main` protection requires one approval but zero checks; repository rulesets list is empty.
- Latest run (Release Please at `88ee55d`) failed. It parsed many non-Conventional historical messages, selected the stale default branch, created a release branch, then failed because Actions could not create/approve PRs.
- No GitHub Pages configuration or releases were found.

### Feature validation

| Check | Result |
|---|---|
| TypeScript `npx tsc --noEmit` | PASS |
| Calendar migration v34–v39 verifiers | PASS |
| Targeted Calendar | PASS — 75 files / 673 tests |
| Targeted Mail/provider/IMAP/composer | PASS — 38 files / 459 tests |
| Full Vitest | PASS — 268 files / 2,575 tests |
| TZ matrix | PASS — 15 files / 186 tests in each of UTC, Europe/Moscow, America/New_York, Australia/Lord_Howe |
| Frontend production build | PASS |
| `cargo check` | PASS with two existing unused-variable warnings |

### Main validation

| Check | Result |
|---|---|
| TypeScript | PASS |
| Frontend production build | PASS |
| `cargo check` | PASS with two unused-variable warnings |
| Full Vitest | **FAIL — 8 files / 11 tests; 1,873/1,884 passed** |

Main failures include CalDAV create/update/delete call contracts, Gmail OAuth event mocking, token rotation/Yandex client-secret resolution and expected Yandex scope defaults. A clean `npm ci`/CI reproduction is still required because main was tested with the feature workspace's installed dependency tree; the red result must not be reported as a green main gate.

### Test gaps and hygiene

- No normal CI gate runs any test command.
- Calendar migration and TZ scripts are separate from `npm test`; a future CI workflow must invoke them explicitly.
- Feature full suite logs React `act(...)` warnings and a late `Smart label error: Closing rpc while fetch was pending`, indicating leaked async/noisy tests even though assertions pass.
- Rust has 16 source files but inline tests in only 2 (`commands.rs`, `smtp/client.rs`); IMAP/OAuth/native lifecycle commands rely mainly on TS mocks and compile checks.
- Current source/test file counts are far above the `130 test files` still claimed in `docs/development.md`.

## Dependency health

- package, package-lock root and Tauri versions align at `0.4.21`.
- npm and Cargo each have a single canonical lockfile for the app; landing has its own expected npm lockfile.
- `cargo tree --duplicates` produced no duplicate crate report.
- Full npm audit: 12 advisories (2 critical, 6 high, 2 moderate, 2 low).
- Production-only npm audit: 4 advisories (1 critical, 1 high, 2 moderate):
  - `seroval` critical through `@tanstack/react-router`;
  - `linkify-it` high and `markdown-it` moderate through transitive content tooling;
  - direct `dompurify@3.3.1` moderate, material because Mail renders hostile HTML.
- Direct dev advisories include Vite/Vitest; they are local-tool exposure, not shipped runtime, but must be updated before enabling network-exposed dev/test UI.
- Candidate unused direct TipTap extension packages show zero literal imports (`extension-color`, `highlight`, `link`, `text-align`, `text-style`, `underline`, `@tiptap/pm`), although some may be re-exported/used by StarterKit. Confirm with bundle/dependency tooling before removal.
- Multiple AI vendor SDKs are shipped to the frontend and instantiated with browser-enabled credentials, increasing bundle and credential attack surface.

## Security and privacy findings

### P0 local hygiene

- A checkout of main exposed untracked `.mcp.json.bak-github-pat-*`, `.tmp-efim/` and `.tmp-efim-bin/` paths because main lacks the feature ignore additions. The possible credential backup was not opened. It must be rotated/removed or moved to an approved secure store by the owner, then covered by an ignore rule on the integration line.

### Tracked repository scan

- No tracked `.env`, private key, certificate, token database or local SQLite file was found; `.env.example` is intentionally tracked.
- No sensitive historical path addition/removal was found for `.env*`, private-key and DB patterns.
- Pattern hits in source were form fields and redaction/test fixtures, not literal production secrets.
- Debug bundle tests explicitly verify password/client-secret redaction.

### Runtime data boundaries

- Account and AI secrets are AES-GCM encrypted before SQLite storage, but the encryption key is a plaintext `office360.key` file in AppData rather than OS keychain/DPAPI/Keychain/Secret Service.
- Legacy compatibility can return raw values when decryption fails. Logs report the error but do not print the credential value.
- AI SDK clients run in the WebView with `dangerouslyAllowBrowser`; decrypted API keys necessarily exist in frontend memory.
- `src/services/messengers/credentials.ts` stores messenger bot tokens in plaintext `localStorage`.
- Messenger UI also caches up to 250 conversations and 1,000 messages in localStorage. This is PII/message-content exposure outside the encrypted SQLite path.
- SQLite stores Mail bodies, Calendar iCalendar/attendee data and contact vCards as required for local-first operation; database-at-rest encryption is not present.
- Calendar sync diagnostics use identifier redaction. No provider payload/token logging was found in the audited paths.

## Performance findings

- Feature production main chunk is 2,165.13 kB raw / 642.57 kB gzip; Vite emits the over-500-kB warning.
- Significant lazy chunks: Messenger 204.98 kB, Calendar 162.65 kB, Settings 124.41 kB, Help 104.08 kB.
- Mixed static/dynamic imports prevent intended splitting for DB/settings/task modules.
- Several UI components exceed 1,000 lines, increasing render blast radius and import coupling.
- Calendar attendee persistence avoids an attendee N+1 table; Calendar lists/ranges are grouped. No new Calendar N+1 regression was found.
- UI code performs full-array filtering in several high-volume views and stores; profiling is needed before assigning runtime impact.
- Mail global single-flight serializes all account syncs; safe for cursor ownership, potentially slow for many accounts.
- Messenger localStorage serializes large message arrays on each cache write.

## Dead code and generated artifacts

- `src/components/settings/SettingsAboutPanel.tsx` has no importer/name reference and is a dead-component candidate.
- Queue smoke code is reachable from `src/main.tsx` behind `VITE_QUEUE_SMOKE=1` or `?queueSmoke`; it is not dead, but it is development-only and creates a small production chunk.
- No tracked `dist`, `target`, coverage, Graphify, IDE metadata, logs, temp directories or OneDrive conflict artifacts were found at feature HEAD.
- `graphify-out/` is ignored and was used only as an audit index.
- Old remote branches, Dependabot refs and generated release branches are the largest cleanup surface; do not delete them before default-branch correction and owner confirmation.

## Documentation health

- Calendar model/runtime/final audit and PEOPLE-001 docs are current through 2026-08-24.
- `.ai/CURRENT_STATE.md` still declares `GORGDEV2-EFIM-INTEGRATION` as active and stops its detailed Calendar sequence around CAL-105/CAL-128; it is stale for the current branch/head.
- `docs/development.md` claims 130 test files, while the audited feature runs 268 test files.
- `docs/architecture.md` describes an earlier Tauri command/module count and understates Calendar/People/sync/native growth.
- QA/backlog documents dated 2026-08-11 contain open P0 statements that coexist with later feature fixes/audits; they need an explicit historical banner or reconciliation rather than silent deletion.
- Calendar final audit remains internally consistent for scoped Calendar parity; its `P0 none` statement is Calendar-scoped and must not be read as repository-wide health.

## Severity register

### P0

1. **Potential local credential backup** `.mcp.json.bak-github-pat-*` exists untracked when main is checked out. Do not inspect in automation; owner should rotate/secure/delete it deliberately.
2. **Migration v34 collision** between Calendar PR #4 and macOS branch blocks direct macOS integration.
3. **Main full test gate is red** (8 files / 11 tests). Main is buildable but cannot be called test-healthy.

### P1

1. GitHub default branch is stale and wrong.
2. No pull-request CI and no required checks; only review protection exists.
3. Four production npm advisories, including critical `seroval` and direct Mail-sanitizer advisories.
4. Plaintext messenger tokens and message/conversation PII in localStorage.
5. AppData encryption key is not OS-keystore-backed; SQLite is not encrypted at rest.
6. `withTransaction` is serialization without true SQLite rollback atomicity.
7. macOS and standalone auth branches carry unique work with broad overlap and no current integration plan.
8. Direct UI/store access to DB services and provider-name checks outside adapter/capability boundaries.
9. Very large components/services and 2.1 MB main bundle.
10. Release Please is currently broken by permissions/default-branch/history parsing.

### P2

1. Stale branches, duplicate refs, generated release branches and old Dependabot branches.
2. Stale current-state/development/architecture/QA documentation.
3. React `act` warnings, late async worker warning and expected-error log noise in tests.
4. Sparse Rust unit tests and no native integration CI.
5. Silent best-effort settings/cache writes and inconsistent user-visible error plumbing.
6. Dead `SettingsAboutPanel` candidate and likely unused/re-exported dependencies requiring confirmation.
7. Two Rust unused-variable warnings.

## Branch recommendations

### KEEP

- `main`;
- `feat/calendar-yandex360` until PR #4 merges;
- one canonical macOS line (`macos/arm64`) while collision is resolved;
- `efim-11-08-auth` until semantic comparison is complete;
- `fix/release-workflow-and-v1` as input to CI/release redesign;
- baseline branch only if the project intentionally keeps branch-based baselines (prefer an immutable tag).

### MERGE

1. PR #4 after approval and one final fetch/recheck.
2. No other branch before PR #4.
3. macOS/Telemost later, only after migration v34 is renumbered above current main max and conflicts are resolved semantically.
4. Standalone auth commits only if not superseded after PR #4/macOS review; prefer focused cherry-picks with tests over a branch merge.

### ARCHIVE

- GORGDEV/GORGDEV2/integration after PR #4;
- old epic/fix branches already fully merged;
- macOS stabilization and duplicate x86_64 ref once one canonical line remains;
- JMAP/local-AI/auto-advance/files/i18n/Linux experiments pending product decisions;
- old mail workflow and release0.1.0 history.

### DELETE after confirmation

- stale default plugin branch only after GitHub default is changed to `main` and all automation is rechecked;
- orphan release-please branches;
- merged epic/fix refs;
- stale Dependabot refs (recreate from current lockfiles);
- duplicate `macos/x86_64`;
- `my_feauture` and other abandoned experiments after owner sign-off.

## Recommended merge order

1. Secure/rotate the local PAT backup outside Git; do not make it part of a code PR.
2. Obtain the required approval for PR #4.
3. Re-fetch and confirm `origin/main` is unchanged; merge PR #4 with a merge commit.
4. Correct GitHub default branch to `main` under a separate authorized repository-admin change.
5. Add mandatory PR CI (TypeScript, full Vitest, Calendar migration/TZ, frontend build, cargo check).
6. Reconcile macOS migration v34 to a new post-v39 version, then integrate the canonical macOS branch.
7. Review the two standalone auth commits against the merged auth implementation.
8. Rebuild dependency-update branches from current main rather than merging stale Dependabot refs.

## Recommended cleanup order

1. Credential/local artifact hygiene and ignore policy.
2. Default branch and Release Please configuration.
3. Green main tests plus required CI.
4. Production dependency advisories, starting with `dompurify` and `seroval` chain.
5. Messenger credential/PII storage migration to encrypted/native storage.
6. macOS migration collision and branch consolidation.
7. Archive/delete merged, duplicate and abandoned branches after confirmation.
8. Split god modules and tighten UI -> service -> DB boundaries.
9. Bundle/code-splitting work and async test-noise cleanup.
10. Documentation/state reconciliation.

## Final verdict

`REPO-AUDIT-001: PASS` as an audit deliverable. The repository is not repository-wide P0-free: feature validation is green, but main tests, local credential hygiene and the latent macOS migration collision require explicit follow-up. PR #4 remains the correct first merge after approval; this audit does not merge it.
