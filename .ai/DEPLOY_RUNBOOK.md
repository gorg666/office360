# Deploy Runbook

> Verification commands for this project. Do not deploy without explicit user command.

## Local checks

```bash
npm run test
```

```bash
npm run build
```

- cargo check in src-tauri/ - only if Rust toolchain ready

## Post-deploy smoke

- TODO: add post-deploy smoke checks when deploy target is known

## APOSTLE / deploy guards

TODO: Add APOSTLE guard to destructive/deploy scripts if this project gets production deploy.

## Notes

- Run only checks relevant to the changed area.
- If a command is unknown or environment is not ready — mark TODO, do not guess.
- Never include secrets in commands or logs.
