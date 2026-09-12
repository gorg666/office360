# OFFICE360 CURRENT STATE — REPO-AUDIT-002

Audit date: **2026-09-12, Asia/Bangkok**. Repository: `gorg666/office360` (public).

**REPO-AUDIT-002: PARTIAL.** Repository/code/Git/PR audit and executable frontend validation completed; fresh Tauri/cloud acceptance, native macOS build, exhaustive historical secret scan and full Cargo advisory scan are not claimed. This is a factual snapshot, not a production-readiness certificate.

**Finalize note (same day, no retest):** volatile Git/GitHub facts were reconfirmed after `git fetch --all --prune` and GitHub API reads. Unchanged: `origin/main=88ee55d`, Calendar `e3604e8`, Tasks `b71c80e`, macOS `2801704`, PR #4 OPEN with 4/4 required checks success, zero approvals, `mergeable_state=blocked` under `REVIEW_REQUIRED`. Open PRs remain #4 and #3. Branch protection still requires one approval + four named checks, strict. `af97141` remains local-only in the GitVerse `velo` clone. Heavy test/cargo/npm-audit matrices were **not** rerun; evidence under sibling `office360-audit-evidence-2026-09` is preserved.

## 1. Executive summary

- **Main: PARTIAL; test health RED.** Exact `origin/main = 88ee55d6e3234f9de527e6a2ddc6664fd46e1c21`: TypeScript/build pass; 10 reproducible assertions fail in four pre-existing suites. Ordinary cargo check needs missing CEF resources; CI-mode cargo check passes. This establishes a broken test gate, not a demonstrated production outage.
- **Calendar: READY within its provider-neutral release boundary, not merged.** `e3604e8`, 50 commits ahead / 0 behind main. Full coverage across initial run and recovery of worker-start failures: 268 files / 2575 tests pass. TZ 186 tests per zone ×4, v34–39 verifiers and build pass. PR #4 has all four required checks green, but zero approvals and `REVIEW_REQUIRED`.
- **People: READY for Calendar/Mail/ACL integration on the Calendar line, not main.** Tasks contains only a divergent `services/people/domain.ts` plus a separate organization-only picker. It does not contain the complete PEOPLE-001 implementation.
- **Tasks: BLOCKED for live use/integration.** `b71c80e`, 8 commits ahead / 0 behind main; all eight are pushed, no PR. TASKS-001…007 and callback fix exist. Targeted 16 files / 113 tests pass; its full suite retains main's 10 failures. Directory endpoint/token wiring and organization UI are code blockers in addition to configuration/entitlement concerns.
- **Runtime metadata:** primary has services credential records but no saved organization; organization task settings has zero rows, so no default queue. Secondary is bound to `8493916`. Both saved services scope strings omit `directory:read_users`. Credential presence does not prove freshness or validity.
- **Yandex organization support: PARTIAL overall.** Account-scoped `yandex_org_id` storage and TrackerPage single-org auto-discovery / manual-ID primitives exist, but the shared Settings/Tasks organization selector and primary persistence flow (ORG-001) are incomplete. TrackerPage manual input is BROKEN (`!orgId` hide-on-type). Do not label organization support as wholly NOT STARTED, and do not claim ORG-001 delivered.
- **macOS:** both architecture refs point to `2801704`, 23 ahead / 0 behind main. MIG-040 renumbering is present and pushed; v34 collision is resolved. Keep the platform line separate. Frontend tests/build pass after worker recovery; Windows-target cargo fails at macOS-specific `remove_data_store`; native macOS was not run.
- **CI protection has improved:** default is now main; four required checks, strict up-to-date and one approval are configured. PR-validation workflow is in PR #4, still absent from exact main. Release Please's last main run failed because Actions cannot create/approve PRs.
- **Security remains open:** app npm audit: 2 critical / 8 high / 4 moderate / 2 low; landing: 0 critical / 8 high / 3 moderate / 2 low. Rust lockfile contains known affected versions. No package was updated.
- **Local work:** primary repository has two branch-reachable commits absent from all fetched remotes (`12d615d`, `829df8e`) and three stashes. Separate GitVerse clone `velo` has unpushed `af97141`. Three old worktrees/clones report only Cargo.toml status noise with empty content diff. Main active worktree and Tasks worktree are clean.

### Scope and evidence rules

APOSTLE, project context/current state, secrets policy, project Graphify skill, README/development docs and relevant audit/Calendar/People/Tasks documents were consulted, then compared against Git and source. Graphify was queried first; graph vocabulary included calendar/people/task/oauth/migration/sync. Its August 27 snapshot is useful for Calendar/navigation, **stale for August 29 Tasks and later Telemost changes**; current source wins. No graph rebuild or architecture change was made.

Evidence levels throughout: **fresh code/Git**, **fresh automated**, **fresh local metadata**, **historical documented live**, **NOT RUN**, **external state unverified**. A historical live PASS is not a fresh September live PASS. Tests mock providers; they do not prove deployed endpoints, token grants, queue ACL or entitlement.

Only the requested audit Markdown is a product-repository change. Isolated audit worktrees, dependency installs from existing locks, build output and local evidence files were created for verification. No application DB migration, cloud write, OAuth grant change, deploy, merge, rebase, reset, force-push or branch deletion occurred. SQLite migration simulations used **in-memory databases only**. Credential SQL returned booleans; token/key contents were neither selected nor printed.

## 2. Git / branch topology

Snapshot before audit publication: **13 existing local branches + 62 origin branches** (excluding origin/HEAD). Audit preparation adds one local branch (14 local total); successful audit publication adds one origin branch (63 origin total). Some local and origin refs refer to the same logical line and must not be counted as distinct features.

| Baseline item | Verified value |
|---|---|
| Initial current worktree | `YALINUX360/velo-office360-api-ya-clean` |
| Current feature worktree branch / HEAD | `codex/efim-telemost-recovery-002` / `9f0a2309f51a1099529b24ce836d40c8294dff03` |
| Upstream anomaly | Tracks `origin/feat/design-001`, appears ahead 1, but exact tip also exists at `origin/codex/efim-telemost-recovery-002`; **not unpushed** |
| Local main branch | Absent; main is available as origin/main and isolated audit checkout |
| origin/main | `88ee55d6e3234f9de527e6a2ddc6664fd46e1c21` |
| origin/HEAD | Symbolic `refs/remotes/origin/main` |
| GitHub default branch | `main` |
| Remotes | origin → GitHub gorg666/office360; gitverse → mega_team/velo |
| Refresh | `git fetch --all --prune` succeeded; `git ls-remote --heads origin` matched queried feature tips |
| Audit base | Exact origin/main, separate `audit/office360-current-state-2026-09` |

`ahead` below is the exact number of commits absent from main, **not necessarily unique patches**. `behind` is main-only commits. `MERGED` means ancestry; squash/patch equivalence can require separate review. Categories and recommendations do not authorize deletion. Age and dates are shown to distinguish old experiments from active August feature work. Main remains canonical regardless of age.

### Complete local + origin inventory

| Branch | HEAD | Date | Ahead / behind main | Remote name exists | Tip pushed | PR | Category | Last commit / purpose | Recommendation |
|---|---|---|---:|---|---|---|---|---|---|
| GORGDEV | `f26a3da` | 2026-08-11 | 1 / 343 | YES | YES | #3 (base: old plugin branch) | STALE | feat(i18n): complete Russian localization pass | Review unique patches; no direct merge |
| GORGDEV2 | `2aaa905` | 2026-08-11 | 5 / 0 | YES | YES | NO | STALE | feat: stabilize Office360 auth, tracker and mail runtime | Review unique patches; no direct merge |
| GORGDEV2-EFIM-INTEGRATION | `6ed1340` | 2026-08-21 | 8 / 0 | YES | YES | NO | STALE | chore(calendar): establish verified baseline | Review unique patches; no direct merge |
| audit/office360-current-state-2026-09 | `88ee55d` | 2026-08-11 | 0 / 0 | NO | YES | NO | DELETE CANDIDATE | fix(telemost): contain browser windows and isolate profiles | Historical; optional owner-approved cleanup |
| baseline/office360-2026-08-11 | `5d17112` | 2026-08-11 | 1 / 60 | YES | YES | NO | STALE | merge: integrate office360 mail workflow baseline | Review unique patches; no direct merge |
| codex/efim-telemost-recovery-002 | `9f0a230` | 2026-08-27 | 57 / 0 | YES | YES | NO | ACTIVE | fix(telemost): restore Efim Windows auth and embedded session flow | Keep separate; reconcile before integration |
| codex/mig-040-macos | `2801704` | 2026-08-26 | 23 / 0 | NO | YES | NO | STALE | fix(migrations): move macOS Yandex UID migration to v40 | Review unique patches; no direct merge |
| feat/calendar-yandex360 | `e3604e8` | 2026-08-26 | 50 / 0 | YES | YES | #4 | READY TO MERGE | ci: add pull request validation | Keep; review gate |
| feat/design-001 | `d02e4f3` | 2026-08-27 | 56 / 0 | YES | YES | NO | ACTIVE | docs(design): freeze approved Office360 design | Keep separate; reconcile before integration |
| feat/tasks-yandex-tracker | `b71c80e` | 2026-08-29 | 8 / 0 | YES | YES | NO | BLOCKED | fix(auth): use registered callback for Yandex services OAuth | Keep separate; reconcile before integration |
| merge/gorgdev-efim-final | `829df8e` | 2026-08-11 | 3 / 8 | NO | NO | NO | STALE | docs(qa): record post-merge check results for gorgdev-efim-final | Review unique patches; no direct merge |
| office360-api-ya | `0226c55` | 2026-05-11 | 0 / 369 | YES | YES | NO | DELETE CANDIDATE | fix: localize email sending notifications | Historical; optional owner-approved cleanup |
| office360-files-section | `b09b08f` | 2026-05-11 | 1 / 369 | YES | YES | NO | STALE | feat: add files section for email attachments | Review unique patches; no direct merge |
| office360-mail-workflow | `8f5b6ac` | 2026-06-24 | 0 / 345 | YES | YES | NO | DELETE CANDIDATE | chore(cursor): add HEADROOM and APOSTLE workflow rules and skills | Historical; optional owner-approved cleanup |
| origin/GORGDEV | `f26a3da` | 2026-08-11 | 1 / 343 | YES | YES | #3 (base: old plugin branch) | STALE | feat(i18n): complete Russian localization pass | Review unique patches; no direct merge |
| origin/GORGDEV2 | `2aaa905` | 2026-08-11 | 5 / 0 | YES | YES | NO | STALE | feat: stabilize Office360 auth, tracker and mail runtime | Review unique patches; no direct merge |
| origin/GORGDEV2-EFIM-INTEGRATION | `10c7a54` | 2026-08-11 | 7 / 0 | YES | YES | NO | STALE | feat: integrate Yandex services and stabilize hybrid navigation | Review unique patches; no direct merge |
| origin/baseline/office360-2026-08-11 | `5d17112` | 2026-08-11 | 1 / 60 | YES | YES | NO | STALE | merge: integrate office360 mail workflow baseline | Review unique patches; no direct merge |
| origin/chore/office360-plugin-installed-refresh | `63c6e22` | 2026-06-02 | 0 / 97 | YES | YES | NO | DELETE CANDIDATE | chore(agents): require installed app refresh in tester | Historical; optional owner-approved cleanup |
| origin/codex/efim-telemost-recovery-002 | `9f0a230` | 2026-08-27 | 57 / 0 | YES | YES | NO | ACTIVE | fix(telemost): restore Efim Windows auth and embedded session flow | Keep separate; reconcile before integration |
| origin/dependabot/cargo/src-tauri/quinn-proto-0.11.14 | `4149328` | 2026-03-11 | 1 / 152 | YES | YES | NO | STALE | chore(deps): bump quinn-proto from 0.11.13 to 0.11.14 in /src-tauri | Review unique patches; no direct merge |
| origin/dependabot/cargo/src-tauri/rustls-webpki-0.103.13 | `eb28d31` | 2026-04-24 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump rustls-webpki from 0.103.9 to 0.103.13 in /src-tauri | Review unique patches; no direct merge |
| origin/dependabot/cargo/src-tauri/tar-0.4.45 | `3798ec7` | 2026-03-20 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump tar from 0.4.44 to 0.4.45 in /src-tauri | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/dompurify-3.4.0 | `08c1db7` | 2026-04-16 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump dompurify from 3.3.1 to 3.4.0 | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/landing/flatted-3.4.2 | `4eb6410` | 2026-03-21 | 1 / 150 | YES | YES | NO | STALE | chore(deps-dev): bump flatted from 3.3.3 to 3.4.2 in /landing | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/landing/picomatch-4.0.4 | `4d97ba3` | 2026-03-26 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump picomatch from 4.0.3 to 4.0.4 in /landing | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/landing/vite-7.3.2 | `cf4c50c` | 2026-04-07 | 1 / 150 | YES | YES | NO | STALE | chore(deps-dev): bump vite from 7.3.1 to 7.3.2 in /landing | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/picomatch-4.0.4 | `bcb1cb6` | 2026-03-26 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump picomatch from 4.0.3 to 4.0.4 | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/undici-7.24.1 | `4f799c6` | 2026-03-13 | 1 / 150 | YES | YES | NO | STALE | chore(deps): bump undici from 7.21.0 to 7.24.1 | Review unique patches; no direct merge |
| origin/dependabot/npm_and_yarn/vite-7.3.2 | `a5bd416` | 2026-04-06 | 1 / 150 | YES | YES | NO | STALE | chore(deps-dev): bump vite from 7.3.1 to 7.3.2 | Review unique patches; no direct merge |
| origin/efim-10-08 | `ac577bf` | 2026-08-11 | 0 / 74 | YES | YES | NO | DELETE CANDIDATE | Реализован mvp функционал телемоста и диска | Historical; optional owner-approved cleanup |
| origin/efim-11-08-auth | `aa39e9a` | 2026-08-11 | 2 / 0 | YES | YES | NO | STALE | feat(yandex): unify auth and embedded communications | Review unique patches; no direct merge |
| origin/feat/auto-advance-after-removal | `bd0e99b` | 2026-02-24 | 2 / 167 | YES | YES | NO | STALE | test: add missing auto-advance tests for permanentDelete and moveToFolder | Review unique patches; no direct merge |
| origin/feat/calendar-yandex360 | `e3604e8` | 2026-08-26 | 50 / 0 | YES | YES | #4 | READY TO MERGE | ci: add pull request validation | Keep; review gate |
| origin/feat/design-001 | `d02e4f3` | 2026-08-27 | 56 / 0 | YES | YES | NO | ACTIVE | docs(design): freeze approved Office360 design | Keep separate; reconcile before integration |
| origin/feat/epic-01-provider-capabilities | `938444d` | 2026-06-02 | 0 / 103 | YES | YES | NO | DELETE CANDIDATE | feat(mail): add provider capability gating | Historical; optional owner-approved cleanup |
| origin/feat/epic-02-account-diagnostics | `0e98ff3` | 2026-06-02 | 1 / 101 | YES | YES | NO | STALE | chore(agents): require installed app refresh in tester | Review unique patches; no direct merge |
| origin/feat/epic-03-sync-health-offline-queue | `7cba74c` | 2026-06-03 | 1 / 95 | YES | YES | NO | STALE | fix(mail): harden queue review feedback | Review unique patches; no direct merge |
| origin/feat/epic-04-folder-label-completeness | `9df4b28` | 2026-06-03 | 0 / 89 | YES | YES | NO | DELETE CANDIDATE | feat(mail): complete folder label workflows | Historical; optional owner-approved cleanup |
| origin/feat/epic-05-compose-mime-reliability | `a63313f` | 2026-06-03 | 0 / 88 | YES | YES | NO | DELETE CANDIDATE | feat(mail): harden compose MIME reliability | Historical; optional owner-approved cleanup |
| origin/feat/epic-06-search-smart-folders | `928c75f` | 2026-06-10 | 0 / 81 | YES | YES | NO | DELETE CANDIDATE | feat(search): complete epic 06 smart folders | Historical; optional owner-approved cleanup |
| origin/feat/epic-07-contacts-address-book | `62fd750` | 2026-06-14 | 0 / 79 | YES | YES | NO | DELETE CANDIDATE | feat(contacts): add address book foundation | Historical; optional owner-approved cleanup |
| origin/feat/epic-08-calendar-invitations | `d12a0e6` | 2026-06-14 | 0 / 77 | YES | YES | NO | DELETE CANDIDATE | feat(calendar): add invitation RSVP cards | Historical; optional owner-approved cleanup |
| origin/feat/epic-09-security-privacy | `8c51c13` | 2026-06-10 | 0 / 83 | YES | YES | NO | DELETE CANDIDATE | feat(mail): add security warning reader layer | Historical; optional owner-approved cleanup |
| origin/feat/epic-10-enterprise-exchange-strategy | `2284a56` | 2026-06-14 | 0 / 75 | YES | YES | NO | DELETE CANDIDATE | feat(accounts): add exchange strategy guardrails | Historical; optional owner-approved cleanup |
| origin/feat/epic-11-support-debug-bundle | `f32efc8` | 2026-06-14 | 0 / 73 | YES | YES | NO | DELETE CANDIDATE | feat(diagnostics): add support debug bundle export | Historical; optional owner-approved cleanup |
| origin/feat/epic-12-yandex360-work-account-foundation | `7c5f80c` | 2026-06-16 | 0 / 67 | YES | YES | NO | DELETE CANDIDATE | feat(accounts): add yandex 360 work account hub | Historical; optional owner-approved cleanup |
| origin/feat/epic-13-full-address-book | `282cb86` | 2026-06-15 | 0 / 71 | YES | YES | NO | DELETE CANDIDATE | feat(contacts): add full address book management | Historical; optional owner-approved cleanup |
| origin/feat/jmap-email-provider | `5fae5dd` | 2026-02-16 | 2 / 283 | YES | YES | NO | STALE | feat: add JMAP email provider (RFC 8620/8621) | Review unique patches; no direct merge |
| origin/feat/local-ai-ollama-lmstudio | `bc3a26c` | 2026-02-20 | 2 / 207 | YES | YES | NO | STALE | docs: update docs for local AI (Ollama/LMStudio) support | Review unique patches; no direct merge |
| origin/feat/tasks-yandex-tracker | `b71c80e` | 2026-08-29 | 8 / 0 | YES | YES | NO | BLOCKED | fix(auth): use registered callback for Yandex services OAuth | Keep separate; reconcile before integration |
| origin/feat/velo-mail-agents-plugin | `03bdef1` | 2026-06-01 | 0 / 106 | YES | YES | NO | DELETE CANDIDATE | chore(agents): add Velo Mail agent plugin | Historical; optional owner-approved cleanup |
| origin/fix/compose-popout-production-polish | `1ac2fd1` | 2026-06-01 | 0 / 112 | YES | YES | NO | DELETE CANDIDATE | chore: connect compose polish branch to release0.1.0 | Historical; optional owner-approved cleanup |
| origin/fix/contact-primary-sync-state | `c27e985` | 2026-06-15 | 0 / 69 | YES | YES | NO | DELETE CANDIDATE | fix(contacts): preserve primary methods and sync clears | Historical; optional owner-approved cleanup |
| origin/fix/epic-03-review-hardening | `35841eb` | 2026-06-03 | 0 / 93 | YES | YES | NO | DELETE CANDIDATE | fix(mail): harden queue review feedback | Historical; optional owner-approved cleanup |
| origin/fix/full-suite-build-stabilization | `6c697a1` | 2026-06-03 | 0 / 84 | YES | YES | NO | DELETE CANDIDATE | test(mail): stabilize full suite and app build | Historical; optional owner-approved cleanup |
| origin/fix/macos-reopen-icon-badge | `702ab9f` | 2026-06-03 | 0 / 90 | YES | YES | NO | DELETE CANDIDATE | fix(macos): balance app icon scale | Historical; optional owner-approved cleanup |
| origin/fix/office360-skill-yaml | `ca140f9` | 2026-06-02 | 0 / 102 | YES | YES | NO | DELETE CANDIDATE | fix(agents): quote skill descriptions | Historical; optional owner-approved cleanup |
| origin/fix/release-workflow-and-v1 | `90b2c11` | 2026-02-21 | 3 / 188 | YES | YES | NO | STALE | refactor: consolidate all release workflows into release-please pipeline | Review unique patches; no direct merge |
| origin/fix/telemost-cef-profile-isolation | `ff74313` | 2026-08-11 | 0 / 1 | YES | YES | NO | DELETE CANDIDATE | fix(telemost): contain browser windows and isolate profiles | Historical; optional owner-approved cleanup |
| origin/macos/arm64 | `2801704` | 2026-08-26 | 23 / 0 | YES | YES | NO | ACTIVE | fix(migrations): move macOS Yandex UID migration to v40 | Keep separate; reconcile before integration |
| origin/macos/office360-stabilization | `c46a33e` | 2026-08-12 | 12 / 0 | YES | YES | NO | STALE | fix(macos): complete embedded Telemost isolation | Review unique patches; no direct merge |
| origin/macos/x86_64 | `2801704` | 2026-08-26 | 23 / 0 | YES | YES | NO | ACTIVE | fix(migrations): move macOS Yandex UID migration to v40 | Keep separate; reconcile before integration |
| origin/main | `88ee55d` | 2026-08-11 | 0 / 0 | YES | YES | NO | MERGED | fix(telemost): contain browser windows and isolate profiles | Historical; optional owner-approved cleanup |
| origin/mega_team-patch | `66dd347` | 2026-06-01 | 0 / 108 | YES | YES | NO | DELETE CANDIDATE | update: CODEOWNERS | Historical; optional owner-approved cleanup |
| origin/merge/efim-gorgdev-main | `455bed6` | 2026-08-11 | 0 / 8 | YES | YES | NO | DELETE CANDIDATE | chore(release): document Office360 fixes since previous push | Historical; optional owner-approved cleanup |
| origin/my_feauture | `9ab14be` | 2026-05-11 | 2 / 369 | YES | YES | NO | EXPERIMENT | test | Review unique patches; no direct merge |
| origin/office360 | `ac5d36b` | 2026-05-08 | 0 / 380 | YES | YES | NO | DELETE CANDIDATE | все в серых тонах | Historical; optional owner-approved cleanup |
| origin/office360-api-ya | `0226c55` | 2026-05-11 | 0 / 369 | YES | YES | NO | DELETE CANDIDATE | fix: localize email sending notifications | Historical; optional owner-approved cleanup |
| origin/office360-files-section | `b09b08f` | 2026-05-11 | 1 / 369 | YES | YES | NO | STALE | feat: add files section for email attachments | Review unique patches; no direct merge |
| origin/office360-i18n | `2abd9a1` | 2026-05-19 | 1 / 361 | YES | YES | NO | STALE | feat(i18n): add translation keys for mail navigation | Review unique patches; no direct merge |
| origin/office360-linux-alt-first-run | `308aa28` | 2026-05-16 | 1 / 363 | YES | YES | NO | STALE | fix(linux): stabilize first run and yandex imap sync | Review unique patches; no direct merge |
| origin/office360-mail-workflow | `8f5b6ac` | 2026-06-24 | 0 / 345 | YES | YES | NO | DELETE CANDIDATE | chore(cursor): add HEADROOM and APOSTLE workflow rules and skills | Historical; optional owner-approved cleanup |
| origin/release-please--branches--chore/office360-plugin-installed-refresh--components--office360 | `4fb4954` | 2026-08-11 | 1 / 97 | YES | YES | NO | STALE | chore(chore/office360-plugin-installed-refresh): release office360 0.5.0 | Review unique patches; no direct merge |
| origin/release-please--branches--main--components--velo | `efedc2f` | 2026-03-13 | 1 / 150 | YES | YES | NO | STALE | chore(main): release velo 0.4.22 | Review unique patches; no direct merge |
| origin/release0.1.0 | `fabf17b` | 2026-06-01 | 0 / 111 | YES | YES | NO | DELETE CANDIDATE | Pull request 'fix/compose-popout-production-polish' (#3) from fix/compose-popout-production-polish into release0.1.0 | Historical; optional owner-approved cleanup |

Significant topology facts:

- Calendar, Tasks, design, current recovery and macOS all have **zero main-only commits missing** at this snapshot; they still diverge from each other.
- Tasks forked directly from main: **no Calendar commits**. Calendar contains GORGDEV2 and integration history; importing them separately before Calendar is unnecessary.
- Design is Calendar plus six commits (foundation, Calendar, Mail, logo review/assets, freeze); recovery is design plus `9f0a230`. Neither is merged or in a PR.
- `macos/arm64` and `macos/x86_64` are identical commit/tree; retain intentional platform refs until ownership/release policy is reviewed. Do not auto-merge macOS into main.
- `GORGDEV2-EFIM-INTEGRATION` local `6ed1340` is ahead its same-name remote by one, but that commit is already pushed through Calendar. `codex/mig-040-macos` has no same-name origin ref but its tip is pushed through both macOS refs.
- PR #3's base remains the obsolete plugin branch, not main. It is conflicting. Dependabot refs are stale individual updates; their existence is not evidence the current lockfile is patched.

## 3. Recent work timeline and verified commits

| Milestone | Representative commits / branch | Pushed | Main | Automated / live boundary | Current state |
|---|---|---|---|---|---|
| Mail foundation and 13 epics, May–June | provider capabilities, queue, MIME, search, contacts, security, diagnostics; epic refs and `8f5b6ac` | YES | Most mail foundation YES; see ancestry inventory | Current main suite exposes attachment/OAuth baseline; historical mail smoke only | PARTIAL overall release gate |
| Yandex hybrid/auth, August 11 | `2aaa905`, `10c7a54`; GORGDEV2 / integration | YES | NO for these commits | Historical integration says Mail/Disk/Telemost pass, Messenger partial | PARTIAL, included in Calendar |
| Calendar semantics/sync, Aug 21–22 | `1b11cf3`, `00644b9`, `e9de6da`, `dcbb90d` | YES | NO | Fresh full suite + TZ + migration SQL; historical read-only Tauri views | READY scoped |
| Calendar interactions/scheduling, Aug 22–24 | `83d24d6`, `5edefcf`, `bab06c7`, `9f8b4e5`, `2e35144`, `34696a5`, `d429884` | YES | NO | Provider writes are fixture-tested; historical dialogs/view smoke | READY scoped |
| Calendar durability/access, Aug 23–24 | `7839344`, `c559ccc`, `032ed72`, `52006f4`, `91693b3`, `8f1eb34`, `ede1fc2` | YES | NO | Reminder/iTIP/ACL/delta automated; real mutation acceptance absent | READY scoped / provider limits |
| PEOPLE-001, Aug 24 | `df3611b` on Calendar | YES | NO | Fresh suite includes People; directory live rights not established here | READY local/manual, directory conditional |
| Repository audit / GitHub hardening, Aug 25–26 | `da1f113`, `e3604e8`; actual protection checked via API | YES | NO for audit/CI commits | Four PR checks success; default/protection corrected externally | PARTIAL until PR approval |
| macOS migration numbering, Aug 26 | `2801704` | YES, both macOS refs | NO | Fresh memory SQL; native macOS not run | DONE numbering / PARTIAL platform |
| Design freeze + Telemost recovery, Aug 26–27 | `9202a79`, `8ec0ca2`, `4cabafb`, `363c74a`, `a1d9464`, `d02e4f3`, `9f0a230` | YES | NO | August freeze docs report tests/build; no fresh design/recovery suite here | PARTIAL integration |
| Tasks architecture/domain/provider, Aug 29 | `6c30105`, `de9937e`, `0926167` | YES | NO | Fresh Tasks tests pass; actual Directory boundary defective | BLOCKED live |
| Mail→Task/list/detail/sync/assignment, Aug 29 | `ab9e459`, `045facf`, `c6d0ee3`, `dcc4ce2` | YES | NO | Fresh targeted suite 113 pass; real create/edit/transition NOT RUN | BLOCKED live |
| Services OAuth callback, Aug 29 | `b71c80e` | YES | NO | Resolver and related tests present; credential records present, validity unknown | READY callback fix / PARTIAL auth integration |

All requested candidate hashes were resolved as commits, rather than accepted from chat:

| Commit | Date | Description | Pushed via | Main |
|---|---|---|---|---|
| `ede1fc2` | 2026-08-24 | docs(calendar): finalize parity audit | origin/feat/calendar-yandex360 | NO |
| `df3611b` | 2026-08-24 | feat(people): add unified recipient and participant picker | origin/feat/calendar-yandex360 | NO |
| `e3604e8` | 2026-08-26 | ci: add pull request validation | origin/feat/calendar-yandex360 | NO |
| `6c30105` | 2026-08-29 | docs(tasks): design Yandex Tracker task integration | origin/feat/tasks-yandex-tracker | NO |
| `de9937e` | 2026-08-29 | feat(tasks): add provider-neutral task domain and cache | origin/feat/tasks-yandex-tracker | NO |
| `0926167` | 2026-08-29 | feat(tasks): add Yandex Tracker provider | origin/feat/tasks-yandex-tracker | NO |
| `ab9e459` | 2026-08-29 | feat(tasks): create Tracker tasks from mail | origin/feat/tasks-yandex-tracker | NO |
| `045facf` | 2026-08-29 | feat(tasks): add task lists and detail | origin/feat/tasks-yandex-tracker | NO |
| `c6d0ee3` | 2026-08-29 | feat(tasks): add task sync transitions and settings | origin/feat/tasks-yandex-tracker | NO |
| `dcc4ce2` | 2026-08-29 | feat(tasks): complete task assignment workflow | origin/feat/tasks-yandex-tracker | NO |
| `b71c80e` | 2026-08-29 | fix(auth): use registered callback for Yandex services OAuth | origin/feat/tasks-yandex-tracker | NO |
| `2801704` | 2026-08-26 | fix(migrations): move macOS Yandex UID migration to v40 | origin/macos/arm64 | NO |
| `da1f113` | 2026-08-25 | docs(audit): add full Office360 repository audit | origin/feat/calendar-yandex360 | NO |
| `9f0a230` | 2026-08-27 | fix(telemost): restore Efim Windows auth and embedded session flow | origin/codex/efim-telemost-recovery-002 | NO |
| `d02e4f3` | 2026-08-27 | docs(design): freeze approved Office360 design | origin/codex/efim-telemost-recovery-002 | NO |

## 4. Exact feature status matrix

`A` = fresh automated coverage at the indicated branch; `H` = historical documented live only; `NR` = no new live test. READY refers to scoped implementation and still requires integration/review gates. Main contains older Calendar/Tasks/Mail features; “NO” means the milestone in this row is absent from main.

| Feature | Code | Tests | Live | Commit | Push | PR | Main | Status | Blocker / boundary |
|---|---|---|---|---|---|---|---|---|---|
| Mail | Existing main implementation | Main 10 baseline failures overall, including attachments/auth | H / NR | `88ee55d` baseline | YES | — | YES | PARTIAL | Test gate, dependency risk, fresh runtime not run |
| Calendar full release | YES | A 2575 full-branch tests | H read-only / NR mutation | `ede1fc2` + `e3604e8` | YES | #4 | NO | READY | Approval, scoped provider limits |
| PeoplePicker | YES on Calendar; partial domain on Tasks | A | NR directory | `df3611b` | YES | #4 | NO | READY | Directory grant; Tasks duplication |
| Calendar ACL | YES | A | H unsupported discovery / NR writes | `032ed72` | YES | #4 | NO | PARTIAL | Yandex standard DAV ACL writes unsupported |
| Calendar sync | YES | A | H read-only | `52006f4` | YES | #4 | NO | READY | Cursor-last replay, bounded fallback |
| Calendar reminders | Metadata + durable native delivery | A | Historical UI; OS delivery not freshly proven | `46dcb4a`, `7839344` | YES | #4 | NO | READY | No killed-process service; at-most-once crash window |
| Mail iTIP | REQUEST/REPLY/CANCEL ledger/outbox | A | NR real mail | `c559ccc` | YES | #4 | NO | READY | Live delivery acceptance absent |
| Tasks domain | Task/TaskSource/repository/settings/v41 | A | Local metadata only | `de9937e` | YES | NO | NO | READY | Integration migration diff |
| Tracker provider | CRUD/update/transitions/UID/projection | A mocked | NR mutation | `0926167` | YES | NO | NO | BLOCKED | Directory code + config + entitlement unverified |
| Mail→Task | Gate/modal/linked-task block | A | NR | `ab9e459` | YES | NO | NO | BLOCKED | Missing org/defaultQueue and strict assignee discovery |
| Tasks list/detail | My/Created/Completed/source navigation | A | NR | `045facf` | YES | NO | NO | PARTIAL | Cannot establish configured live org |
| Tasks sync/settings | Single-flight/reconnect/edit/queue controls | A | NR | `c6d0ee3` | YES | NO | NO | PARTIAL | Shared org selector missing; no configured settings |
| Task assignee edit | Organization picker + strict UID resolution | A | NR | `dcc4ce2` | YES | NO | NO | BLOCKED | Incorrect Directory API/token boundary |
| Yandex services OAuth callback | Registered callback + PKCE or screen-code | A | Credentials exist; September validity NR | `b71c80e` | YES | NO | NO | READY | Must preserve when integrating Calendar auth |
| Yandex organization support (ORG-001 scope) | PARTIAL: storage + TrackerPage primitives; no shared selector | Partial legacy; no dedicated ORG suite | Primary unbound | Existing main + Tasks callers | YES primitives | NO | Primitive YES / feature NO | PARTIAL | Shared selector + primary persistence incomplete |
| Shared org selector UI | No dedicated Settings/Tasks selector | No dedicated suite | NR | — | NO | NO | NO | NOT STARTED | Ticket ORG-001 UI not delivered |
| Existing org storage/Tracker input | Account-scoped key, single-org auto-save | Partial legacy coverage | Primary unbound | Existing main + Tasks callers | YES | — | Primitive YES | BROKEN | Input disappears after first nonempty value (`!orgId`) |
| Tracker live create | Code path exists | Mocks only | NOT RUN | Tasks line | YES | NO | NO | BLOCKED | Code, org, queue, Directory rights, entitlement |
| macOS migration fix | v34 → v40 | A memory SQL | DB v40 not present locally | `2801704` | YES | NO | NO | DONE | Existing old v34 deployments still need provenance handling |
| PR CI | Workflow on Calendar | Four success checks | GitHub API current | `e3604e8` | YES | #4 | NO | READY | Approval missing; workflow absent exact main |
| GitHub branch protection | Server setting | API verified | Current API | N/A | N/A | N/A | YES | DONE | Admin bypass remains enabled; no code-owner requirement |
| Design freeze | Approved branch exists | H; not freshly rerun | H only | `d02e4f3` | YES | NO | NO | PARTIAL | Separate integration/review |
| Telemost recovery | Windows auth/embed recovery | H; not freshly rerun | NR | `9f0a230` | YES | NO | NO | PARTIAL | Not integrated, misleading upstream |

### Calendar capability-by-capability

| Capability | Code / current evidence | Remaining boundary |
|---|---|---|
| Month / Week / Day | CalendarPage/grids; tests pass; historical Tauri read-only navigation | No fresh September UI smoke |
| CRUD | `calendarMutationService.ts`, provider adapters, tests | Real cloud mutation NOT RUN |
| Recurrence model / create | domain/time, ical codec, recurrence editor; required/optional roles preserved | No complete nth-weekday editor |
| Single / series mutation | Explicit scope gates and provider tests | this-and-future unsupported |
| Attendees / Required / Optional | `participants/ParticipantAuthoring.tsx`, authoredParticipants | Remote invitation side effects fixture-only |
| Free/Busy / Scheduling Assistant | freeBusy/scheduling services and UI | Safe discovery does not prove live scheduling POST |
| Yandex RFC6638 | `caldavProvider.ts` principal/inbox/outbox/address discovery | Provider-advertised support required |
| Reminder metadata | domain/reminder + v36 | Provider capabilities differ |
| Desktop reminders | scheduler + notification adapter + v38 dedupe | Process must run; claim before OS call can lose one notification on crash |
| Mail iTIP REQUEST/REPLY/CANCEL | `itip/lifecycle.ts`, v39 action/delivery ledger | No real September mail send/RSVP |
| Shared calendar permissions | Access metadata + capability checks, v37 | Separate shared/free-busy-only live fixture absent |
| ACL management | Service/dialog, Google and conditional DAV adapters | Yandex DAV writes unsupported; unknown access fails closed |
| Drag / resize | timedGrid mutations and geometry | No keyboard drag-selection / edge autoscroll |
| All-day / month interactions | dateGrid dateShift/commit paths | Live mutation not run |
| Create by selection | createSelection domain/UI | Automated coverage, historical open/cancel only |
| Month +N | Overflow interactions implemented/tested | Historical live fixture had no >3-event day |
| Monday-first RU / current-time indicator | Calendar grid/locale code + tests | No new visual certification |
| Search | calendarSearchService + CalendarSearch; local/cache scoped | No fuzzy ranking/FTS |
| Delta sync | calendarSyncCoordinator owns refresh/cursors, single-flight | Cursor-last replay, not a full batch rollback transaction |
| Offline | Cache reads; mutation service returns typed offline result | No silent offline calendar write queue |
| Final a11y/UI polish | CAL-130 focus/state/locale changes | Formal WCAG/device/visual-regression coverage absent |
| People integration | Mail AddressInput, ParticipantAuthoring, CalendarAclDialog import PeoplePicker | Organization search requires admin grant |

**Code complete?** YES for the documented provider-neutral scope, not literal Yandex parity. **Automated readiness?** YES after recovery of infrastructure-only worker failures. **Fresh live readiness?** Not established. **Pushed?** YES. **Merged?** NO. **PR?** #4 open.

No 96/91/89/90 score was copied. Current scoring is evidence-based categorical: functional scoped implementation READY; interactions automated PASS; visual September evaluation NOT RUN; production acceptance PARTIAL. Assigning new visual/production percentages without live evaluation would be fabricated precision.

Calendar P0: no new confirmed data-loss defect. Calendar P1: provider/live acceptance, this-and-future and shared subscription workflows outside delivered scope. Calendar P2: nth-weekday authoring, keyboard selection/autoscroll, search scale, transaction/performance hardening and formal accessibility.

### PEOPLE-001 and remaining email inputs

`src/services/people/domain.ts` provides PersonIdentity and PeopleDirectoryProvider contracts; `peopleSearchService.ts` merges/ranks directory, contacts, recent recipients, Calendar history and valid manual email. Fields include first/last name, email, job title, organization and department. Email normalization/dedupe is comparison-only; valid external email remains usable if Directory fails. Calendar's `yandex360DirectoryProvider.ts` uses `https://api360.yandex.net/directory/v1`, bounded pagination/cache and admin grant capability checks.

Full PEOPLE-001 exists on Calendar/design/recovery, not main or Tasks. Tasks' same-path domain lacks `isValidPersonEmail` and differs in normalization helpers; accepting its file wholesale during integration would break Calendar consumers. Its `OrganizationPeoplePicker` intentionally forbids manual external assignees, but independently implements directory search. This should share the identity/provider boundary while retaining org-only selection rules.

Old email inputs still present: main/Tasks `components/composer/AddressInput.tsx` (pre-People recipient UI), main/Tasks Calendar participant inputs, legacy TrackerPage assignee text filter. Calendar's `SettingsPage.tsx` still has `type="email"` for the VIP-address setting; that is a settings-specific address entry, not an unconverted To/Cc/Bcc picker. Contacts editing and account setup also legitimately retain email fields. Calendar Mail To/Cc/Bcc, participants and ACL are migrated.

### TASKS-001…007 / OAuth / ORG-001

All milestone commits exist: architecture; provider-neutral Task/TaskSource/OrganizationTaskSettings and SqliteTaskRepository; provider queue/UID/CRUD/transitions/idempotency/projection; Mail create modal and linked-task block; three task sections/detail/Mail navigation; sync/reconnect/settings/queue/editor/offline; assignee edit. Source separation is materially better than the old local task manager, but production claims in provider docs exceed evidence.

**Code blocker A — Directory integration:** Tasks `organizationDirectorySearch.ts` and `yandexTracker/directoryMembership.ts` call `yandex360/directory.ts`. That client requests `https://cloud-api.yandex.net/v1/orgs/{orgId}/users`, and `auth.ts:getYandex360AccessToken(accountId)` returns the account Mail access token without refreshing or selecting services/admin grants. Official current cloud API uses `/v1/directory/organizations/{org_id}/users`, requires read_users/write_users and pagination. The implemented URL is not the documented contract. See [Yandex Directory users API](https://yandex.ru/dev/api360/doc/ru/directory/get-users). Calendar's People adapter uses a separate supported API family. Fixing services OAuth alone cannot fix this Tasks call chain. Tasks adapter also lacks paginated user discovery and does not fully map the current snake_case payload fields.

**Product bug B — organization input:** `components/yandex/TrackerPage.tsx:91` renders the manual form only when `!orgId`, while input onChange immediately sets `orgId`. Entering one character hides both input and Save, without calling persistence. Once an ID is stored the form also provides no switcher. This is a static code-confirmed UI bug, not a claim of a newly observed live click.

**ORG-001 exact checklist:** account-scoped get/set exists; auto-select single org exists only inside TrackerPage; shared multi-org selector absent; Settings integration read-only consumption only; Tasks integration read-only consumption only; dedicated ticket/test/docs implementation absent. **Overall organization support = PARTIAL.** Dedicated shared selector = NOT STARTED; Tracker manual input = BROKEN; storage/auto-select primitives = PARTIAL. Search covered the active branches, not merely the current checkout.

**Services callback fix:** b71c80e reads registered OAuth client callback and scopes, selects loopback PKCE or legacy verification_code flow, checks returned owner email when available, then stores per-normalized-email credentials. It no longer unconditionally selects verification_code. `oauthFlow.ts` uses localhost:17248 callback listening and PKCE/state flow; Mail and Services grants remain separate.

Remaining auth footguns: `resolveYandexAccount(null)` selects the first Yandex OAuth account; Directory null-account path can use a global token; Tasks Directory uses raw Mail token; organization settings are org/provider-scoped while account→org mapping is separate; nullable account IDs can cross contexts if callers omit selection. Callback resolver still falls back to verification_code when callback metadata is empty and canonicalizes loopback aliases to localhost; alternate registered paths/aliases need explicit coverage. Missing returned owner email is not a positive identity proof. Calendar also changes accountApi/oauthFlow heavily, so preserve b71c80e semantics in integration rather than choosing one branch's entire file.

Tasks readiness: **automated v1 READY; full branch test gate RED; migration SQL READY; live BLOCKED; entitlement CURRENT UNKNOWN; production BLOCKED.** Followers remain capability-only/partial; comments/attachments UI and unassign UX are incomplete. App-killed background sync is absent.

## 5. Push / merge matrix

| Direction | Committed | Pushed (fresh refs) | In PR | In main | Local-only explanation |
|---|---|---|---|---|---|
| Mail core | YES | YES | Historical #2 merged for Telemost isolation | YES | `velo/af97141` remains a separate old layout fix |
| Calendar + PEOPLE-001 + CI | YES, through e3604e8 | YES exact tip | #4 | NO | No uncommitted feature work |
| Tasks + callback fix | YES, b71c80e | YES exact tip | NO | NO | No uncommitted Tasks work |
| Design freeze | YES, d02e4f3 | YES | NO | NO | Old workspace docs saying not pushed are stale |
| Telemost recovery | YES, 9f0a230 | YES same-name remote | NO | NO | Ahead-of-design upstream is misleading |
| macOS MIG-040 | YES, 2801704 | YES both arch refs | NO | NO | Local codex/mig-040 alias is not unpublished work |
| Prior audit REPO-AUDIT-001 | YES, da1f113 | YES via Calendar | #4 | NO | — |
| Old final integration | 12d615d + 829df8e | NO across fetched main-repo remotes | NO | NO | Preserve; no direct merge recommendation |
| Stashes | Stash objects only | Not branch publication | NO | NO | 39 / 236 / 7 files, untouched |

## 6. Test baseline and runtime evidence

Host: Windows, Node 22.23.1, Vitest 4.0.18. Main/Calendar/macOS were checked out at exact origin hashes into new worktrees; `npm ci --ignore-scripts --no-audit --no-fund` used existing lockfiles. Tasks ran in its clean existing worktree with installed dependencies; its lockfile equals main's. No lockfile or dependency version was changed.

Initial full runs used `npm test -- --maxWorkers=2` and encountered forks-worker startup errors on this host. Only the omitted files were rerun with `--pool=threads --maxWorkers=1`; all recovered files passed. Totals below are **combined disjoint-file coverage**, not a fictitious clean single invocation. Original errors remain in the local logs. Calendar's exact GitHub PR run independently has four green jobs.

| Exact branch | TypeScript | Full Vitest coverage after omitted-file recovery | Build | Cargo | Special suites |
|---|---|---|---|---|---|
| main 88ee55d | PASS (tsc in build) | 182 files, 1884 tests: **10 fail / 1874 pass**; initial 4 worker errors recovered 45 tests | PASS | Ordinary BLOCKED missing CEF; CI resource override PASS, 2 warnings | Memory migration SQL PASS |
| Calendar e3604e8 | PASS | **268 files / 2575 pass**; initial 6 worker errors recovered 81 tests | PASS | Ordinary BLOCKED missing CEF; CI override PASS, 2 warnings | TZ 15 files/186 tests per zone ×4; v34–39 scripts PASS |
| Tasks b71c80e | PASS | 195 files, 1986 tests: **10 fail / 1976 pass**; initial 5 worker errors recovered 64 tests | PASS | CI override PASS, 2 warnings; no native bundle claim | Tasks-specific 16 files / 113 pass; memory v41 and combined order PASS |
| macOS 2801704, Windows host | PASS | **216 files / 2211 pass**; initial 6 worker errors recovered 69 tests | PASS | Windows-target FAIL E0599 `src/telemost_macos_spike.rs:935`, `remove_data_store`; native macOS NOT RUN | Memory v40 / prospective ordering PASS |
| Design/recovery | Historical freeze data only | NOT rerun on current recovery | NOT rerun | NOT rerun | Do not transfer Calendar pass to later code |

CI override was process-local `TAURI_CONFIG={"bundle":{"resources":[]}}`; no runtime/config file was edited. Cargo used `--locked --offline`; missing CEF packaging assets and Windows compilation of macOS-specific API are separate from macOS-native build readiness.

### Exact ten baseline failures

| File | Failures | Observed reason | Calendar | Tasks |
|---|---:|---|---|---|
| `src/components/email/AttachmentList.test.tsx` | 3 | Preview error text / Gmail URL-safe base64 / risky-preview confirmation assertions; outdated UI/mock assumptions | PASS, tests changed | Still failing |
| `src/services/calendar/caldavProvider.test.ts` | 3 | updateCalendarObject/deleteCalendarObject argument and ETag expectation mismatch | PASS, provider and conformance coverage substantially changed | Still failing |
| `src/services/gmail/auth.test.ts` | 2 | Unmocked Tauri event path: undefined transformCallback | PASS, event mock added | Still failing |
| `src/services/oauth/oauthTokenManager.test.ts` | 2 | Expected token persistence not called; resolveYandexClientSecret mock missing | PASS, tests/mock contract changed | Still failing |

These are current September results. Older audit reported 11 failures in eight files; that number is not reused. Passing tests are not evidence these historical mocks represented live production defects.

### Runtime / live matrix

No new Tauri app was launched: startup itself can migrate the shared real DB or start background operations. No authenticated cloud endpoint was exercised. This respects audit-only boundaries.

| Module | AUTOMATED PASS | TAURI LIVE PASS | READ-ONLY LIVE PASS | LIVE MUTATION PASS | Current September classification |
|---|---|---|---|---|---|
| Mail | Most; main attachment/auth suites fail | Historical notes | Historical notes | Not established here | NOT RUN fresh |
| Calendar | YES on Calendar | Historical CAL-130 views/dialogs | Historical Month/Week/Day, search, refresh | NOT RUN | READY code / live acceptance PARTIAL |
| People | YES local/manual | No fresh evidence | Directory current grant not verified | N/A | NOT RUN / grant-conditional |
| Tasks | YES targeted | No independent fresh evidence | Metadata only | NOT RUN | BLOCKED code/config |
| Tracker | Mocked provider | Historical view-mode report | Historical read success/403 write rejection | NOT RUN | BLOCKED; current entitlement unknown |
| OAuth | Calendar tests + Tasks callback tests | Historical services fix evidence | Credential-record presence only | No OAuth mutation | PARTIAL validation |
| ACL | YES fixtures | Historical unsupported state | Historical Yandex DAV discovery unsupported | NOT RUN | BLOCKED EXTERNALLY for Yandex writes |
| Sync | YES Calendar/Tasks logic | Historical Calendar refresh | Historical Calendar only | NOT RUN destructive delta scenarios | PARTIAL live coverage |
| Reminders | YES scheduler/dedupe | Historical center/UI; fresh OS notification absent | N/A | No fresh native delivery acceptance | NOT RUN fresh |

## 7. Migrations

Source is `src/services/db/migrations.ts`; all 41 version introductions below were checked with Git. Main ends v33; Calendar has v1–39; Tasks v1–33 plus v41; macOS v1–33 plus v40. Missing 34–40 on Tasks are reserved gaps, **not duplicate versions**. The runner tracks a set of individual applied versions, not only a maximum, so lower missing versions can run after v41.

| Version | Module / purpose | Source branch | Introducing commit | In main |
|---:|---|---|---|---|
| 1 | Initial schema | origin/main | `9d6a847` | YES |
| 2 | Full-text search | origin/main | `9d6a847` | YES |
| 3 | Add List-Unsubscribe header storage | origin/main | `9d6a847` | YES |
| 4 | Filter rules, templates, image allowlist | origin/main | `9d6a847` | YES |
| 5 | Pin support, AI cache, thread categories, calendar events, contact enrichment, attachment caching | origin/main | `9d6a847` | YES |
| 6 | Follow-up reminders, smart notifications, unsubscribe manager, newsletter bundling | origin/main | `e955299` | YES |
| 7 | Send-as aliases | origin/main | `e6efc6e` | YES |
| 8 | Smart folders | origin/main | `UNKNOWN` | YES |
| 9 | Email authentication results | origin/main | `UNKNOWN` | YES |
| 10 | Mute thread support | origin/main | `UNKNOWN` | YES |
| 11 | Phishing detection cache and allowlist | origin/main | `UNKNOWN` | YES |
| 12 | Quick steps | origin/main | `UNKNOWN` | YES |
| 13 | Contact notes | origin/main | `33558b1` | YES |
| 14 | IMAP/SMTP provider support | origin/main | `3ed7623` | YES |
| 15 | OAuth2 provider support for IMAP/SMTP | origin/main | `b042a12` | YES |
| 16 | Optional IMAP/SMTP username override | origin/main | `da56279` | YES |
| 17 | Offline mode: pending operations queue and local drafts | origin/main | `ec384fa` | YES |
| 18 | AI auto-drafts writing style profiles and task manager | origin/main | `c75dfc5` | YES |
| 19 | CalDAV calendar integration | origin/main | `08e05ff` | YES |
| 20 | Fix IMAP attachment part IDs and trigger resync | origin/main | `2c40b51` | YES |
| 21 | Force IMAP full resync for corrected attachment part IDs | origin/main | `2c40b51` | YES |
| 22 | Add smart label rules table for AI-powered auto-labeling | origin/main | `986a7ae` | YES |
| 23 | Accept self-signed certificates for IMAP/SMTP | origin/main | `a5f7cec` | YES |
| 24 | Default remote images to load (non-spam); spam still blocks in UI | origin/main | `b91a0fe` | YES |
| 25 | Task detail event fields and Telemost links | origin/main | `b91a0fe` | YES |
| 26 | Account connection diagnostics | origin/main | `dc77fc0` | YES |
| 27 | Queue observability metadata | origin/main | `2c714c3` | YES |
| 28 | Folder metadata and smart folder reference health | origin/main | `9df4b28` | YES |
| 29 | Contacts address book aggregates and identities | origin/main | `62fd750` | YES |
| 30 | Calendar invitation records and RSVP metadata | origin/main | `d12a0e6` | YES |
| 31 | Full address book directories, rich contact fields, and mailing lists | origin/main | `282cb86` | YES |
| 32 | Persist OAuth granted scopes for service readiness | origin/main | `7c5f80c` | YES |
| 33 | Repair OAuth granted scopes column after branch migration collision | origin/main | `7e78976` | YES |
| 34 | Calendar time semantics and occurrence identity | origin/feat/calendar-yandex360 | `1b11cf3` | NO — feature only |
| 35 | Calendar sync coverage and local projection lifecycle | origin/feat/calendar-yandex360 | `e9de6da` | NO — feature only |
| 36 | Calendar reminder semantic projection | origin/feat/calendar-yandex360 | `46dcb4a` | NO — feature only |
| 37 | Calendar access and provider presence metadata | origin/feat/calendar-yandex360 | `4be8742` | NO — feature only |
| 38 | Calendar reminder delivery runtime | origin/feat/calendar-yandex360 | `7839344` | NO — feature only |
| 39 | Calendar iTIP action and delivery ledger | origin/feat/calendar-yandex360 | `c559ccc` | NO — feature only |
| 40 | Persist official Yandex UID from login/info, never derived from email | origin/macos/arm64 | `2801704` | NO — feature only |
| 41 | Provider-neutral task projection, sources, and organization settings | origin/feat/tasks-yandex-tracker | `de9937e` | NO — feature only |

All seven memory-SQL scenarios PASS: main fresh; Calendar fresh; Tasks fresh; macOS fresh; combined 1–41; Tasks→Calendar→macOS; macOS→Calendar→Tasks. The pre-existing duplicate-column operation in repair v33 is intentionally tolerated by the real runner and the harness. Calendar's dedicated v34–39 scripts also pass fresh/existing/legacy-row checks.

**Prospective collision:** none by current version number. Integration must preserve all appended blocks and tests, not choose one branch's migrations file. The simulated union is not a merged application build. Earlier databases that recorded the *old macOS yandex_uid migration as v34* require provenance-aware repair: renumbering source alone does not rewrite old applied-version rows. This audit did not locate or certify every installed macOS database.

Fresh local read-only metadata reports applied v1–39 and v41, with v40 absent. That matches historical Calendar then Tasks usage and does not prove a combined release was deployed. No production migration was applied or inferred from this local DB.

## 8. GitHub PRs / CI / protection

| PR | Title | Head → base | Current head | Mergeability / review | Checks / behind base | State |
|---|---|---|---|---|---|---|
| [#4](https://github.com/gorg666/office360/pull/4) | feat(calendar): complete provider-neutral Office360 Calendar | feat/calendar-yandex360 → main | e3604e8 | MERGEABLE; REVIEW_REQUIRED; 0 approvals | Four SUCCESS; behind 0 | OPEN, not merged |
| [#3](https://github.com/gorg666/office360/pull/3) | Gorgdev | GORGDEV → chore/office360-plugin-installed-refresh | f26a3da | CONFLICTING; no approving review state | No check rollup; stale base topology | OPEN, not ready |
| [#2](https://github.com/gorg666/office360/pull/2) | fix(telemost): contain browser windows and isolate profiles | fix/telemost-cef-profile-isolation → main | ff74313 | APPROVED historically | No check rollup | MERGED 2026-08-11 |
| [#1](https://github.com/gorg666/office360/pull/1) | Gorgdev | GORGDEV → old plugin branch | 182f2e5 | Closed, not merged | No check rollup | CLOSED 2026-08-10 |

GitHub default `main`, strict required status checks YES, one approval YES, dismiss-stale-reviews YES. Required exact names: `Frontend (ubuntu-latest)`, `Frontend (windows-latest)`, `Rust (macos-latest)`, `Rust (windows-latest)`. Enforce-admins NO; required code-owner reviews NO; require-last-push-approval NO. No protection setting was changed.

[PR validation run 32935255579](https://github.com/gorg666/office360/actions/runs/32935255579) at e3604e8 on Aug 26: all four jobs succeeded. Workflow uses checkout@v4, setup-node@v4 (Node 20), rust-toolchain@stable. Mutable action tags are not immutable SHA pins. It triggers pull_request to main, not arbitrary feature pushes; Tasks has no PR and no equivalent check result.

[Release Please run 31484323823](https://github.com/gorg666/office360/actions/runs/31484323823) at exact main: FAILURE. Terminal error: Actions is not permitted to create or approve PRs. Logs also contain conventional-commit parsing warnings and a Node 20 action-runtime deprecation warning. This is distinct from successful PR validation. Main's workflow list lacks `pr-validation.yml`; it arrives with Calendar. No current successful native release packaging run was established.

## 9. Current blockers and metadata

Safe metadata query used SQLite URI mode=ro plus query_only. Only requested account labels, saved organization, saved scopes, credential **presence booleans**, migration numbers and non-secret task settings were selected. Email addresses/account IDs and credential values are deliberately omitted from this public report.

| Item | Current finding | Classification |
|---|---|---|
| Primary services credential records | Access/refresh entries present | READY storage only, validity UNKNOWN |
| Primary organization binding | NULL | CONFIG BLOCKER |
| Secondary binding | `8493916` | Separate context; not a substitute for primary |
| Primary previously reported directory org `8466799` | Not saved in current account mapping | Historical/user-provided discovery; not fresh cloud fact |
| Previously reported API plan free / Tracker org unavailable | No fresh safe local evidence of current plan | ENTITLEMENT BLOCKER historically; current external state UNKNOWN |
| Organization task settings | Table exists, zero rows | CONFIG BLOCKER |
| defaultQueue | None configured | CONFIG BLOCKER |
| Saved services scopes | Disk read/write, directory:read_organization, tracker read/write; no read_users | CONFIG/grant gap; does not explain away wrong Directory client |
| Directory actual call path | Wrong documented URL, Mail token, missing pagination | CODE BLOCKER |
| Manual org field | Hides on first character | PRODUCT BUG |
| Shared selector | No ORG-001 implementation | CODE/PRODUCT gap |
| Live Tracker create | Not attempted; blockers remain | BLOCKED |
| Task live mutation acceptance | NOT COMPLETE | NOT RUN |

Do not diagnose “entitlement only.” Even if Tracker entitlement is fixed externally, current primary configuration and Directory/UI code prevent a trustworthy end-to-end acceptance claim.

## 10. Current P0 / P1 / P2

### P0 — immediate integration gates

1. Main full test gate is red (10 assertions), and Tasks inherits it. Treat this as a release/integration gate, not proven data loss or service outage. Calendar contains passing replacements; merge still requires protected review.
2. No new confirmed secret exposure/data-loss incident or current migration-number collision was found. Do not report the old macOS v34 collision or stale default branch as active P0. Existing old-v34 databases remain an upgrade risk requiring provenance checks before any migration rollout.

### P1

1. Tasks Directory URL/token/pagination mismatch and disappearing org input; ORG-001 shared selection absent.
2. Primary org/defaultQueue unset; required Directory grant not established; current Tracker entitlement unverified; no live mutation acceptance.
3. Critical/high npm advisories plus known affected Rust packages; full Cargo scan still required before release.
4. Calendar/Tasks/design/recovery auth, People and migration divergence; 11 overlapping Calendar/Tasks files require semantic integration. No blind file overwrite.
5. PR #4 lacks approval; PR #3 conflicts against old base; Release Please cannot create PRs.
6. macOS native readiness unverified; macOS line does not compile as a Windows target at current tip.

### P2

1. Main chunks 1.87–2.16 MB; no optimization performed.
2. Large settings/messenger/contacts/IMAP modules and dozens of UI→DB imports.
3. Remaining Calendar interaction/recurrence/accessibility/visual-regression scope; reminder crash-window and killed-process limits.
4. Tasks followers/comments/attachments/unassign completeness and large-directory paging.
5. Stale docs, stale refs, misleading upstreams, three preserved stashes and old local-only work need owner review.

## 11. Architecture, dependencies, security and performance

### Architecture

Graph-guided source inspection confirms improvements: Calendar provider-neutral domain/capabilities/mutation service; one Calendar sync coordinator; isolated iCal codec; durable reminder/iTIP boundaries; shared People identity/search; Tasks provider/repository/domain and separate synchronization service. These are meaningful improvements over UI/provider coupling.

Remaining debt: old local tasks and organization Tasks coexist; legacy TrackerPage uses `yandex/tracker.ts`, new Tasks uses `trackerClient.ts`; Directory and account resolution paths differ; Mail IMAP/Gmail loops, queue processor, Calendar coordinator and Tasks coordinator coexist. Multiple loops across modules are expected, but cross-account lifecycle and duplicated provider ownership still deserve regression coverage. No new duplicate Calendar cursor owner was found.

Fresh line counts (non-test source): main `imap/client.rs` 2670, `SettingsPage.tsx` 2490, `MessengerSideStrip.tsx` 1980, `ContactsPage.tsx` 1763, `db/contacts.ts` 1586, `imapSync.ts` 1472. Calendar Settings 2499 and MessengerSideStrip 2031. macOS adds `telemost_macos_spike.rs` 2185 and TelemostPage 1510. Direct `@/services/db/` imports appear in 62 UI files on main, 73 Calendar, 62 Tasks, 63 macOS. This is a static coupling indicator, not 73 proven architecture bugs.

Calendar/Tasks changed-file overlap: ThreadView, Sidebar, SettingsPage, migrations.ts, migrations.test.ts, oauthFlow.test.ts, People domain, accountApi.ts, accountApi.test.ts, wiki/change-log and wiki/provider-capabilities. Two accountApi implementations differ substantially; Tasks has b71c80e while Calendar has unified grant logic. Preserve both contracts deliberately.

### Fresh dependency audit

| Lockfile line | Critical | High | Moderate | Low | Result |
|---|---:|---:|---:|---:|---|
| Main | 2 | 8 | 4 | 2 | npm audit exit 1 |
| Calendar | 2 | 8 | 4 | 2 | npm audit exit 1 |
| Tasks | 2 | 8 | 4 | 2 | Same lock bytes as main; main lock audit applies |
| macOS | 2 | 8 | 4 | 2 | npm audit exit 1 |
| Landing main lock | 0 | 8 | 3 | 2 | npm audit exit 1 |

Counts are npm vulnerable-package totals, not unique CVEs or proven exploitable product paths. Critical packages are **seroval** and **vitest**; seroval's old finding persists. High packages include TipTap core, browserslist, linkify-it, nanoid, picomatch, postcss, undici and vite. Landing additionally has flatted/js-yaml/brace-expansion findings. Runtime vs development reachability was not exhaustively demonstrated. Examples returned by npm: seroval GHSA-mv8w-475r-vwqw; Vitest GHSA-5xrq-8626-4rwp and GHSA-82fw-gwwq-j7x9. Do not solve this with stale Dependabot branch merges without a new lockfile/test review.

`cargo audit` is not installed; no tool/package installation was performed. Targeted lockfile/RustSec comparison found main `quinn-proto 0.11.13` affected by [RUSTSEC-2026-0037](https://rustsec.org/advisories/RUSTSEC-2026-0037.html), and `rustls-webpki 0.103.9` below the patched range for [RUSTSEC-2026-0049](https://rustsec.org/advisories/RUSTSEC-2026-0049.html). `tar 0.4.44` also needs review against [current tar advisories](https://rustsec.org/packages/tar.html). This is not an exhaustive Cargo advisory count or proof the vulnerable network/archive path is enabled in this build.

### Secret/artifact scan boundary

Filename scan across every origin ref found no tracked real `.env`, private key, database or PAT-backup candidate; `.env.example` was excluded by name and never opened. Known private-key/PAT signature scan of non-test source on main/Calendar/Tasks/macOS/recovery found no matches. This is bounded scanning, not a guarantee across every historical blob or every secret format.

The exact old `.mcp.json.bak-github-pat-*` filename pattern is absent at all inspected workspace clone/worktree roots. No backup content or keys were opened. Existing `office360.key` filename under app data is expected local runtime; its content was not read. Stashes remain unmodified and are not included in the source-secret-content scan. Do not claim the complete machine or history is secret-free.

### Production bundle

Fresh Vite production main chunks (decimal kB, build-reported gzip):

| Line | Main chunk | Gzip | Notable split chunks |
|---|---:|---:|---|
| main | 1874.42 kB | 559.42 kB | Settings 127.88, Help 104.35, Messenger 83.85 |
| Calendar | 2164.97 kB | 642.58 kB | MessengerSideStrip 204.98; Calendar domain/UI increase |
| Tasks | 1964.59 kB | 583.48 kB | Settings 129.17; Tasks code adds ~90 kB over main |
| macOS frontend | 1911.86 kB | 570.94 kB | MessengerSideStrip 205.05 |

The historical ~2.1 MB / ~643 kB gzip number still describes the Calendar line, not current main. Vite warns about >500 kB chunks and sax's browser-externalized stream module. Large dependencies present include React/TanStack router, TipTap/ProseMirror, AI SDKs, tsdav and Calendar codec/recurrence libraries. No bundle attribution map was generated, so their exact byte shares are not claimed. No optimization or config edit was made.

## 12. Worktrees, local-only work and docs drift

Registered original worktrees: primary recovery, Tasks (`office360-main-check`), baseline. Audit adds isolated main/docs, Calendar and macOS worktrees; they are retained, not deleted. Additional sibling clones `velo` and `velo-office360-i18n` were inspected separately (they use GitVerse, not the GitHub primary remote).

| Worktree/clone relative to YALINUX360 | Branch / tip | Dirty files | Ahead/remote observation |
|---|---|---|---|
| velo-office360-api-ya-clean | codex/efim-telemost-recovery-002 / 9f0a230 | NONE | Ahead design upstream 1; pushed same-name origin tip |
| office360-main-check | feat/tasks-yandex-tracker / b71c80e | NONE | 0/0 same-name origin |
| velo-baseline-office360-2026-08-11 | baseline/office360-2026-08-11 / 5d17112 | `src-tauri/Cargo.toml` | Empty textual diff; EOL/index noise; remote equal |
| velo | office360-mail-workflow / af97141 | `src-tauri/Cargo.toml` | After GitVerse fetch: 1 ahead / 15 behind; local-only layout fix |
| velo-office360-i18n | office360-i18n / 2abd9a1 | `src-tauri/Cargo.toml` | 0/0 upstream; empty textual diff |
| office360-audit-2026-09 | audit/office360-current-state-2026-09 | This document until commit | Based on exact main |
| office360-audit-calendar-2026-09 | detached e3604e8 | NONE tracked | Verification checkout |
| office360-audit-macos-2026-09 | detached 2801704 | NONE tracked | Verification checkout |

Every dirty file found is enumerated above. No content correction/staging was made in these old worktrees. No relevant untracked files appeared in their normal git status. Ignored runtime/assets are not “lost uncommitted production code.”

Globally unpushed branch-reachable work in primary repository: `12d615d` old final integration merge and `829df8e` QA docs on `merge/gorgdev-efim-final`. Separate clone `af97141a706365ac09a35478b72bb0bdca463b96` fixes messenger overlap; not present in fetched primary objects and not reachable from refreshed GitVerse remotes. Preserve for patch review, not automatic integration.

Three primary stashes: design WIP (39 named files), GORGDEV unrelated WIP (236), files-section leftovers (7). They may overlap already committed work; no claim that all are unique. Nothing was applied/dropped. Stash contents and potential sensitive artifacts were not dumped into this public report.

Docs drift:

1. REPO-AUDIT-001's default-branch, no-required-checks and macOS-v34 collision findings are superseded by fresh refs/API/source. Historical audit should stay historical.
2. Workspace CURRENT_STATE says design stages unpushed; remote refs show design freeze and recovery pushed. Repository CURRENT_STATE remains at Aug 27 design and omits Aug 29 Tasks/current recovery branch.
3. TASKS_YANDEX_TRACKER_PROVIDER calls provider “Production-ready”; current code/config/live evidence does not support that. Final Tasks automated audit admits live mutation NOT RUN but understates real Directory integration defects.
4. Calendar DONE means scoped implementation on an unmerged feature branch, not main deployment or full Yandex parity.
5. Development doc's 130-test-file count is stale versus all current branch counts.
6. Main does not contain Calendar/People/design/Tasks docs and features just because they exist in a newer worktree. Source/Git location must accompany DONE/PASS statements.

## 13. Merge / integration map

| Question | Answer |
|---|---|
| Should PR #4 still merge? | **YES after required approval and accepted scoped/live/security boundary**, not an instruction to merge now |
| Is PR #4 technically mergeable? | YES, current GitHub result; four required checks success; zero behind main |
| Should Tasks branch merge now? | **NO**: code/config blockers, inherited tests and unreviewed integration |
| Does Tasks need missing People code just to compile? | **NO**; it has a partial independent domain/picker and builds |
| Does Tasks need People consolidation for intended shared architecture? | **YES**; complete PEOPLE-001 absent, same-path divergent domain |
| Does Tasks contain Calendar commits? | **NO** |
| Will Calendar-first complicate Tasks reconciliation? | **YES**, 11 overlapping paths need semantic reconciliation; this does not justify bypassing Calendar |
| Should Tasks merge/rebase main after PR #4? | Recommendation: integrate updated main in a dedicated follow-up, preserve both OAuth and migration contracts, rerun gates; **not performed** |
| macOS remains separate? | **YES**; port only specifically reviewed shared fixes |

Recommended order: (1) approve/revalidate Calendar PR #4; (2) reconcile Tasks against resulting main, repair Directory/ORG flow and tests, then create/review a Tasks PR; (3) integrate frozen design and Telemost recovery with their own exact-head checks and shared UI/auth reconciliation; (4) keep macOS as a separate release line with migration-provenance/native build review. Security triage is required before a production release regardless of this code-integration order. Audit docs branch may be reviewed independently.

No merge or conflict-resolution commit was made. Prospective overlaps and in-memory SQL union are audit evidence only.

## 14. Next actions — maximum ten

| When | Action / why | Branch | Risk | Scope |
|---|---|---|---|---|
| NOW 1 | Review this audit and obtain PR #4 approval; it brings verified Calendar/People/CI and fixes baseline test contracts | feat/calendar-yandex360 | Accepted provider/live limitations; preserve security gate | SMALL |
| NOW 2 | Repair Tasks Directory endpoint, grant selection and pagination; mocked provider acceptance currently misses real boundary | feat/tasks-yandex-tracker | Wrong account / incomplete directory identity | MEDIUM |
| NOW 3 | Implement shared ORG-001 and fix disappearing Tracker org input | Tasks integration line | Account/org mix-up | MEDIUM |
| NOW 4 | Establish primary org, correct grant, existing queue and Tracker entitlement in a separately authorized session | Tasks/runtime config | Account/tenant writes require explicit authorization | SMALL–MEDIUM |
| NEXT 5 | Reconcile Tasks with Calendar/main; preserve People helper, b71c80e and all migration blocks; rerun full checks | Tasks integration line | Semantic conflicts across 11 files | MEDIUM |
| NEXT 6 | Triage npm critical/high and run exhaustive Rust advisory scan; prepare isolated dependency fixes | New security branch | Regression / actual exploitability needs assessment | MEDIUM |
| NEXT 7 | Fix Release Please repository permission and validate release workflows | CI follow-up | Publishing automation permissions | SMALL |
| NEXT 8 | Run controlled Tauri/live acceptance for create/edit/transition/assignee/Calendar writes only with separate authorization | Validated feature heads | Real cloud mutations | MEDIUM |
| LATER 9 | Integrate frozen design/recovery and validate macOS natively, including old-v34 DB provenance | design/recovery + separate macOS | Platform/auth migration divergence | LARGE |
| LATER 10 | Review unpushed commits/stashes and docs; address bundle/god modules incrementally | Separate cleanup follow-ups | Lost intent if blindly deleted | MEDIUM |

### Audit publication and limitations

Audit branch: `audit/office360-current-state-2026-09`. Requested commit message: `docs(audit): record current Office360 project state`. This document is the sole intended commit payload. The containing Git commit identifies publication (no self-referential hash is embedded); final task response records exact commit and remote verification.

Local verification evidence lives outside the repository in sibling `office360-audit-evidence-2026-09` (branch inventory, Git graph, test/build/cargo logs, safe metadata, migration scenarios, dependency JSON). These files are not published because logs/metadata should not be dumped into a public repository. They are reproducible with the commands described above.

**What was not changed:** production code/config, secrets, shared runtime data, dependencies/locks, feature refs. **Checks:** tables above. **Remaining blockers:** live/native/full security coverage and enumerated code/config issues. **Next concrete step:** review this audit and complete PR #4's required review gate; do not start automatic fixes.

No merges performed. No branches deleted. No production/cloud/OAuth mutations. No application migrations applied.
