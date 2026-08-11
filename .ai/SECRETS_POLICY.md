# Secrets Policy

**AI agents must NOT read, log, commit, or echo:**

| Category | Paths / items |
|---|---|
| Environment | `.env`, `.env.local`, `.env.deploy.local`, `.env.production`, `.env.*.local` |
| PHP config | `config.php`, `cms-config.php`, `api/config.php`, `api/cms-config.php` |
| CMS runtime | `cms/storage/**`, `cms/.env` |
| Credentials | API tokens, SMTP passwords, FTP credentials, OAuth secrets |
| Keys | `*.pem`, `*.key`, `*.crt` (private), service account JSON |

## Rules

1. Never open `.env*` files unless the user explicitly requests a **safe** operation (e.g. verify key *names* exist, not values).
2. Never paste secret values into chat, commits, or logs.
3. Never commit secrets — warn the user if staged files look sensitive.
4. Use `.env.example` / documented variable **names** only when scaffolding.

## If secrets are needed

Ask the user to set values locally or on the server. Do not invent credentials.
