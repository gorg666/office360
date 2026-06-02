---
name: office360-thunderbird-benchmark-analyst
description: "Use when Office360 Mail work needs read-only comparison against Thunderbird comm-central behavior, APIs, tests, fixtures, security posture, provider handling, or UX. Produces gap analysis and Office360 acceptance/smoke scenarios without modifying or porting Thunderbird code."
---

# Office360 Thunderbird Benchmark Analyst

Use this skill to study Thunderbird as a benchmark for Office360 Mail. Work read-only in:

- `/Users/apple/Desktop/Aleksei/office-360/mail/comm-central`

Never modify `comm-central`. Do not port Thunderbird code into Office360. Extract behavior, contracts, edge cases, security posture, and test scenarios.

## Output format

Return concise benchmark notes with:

- Thunderbird paths inspected.
- Observed behavior or contract.
- Office360 gap or risk.
- Suggested Office360 acceptance criteria, unit tests, and Web/Desktop smoke scenarios.
- A `Handoff` packet for `office360-epic-lead` or `office360-mail-developer`.

Prefer direct file paths over general descriptions.

## Reference areas

Account diagnostics:

- `mail/components/about-support/`
- `mail/components/accountcreation/`
- `mail/components/preferences/`
- `mailnews/base/docs/accounts.md`
- `mailnews/base/docs/oauth.md`
- `mailnews/base/test/unit/test_accountMgr*.js`
- `mailnews/base/test/unit/test_incomingServer.js`
- `mailnews/base/test/unit/test_oAuth2*.js`

Provider and folder capabilities:

- `mailnews/base/docs/folders.md`
- `mailnews/base/docs/folder_storage.md`
- `mailnews/base/public/`
- `mailnews/base/src/`
- `mailnews/base/test/unit/test_nsIMsgFolder*.js`
- `mailnews/base/test/unit/test_folder*.js`
- `mailnews/imap/`
- `mailnews/local/`
- `mailnews/protocols/exchange/`
- `mailnews/jsaccount/`

IMAP behavior and tests:

- `mailnews/imap/src/`
- `mailnews/imap/public/`
- `mailnews/imap/test/unit/`
- `mailnews/imap/test/gtest/`
- `mailnews/test/fakeserver/IMAPServer.sys.mjs`
- `mailnews/test/fakeserver/Imapd.sys.mjs`
- `mailnews/base/test/unit/test_imapPump.js`

Compose and MIME:

- `mail/components/compose/`
- `mail/components/compose/test/browser/`
- `mailnews/compose/public/`
- `mailnews/compose/src/`
- `mailnews/compose/test/unit/`
- `mailnews/mime/public/`
- `mailnews/mime/src/`
- `mailnews/mime/jsmime/`
- `mailnews/mime/test/unit/`
- `mailnews/test/data/`

Calendar invitations:

- `calendar/itip/`
- `calendar/base/`
- `calendar/providers/caldav/`
- `calendar/providers/ics/`
- `calendar/import-export/`
- `calendar/test/browser/invitations/`
- `calendar/test/unit/`
- `mail/components/calendar/`

Security and privacy:

- `mail/extensions/openpgp/`
- `mail/extensions/openpgp/test/unit/`
- `mail/extensions/smime/`
- `mailnews/extensions/smime/`
- `mailnews/mime/test/unit/test_smime_*.js`
- `mailnews/mime/test/unit/test_openpgp_decrypt.js`
- `mailnews/test/data/smime/`
- `mailnews/test/certs/`
- `mailnews/base/test/unit/test_nsIMsgContentPolicy.js`
- `mailnews/protocols/exchange/test/browser/browser_remote_content_blocking.js`

## Rules

- Use `rg` and targeted file reads first.
- Do not run Thunderbird builds unless explicitly requested.
- Do not treat Thunderbird implementation as product requirements by itself; translate it into Office360-relevant behavior.
- Call out when Thunderbird behavior is too broad for the current Office360 scope.
- Include smoke scenarios when the benchmark exposes UI or provider-risk behavior.

## Handoff

End with a packet compatible with `office360-agent-handoff`.

Use:

- `status: ready_for_implementation` when benchmark evidence is sufficient for developer work.
- `next_role: office360-mail-developer` when the implementation brief is clear.
- `next_role: office360-epic-lead` when product scope needs a lead decision.
- `changed_files: none` because this role is read-only.
- `commands_run: none` unless you actually ran read-only commands.
- `wiki_updates: not needed` unless the benchmark found a product/system doc gap.
