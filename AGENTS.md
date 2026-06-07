# AGENTS.md

## Project overview

Flux Filters is a personal web app for managing Miniflux feed-level entry blocking and allow rules through the official Miniflux API. The app must preserve Miniflux’s existing rule model:

- Rules are stored as plain text
- Each rule is on a separate line
- Rule order matters
- The saved text must remain compatible with Miniflux without any custom conversion layer

This repository is intentionally focused on one job only: making Miniflux feed rules easier to inspect, add, edit, reorder, and remove.

The first companion workflow uses starred Miniflux entries as a review queue for creating new feed-level rules from reading context.

## Tools, languages, and frameworks

- React 18
- TypeScript
- Vite
- Express
- Node.js 20+
- Docker
- Vitest
- ESLint

## Architecture

- `src/client`: React front end
- `src/server`: Express server and Miniflux proxy
- `src/shared`: Shared types and rule parsing/compiling helpers
- `tests`: Unit tests

The browser holds the Miniflux API token in session storage only. The Express server does not persist sessions; it only validates input and forwards API calls to Miniflux.

## Build and test commands

- Install dependencies: `npm install`
- Run locally: `npm run dev`
- Lint code: `npm run lint`
- Build production assets: `npm run build`
- Start production server: `npm run start`
- Run tests: `npm run test`
- Run local Docker build: `docker compose up --build`
- Run production Compose shape: use `docker-compose.prod.yaml` on the VPS as `/opt/stacks/flux-filters/docker-compose.yaml`

## Code style guidelines

- Use TypeScript with strict typing.
- Prefer small, focused functions over large multi-purpose utilities.
- Keep user-facing text, comments, and documentation in British English.
- Preserve Miniflux terminology where relevant, especially `blocklist_rules`, `keeplist_rules`, and the official field names.
- Preserve the distinction between generated literal text rules and raw regex rules. Literal text should be escaped before saving; parsed Miniflux rules should remain regex unless the user changes them.
- Avoid hidden behaviour that changes rule text automatically.

## Testing instructions

- Add unit tests for parsing and compiling rules.
- When changing API behaviour, verify the request payload still matches Miniflux expectations.
- Before shipping changes, run `npm run lint`, `npm run test`, and `npm run build`.
- For Docker changes, run `docker compose up --build` locally and verify `http://127.0.0.1:3000/api/health`.

## Security considerations

- Never hardcode API tokens or server URLs tied to live environments.
- Keep `.env` files out of Git.
- Restrict the proxy in production with `MINIFLUX_ALLOWED_HOSTS`.
- Automatic dedupe uses `MINIFLUX_BASE_URL` and `MINIFLUX_API_TOKEN` from the server `.env`; never expose or log that token.
- Optional semantic dedupe uses OpenRouter only when `DEDUPE_LLM_ENABLED=true` and `OPENROUTER_API_KEY` is configured server-side. Do not expose the OpenRouter key to the browser.
- Failed-feed notifications use the same server-side Miniflux token plus `NTFY_ACCESS_TOKEN`; never expose or log either token.
- Do not log API tokens.

## Deployment notes

- The intended deployment target is a VPS using Docker Compose.
- The app is designed to sit behind a reverse proxy such as Nginx or Caddy.
- The public site for this project is expected to be `https://flux-filters.autonate.dev`.
- The Miniflux hostname should be explicitly allow-listed in `MINIFLUX_ALLOWED_HOSTS`.
- CI lives in `.github/workflows/ci.yaml` and runs linting, tests, the production build, Docker build, and a `/api/health` smoke test.
- CD lives in `.github/workflows/cd.yaml`, runs only after CI succeeds on `main`, publishes `ghcr.io/aut0nate/flux-filters:latest` and `ghcr.io/aut0nate/flux-filters:<full-git-sha>`, then deploys to the VPS over SSH.
- Required GitHub Actions secrets for deployment are `VPS_HOST`, `VPS_PORT`, `VPS_SSH_KEY`, and `VPS_USER`.
- The local `docker-compose.yaml` builds from source and publishes port `3000`.
- The production `docker-compose.prod.yaml` uses the GHCR image, `${IMAGE_TAG:-latest}`, and the external `edge-net` Docker network.
- The VPS should keep only `/opt/stacks/flux-filters/docker-compose.yaml` and `/opt/stacks/flux-filters/.env`; do not build from source there once image deployment is working.
- Runtime secrets belong in the VPS `.env` file, not in GitHub workflow files or the Docker image.
- Automatic dedupe is opt-in with `DEDUPE_AUTOMATION_ENABLED=true`, runs every `DEDUPE_INTERVAL_MINUTES`, checks unread entries from `DEDUPE_WINDOW_DAYS`, and stores its audit log at `DEDUPE_AUDIT_PATH`.
- Deterministic dedupe scoring can be tuned with `DEDUPE_CONFIG_PATH`; OpenRouter semantic matching should only receive titles, feed names, timestamps, and local scores.
- Failed-feed ntfy notifications are opt-in with `FAILED_FEEDS_NOTIFICATION_ENABLED=true`, publish to `NTFY_TOPIC`, and store change-detection state at `FAILED_FEEDS_STATE_PATH`.
- The Docker Compose files mount `flux-filters-data` at `/data` so the dedupe audit log and failed-feed notification state survive container restarts while the root filesystem remains read-only.

## Project constraints and rules

- This app manages feed-level entry blocking and allow rules only for now.
- It should read current rule text from Miniflux and write updated rule text back to Miniflux.
- It may read starred Miniflux entries to help create draft rules, but starring remains owned by Miniflux.
- It may mark duplicate unread entries as read when dedupe automation is explicitly enabled, and must keep a reviewable audit trail.
- It should not depend on the old YAML workflow.
- It should not introduce a database.
- The interface should make rule order visible because Miniflux stops on the first match.
