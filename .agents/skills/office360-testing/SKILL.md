---
name: office360-testing
description: How to test Office 360 (mail regression flows, Tauri vs Vite, Playwright, DevTools). Use when verifying mail Reply/Forward/Undo Send/Send and Archive or writing E2E checks.
---

# Office 360 — testing skill

For locating send/composer/outbox/test symbols before inventing paths: **Graphify-first** — see `office360-project` skill § Graphify-first.

## Environment modes

| Mode | Command | Use for |
|------|---------|---------|
| Full | `npm run tauri dev` | Real SQLite, OAuth, send/sync |
| Frontend | `npm run dev` | Layout/routing only |
| Static preview | `npx vite preview --host 127.0.0.1 --port 4173` | Built shell smoke |

**Important:** Vite preview loads shell (`title` ≈ `Офис360`, route `#/mail/inbox`) but Tauri `invoke` fails. Do not treat those console errors as product bugs when not in Tauri.

## Unit / static

```bash
npx tsc --noEmit
npx vitest run path/to/file.test.ts
npm run test   # when mail core changes
```

## Browser tooling

- **Playwright MCP** (`@playwright/mcp`) — scripted E2E / a11y snapshots.
- **Chrome DevTools MCP** + skills `chrome-devtools` / `browser-testing-with-devtools` — interactive debug.
- **webapp-testing** — Python Playwright patterns for local apps.

**Never send real external email** in automated suites unless the user explicitly orders it.

## MAIL regression flows

### MAIL-001 Reply

1. Tauri app → Inbox → open existing thread.  
2. Activate Reply (toolbar / shortcut / context menu).  
3. Enter body text.  
4. Send.  
5. Expect successful provider send (network/Tauri), message appears in thread, no unexpected console errors.  

### MAIL-002 Reply All

1. Open thread with multiple recipients.  
2. Reply All.  
3. Verify To/Cc recipients match reply-all rules.  
4. Send (or cancel after recipient assert if avoiding outbound mail).  
5. Confirm thread state.

### MAIL-003 Forward

1. Forward from thread.  
2. Choose recipient.  
3. Send or dry-run cancel after composer assert.  
4. Verify mode `"forward"` UI and quoted content presence.

### MAIL-004 Undo Send

1. Send with `undo_send_delay_seconds` > 0 (settings).  
2. Trigger Undo within window (`UndoSendToast`).  
3. Confirm message not permanently sent / draft restored per implementation.  

### MAIL-005 Send and Archive

1. Enable `sendAndArchive` in UI settings store.  
2. Send reply.  
3. Confirm archive applied when outcome is success (`Composer` / `InlineReply` paths).  

### MAIL-006 Error handling

1. Prefer safe simulation: offline, invalid account, or mocked provider failure in unit tests.  
2. Assert draft not lost, user-visible error, UI not hung.  
3. Do not corrupt production accounts.

## Smoke checklist (tooling)

- Shell opens, `#root` present, navigates toward mail inbox.  
- With Tauri: init completes without `invoke` TypeError.  
- Targeted Vitest green for touched stores/services.

## Definition of Done link

See `office360-project` skill — UI work needs runtime validation beyond build.
