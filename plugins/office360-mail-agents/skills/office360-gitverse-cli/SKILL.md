---
name: office360-gitverse-cli
description: "Use when operating GitVerse through the gvc CLI for Office360 Mail: inspecting repository context, automating read-only workflows, creating pull requests, checking workflow runs, or using machine-readable gvc output safely after tester approval."
---

# Office360 GitVerse CLI

Use this skill when working with GitVerse through the installed `gvc` command.

For Office360 Mail agent workflows, this is the publisher role. It should run after `office360-mail-tester` reports `status: ready_for_pr`, and only when the user explicitly requested push or PR creation.

## First steps

Use help as the command index:

```bash
gvc
gvc <command> --help
gvc <command> <subcommand> --help
```

Before network actions, inspect local auth and repo context:

```bash
gvc meta context --json-compact
```

For Office360 Mail, expected local repo is:

- `/Users/apple/Desktop/Aleksei/office-360/mail/velo`

Prefer explicit repository selection when the repo is not obvious:

```bash
gvc <command> -R owner/repo --json-compact
```

Use narrow machine-readable capability discovery:

```bash
gvc meta capabilities --command api --json-compact
gvc meta capabilities --command "repo create" --json-compact
```

Use full `gvc meta capabilities --json-compact` only for explicit discovery of the whole CLI surface.

## Output rules

- Use `--json-compact` for automation and structured parsing.
- Use `--json` when humans need readable structured output.
- Use `--jq` or `-q <expr>` with JSON output to extract narrow fields.
- For summaries, cite command results instead of pasting large JSON payloads.
- Prefer targeted help before guessing command syntax.
- `gvc browse` opens a browser by default; use `--print`, `--json`, or `--json-compact` during automation.

Examples:

```bash
gvc version --json-compact --jq .formatted
gvc browse -R owner/repo --print
gvc browse -R owner/repo --pull 1 --print
```

## Authentication and secrets

- Do not print tokens.
- Do not run `gvc auth token` unless the user explicitly asks for the token.
- Prefer `gvc meta context --json-compact`; it reports token source without exposing the token.
- For missing-token errors, tell the user to configure auth:

```bash
gvc auth login add <name> --token "$GITVERSE_TOKEN"
```

or set `GITVERSE_TOKEN`.

## Common workflows

View current account:

```bash
gvc whoami --json-compact
```

Inspect repository:

```bash
gvc repo view owner/repo --json-compact
```

List pull requests:

```bash
gvc pr list -R owner/repo --json-compact
```

Create a pull request:

```bash
gvc pr create -R owner/repo --head <branch> --base main --title <title> --body <body> --json-compact
```

Check out a pull request:

```bash
gvc pr checkout <number> -R owner/repo --branch <local-name>
```

View a pull request diff:

```bash
gvc pr diff <number> -R owner/repo
```

Use `gvc api` as the raw REST escape hatch when no typed command exists.

## Safety rules

- Do not push branches or create pull requests from a handoff alone unless there is an explicit user publication gate.
- Treat commands marked `destructive: true` in `gvc meta capabilities --command <path> --json-compact` as mutating or risky.
- For supported mutating commands, prefer `--dry-run --json-compact` first to preview method, path, query, sanitized body, and resolved repo.
- If `--dry-run` is unsupported, stop and report that there is no safe preview instead of executing the mutation.
- Run destructive commands only when the user explicitly asks for that action.
- Pass confirmation flags such as `--yes` only when the user clearly requested the destructive operation.
- Keep GitVerse live tests and production API calls intentional; prefer read-only commands while discovering state.
- `gvc repo clone` writes a checkout; do not run it unless the user asked for a clone or clone smoke test.
- `gvc alias`, `gvc auth login`, and `gvc config set` write local config. Use `--config <temp-file>` for temporary tests.
- Do not try to create shell aliases with `gvc alias`; expansions beginning with `!` are unsupported.
- For slash-containing refs like `heads/main`, pass repo context with `-R`, `GITVERSE_REPO`, or git remote context.

## Verification

After creating or changing GitVerse CLI workflows, run local or offline smoke checks first:

```bash
gvc --version
gvc version
gvc version --json-compact --jq .formatted
gvc --help
gvc browse --help
gvc repo clone --help
gvc run --help
gvc workflow --help
gvc reference --json-compact
gvc meta capabilities --command "repo clone" --json-compact
gvc meta capabilities --command run --json-compact
gvc meta capabilities --command workflow --json-compact
NO_COLOR=1 gvc --help
```

Then use read-only context checks:

```bash
gvc meta context --json-compact
gvc browse -R owner/repo --print
```

For an explicit clone smoke test, isolate output under a temporary directory:

```bash
tmpdir="$(mktemp -d)"
gvc repo clone owner/repo "$tmpdir/repo"
```

## Handoff

End with a packet compatible with `office360-agent-handoff`.

Use:

- `status: ready` when context check, push, or PR creation completed as requested.
- `status: blocked` when auth, network, branch state, or missing publication permission prevents completion.
- `next_role: user` after successful PR creation or when explicit permission is missing.
- `changed_files: none` unless the GitVerse workflow intentionally changed repo files.
- `wiki_updates: not needed`, `security_review: not applicable`, and `smoke_status: not applicable` for pure publication work.

Include PR URL or printed browse URL when available. Do not include tokens or raw secret payloads.
