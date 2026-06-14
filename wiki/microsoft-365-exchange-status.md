# Microsoft 365 / Exchange Status

Дата: 2026-06-14
Статус: strategy/guardrail slice complete

## Decision

Office360 выбирает Graph-first стратегию для будущей native поддержки Exchange Online/Microsoft 365.

Текущий Microsoft OAuth setup остается IMAP/SMTP compatibility path для Outlook/Hotmail/Live и совместимых mailbox сценариев. Это не native Exchange/Graph adapter.

EWS не является default path. Он остается deferred future/legacy option для on-premises Exchange или исключений, где Graph не применим.

## Current Product Behavior

Supported:

- Outlook/Hotmail/Live mail through Microsoft OAuth over IMAP/SMTP.
- IMAP/SMTP server autodiscovery for Microsoft consumer domains.
- Local encrypted token storage and refresh through existing OAuth flow.

Planned/unsupported:

- Native Exchange Online/Microsoft 365 mail via Graph.
- Shared mailboxes.
- Send-as/delegated mailbox flows.
- Exchange calendar sync.
- Exchange contacts sync.
- EWS-based production adapter.

## Guardrails

- `provider = "exchange"` is reserved for future native Exchange/Graph support.
- Exchange capabilities are explicitly unsupported until an adapter exists.
- Provider factory rejects `exchange` accounts instead of falling back to IMAP.
- Add-account UI does not show Microsoft 365/Exchange as a provider choice until an adapter exists.
- Microsoft OAuth copy states that the current connection uses IMAP/SMTP.

## References

- Strategy ADR: `strategy/decision-log.md#dec-007-graph-first-стратегия-для-exchange-online`.
- OpenSpec change: `openspec/changes/epic-10-enterprise-exchange-strategy`.
- Microsoft Learn: EWS to Graph migration.
- Microsoft Learn: Microsoft Graph mail API.
- Microsoft Learn: OAuth for IMAP/POP/SMTP.
