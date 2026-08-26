# Calendar ACL management

Дата: 2026-08-24 (Asia/Bangkok)

CAL-128 adds a provider-neutral sharing boundary on top of CAL-119 effective permissions. It does not introduce durable ACL storage: providers remain the source of truth and a successful mutation is followed by the ordinary calendar-access refresh.

## Domain contract

`CalendarShareEntry` separates the principal identity from its share role and provider entry identity. `CalendarShareRole` normalizes provider roles to:

- `owner`;
- `writer`;
- `reader`;
- `free-busy-only`.

`CalendarAclService` owns `list`, `grant`, `updateRole` and `revoke`. UI code never branches on provider names. It consumes dynamic `CalendarAclCapabilities`, while the service independently enforces CAL-119 `canRead` / `canManageSharing` before provider I/O.

Email principals use the existing Calendar participant normalization. `MAILTO:` and casing-equivalent values are duplicate identities; provider-specific alias rules such as Gmail dots or plus stripping are not applied.

## Safety invariants

- Unknown capability state is not writable.
- Owner, current-user and provider-protected entries cannot be demoted or revoked.
- Ownership transfer is not exposed by the normalized role picker.
- A duplicate normalized principal is rejected before insert.
- Provider bodies, credentials, tokens and authorization headers never reach React or diagnostics.
- Per-entry failures are typed and sanitized.
- A successful mutation refreshes CAL-119 access metadata through provider discovery; SQLite is not patched as an ACL source of truth.

## Google

Google uses the official Calendar API ACL collection and entry resources: list, insert, update and delete. `owner`, `writer`, `reader` and `freeBusyReader` map directly to normalized roles. User, group, domain and default/public scopes remain distinct principal types.

Read requires a saved grant containing the full Calendar scope, `calendar.acls`, or `calendar.acls.readonly`. Write requires the full Calendar scope or `calendar.acls`. A missing or legacy-unknown saved scope yields `reauthorization-required`; it is never treated as writable. New Google authorization requests include the narrow `https://www.googleapis.com/auth/calendar.acls` scope, and normal account/reauthorization persistence stores the granted scope snapshot.

Provider-level owner/current-user checks run again immediately before update/delete, so stale UI state cannot bypass self-lockout protection.

## CalDAV and Yandex

The generic adapter uses only RFC 3744 WebDAV ACL mechanisms. Read-only discovery performs `OPTIONS` plus depth-zero `PROPFIND` for owner, current-user privileges, supported privileges, ACL restrictions, principal collections and the ACL property.

ACL read is enabled only when `DAV:read-acl` and the ACL property are exposed. ACL write is enabled only when all of the following are confirmed: DAV `access-control`, the `ACL` method, `DAV:write-acl`, readable ACL state and a principal collection. Email grants resolve a principal with `principal-property-search`; no private endpoint, web scraping or provider-name bypass exists.

When rewriting an ACL, the adapter preserves every raw existing ACE, including deny, inherited, protected and otherwise unrecognized entries. Owner/current-user/protected entries remain non-mutable. If any required discovery fact is absent, the result is `unsupported` and no ACL request is sent.

Yandex uses this exact generic contract. Live acceptance is read-only: no real Google or Yandex share mutation is permitted by CAL-128.

## UI and reconciliation

An owned/manageable calendar exposes a sharing entry point in its calendar-list menu. The dialog lists participants and roles and, only when dynamic write discovery succeeds, enables add, role change and revoke controls. Loading, unsupported, reauthorization, permission-denied and generic safe error states are explicit.

After grant/update/revoke, `CalendarAclService` invokes the existing access refresh. A refresh failure is reported without retrying the mutation, preventing duplicate remote writes.

## Persistence and migration

Migration: **NONE**. CAL-119 already persists effective calendar access metadata. Share entries are read from the provider on demand and are not copied into a second durable ACL table.

## Provider references

- Google OAuth scopes: <https://developers.google.com/workspace/calendar/api/auth>
- Google Calendar ACL reference: <https://developers.google.com/workspace/calendar/api/v3/reference>
- WebDAV Access Control Protocol (RFC 3744): <https://www.rfc-editor.org/rfc/rfc3744>
