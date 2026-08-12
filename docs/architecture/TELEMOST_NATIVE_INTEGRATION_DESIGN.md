# Telemost native integration design

Date: 2026-08-12
Branch: `macos/office360-stabilization`

## Official API capabilities

The official Yandex Telemost interface is a business-only REST API. It supports:

- creating a conference or live stream and obtaining `id` plus `join_url`;
- reading a conference by ID, including access/waiting-room, live-stream and optional SIP data;
- updating waiting-room, live-stream, cohost and auto-summarization settings;
- reading, replacing, adding and removing cohosts;
- reading and updating organization-wide defaults (administrator-only).

The published reference does not expose a conference-list endpoint, participant-presence/status feed, meeting title/date scheduling model, or media transport/rendering API. Office360's upcoming/recent/my-meeting lists must therefore combine locally created conferences, Calendar events containing Telemost links, and local visit history.

## Official embed/Web SDK

**NO.** The official Telemost documentation describes REST management endpoints and join URLs. Its published reference contains no Embed SDK, Web SDK, iframe integration, JavaScript SDK, media SDK, or reusable video-surface component. Phase 1 must not use undocumented endpoints or DOM/CSS injection.

## Required scopes

- `telemost-api:conferences.create` — native create flow.
- `telemost-api:conferences.read` — conference/cohost/default-settings reads.
- `telemost-api:conferences.update` — conference/cohost/default-settings changes.

These scopes are documented for Yandex 360 for Business organization accounts. They must later be added only to the existing communications grant after its current client configuration has been verified. Mail and Work grants remain separate and unchanged.

## Current grant gap

The current communications token received HTTP 403 from conference creation and does not provide usable `telemost-api:conferences.create` access for the connected account. Phase 1 does not modify scopes, OAuth client configuration, or credentials.

## Product architecture

`TelemostPage` is an Office360 React service surface: native header/actions, search and meeting filters, Calendar-backed upcoming/invited meetings, locally created meetings, visit history, and native meeting cards. Generic Telemost/Yandex pages are never used as the service home.

Renderer routing:

- Windows: validated meeting URL → existing CEF renderer.
- macOS: validated meeting URL → owned WKWebView meeting window.
- other/renderer failure: validated meeting URL → Tauri system-browser opener.

The remote renderer is only a meeting media/join surface. It has no Office360 capability scope or privileged Tauri IPC.

## Flows

Create: Office360 form → existing Telemost REST service → conference plus `join_url` → local native list → Join/Copy. Until the grant is verified, an API error stays in Office360 and never falls back to a generic website.

Schedule: Office360 action → native Calendar integration. Calendar may create a Telemost link through its supported event model; generic Yandex Calendar UI is not opened.

Join: Office360 dialog → strict Telemost `/j/` URL validation → platform renderer → browser fallback on renderer failure.

## Redirect protection

The macOS renderer allows the concrete Telemost meeting route and the exact Yandex session-bootstrap/Passport/OAuth routes observed during runtime. A generic Telemost home, generic Yandex home, or unrelated Yandex service is denied and reported to the native page, which offers Retry and Open in browser. Custom schemes are denied and are not passed to the opener.

## Migration

1. Phase 1: make the Office360 page fully native, add native join dialog, meeting-only routing, redirect trap, and preserve fallback.
2. Verify the existing communications OAuth client and account eligibility separately.
3. Add only verified official Telemost scopes and native create/read/update behavior.
4. Expand native Calendar scheduling and meeting metadata without relying on a nonexistent list/media SDK.
5. Keep WKWebView/CEF isolated behind the meeting renderer boundary; do not inject into Yandex UI.

## Sources

- https://yandex.ru/dev/telemost/doc/ru/
- https://yandex.ru/dev/telemost/doc/ru/access
- https://yandex.ru/dev/telemost/doc/ru/conference-create
- https://yandex.ru/dev/telemost/doc/ru/conference-read
- https://yandex.ru/dev/telemost/doc/ru/conference-update
- https://yandex.ru/dev/telemost/doc/ru/cohosts-read
- https://yandex.ru/dev/telemost/doc/ru/settings-read
