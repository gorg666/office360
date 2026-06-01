# Repository Guidelines

## Project Structure & Module Organization

Velo is a Tauri v2 desktop mail client with a React/TypeScript frontend and Rust backend. Frontend code lives in `src/`: UI in `src/components/`, state in `src/stores/`, business logic in `src/services/`, shared helpers in `src/utils/`, hooks in `src/hooks/`, and route setup in `src/router/`. Rust backend code lives in `src-tauri/src/`, with IMAP, SMTP, OAuth, commands, audio, and messenger integration modules. Static assets are in `src/assets/`, `public/`, and `assets/`. Documentation is in `docs/`; the marketing site is in `landing/`.

## Build, Test, and Development Commands

- `npm install` installs JavaScript dependencies.
- `npm run tauri dev` starts the full desktop app in development mode.
- `npm run dev` starts only the Vite frontend on port `1420`.
- `npm run build` runs TypeScript checks and builds the frontend.
- `npm run tauri build` creates native app bundles.
- `npm run test` runs the Vitest suite once.
- `npm run test:watch` runs Vitest in watch mode.
- `cd src-tauri && cargo build` builds the Rust backend only.

## Coding Style & Naming Conventions

Use strict TypeScript and the `@/` alias for imports from `src`. Keep React components in PascalCase, hooks prefixed with `use`, and tests colocated as `*.test.ts` or `*.test.tsx`. Prefer Tailwind CSS v4 utility classes and existing semantic color tokens. Use `lucide-react` icons. Rust code uses edition 2021; register new Tauri commands in `src-tauri/src/lib.rs` and update capabilities when adding plugin permissions.

## Testing Guidelines

Tests use Vitest with jsdom and Testing Library setup from `src/test/setup.ts`. Globals are enabled, so `describe`, `it`, and `expect` do not need imports. Add focused tests for new stores, services, hooks, utilities, and UI behavior. Run `npm run test` before submitting changes; use `npx vitest run <path>` for a single file.

## Commit & Pull Request Guidelines

Use Conventional Commits, matching project history: `feat(mail): ...`, `fix(accounts): ...`, `docs: ...`, `refactor: ...`, `test: ...`, or `chore: ...`. Keep PRs focused, describe user-visible changes, link related issues, include screenshots for UI updates, and confirm tests and type checks pass.

## Security & Configuration Tips

Copy required local settings from `.env.example`. Do not commit API keys, OAuth credentials, tokens, local databases, or generated build artifacts. For mail features, preserve local-first behavior, sanitized HTML rendering, encrypted credential storage, and remote image blocking.
