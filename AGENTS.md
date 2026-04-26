# AGENTS.md

## Project overview

Flux Filters is a personal web app for managing Miniflux feed-level entry blocking and allow rules through the official Miniflux API. The app must preserve Miniflux’s existing rule model:

- Rules are stored as plain text
- Each rule is on a separate line
- Rule order matters
- The saved text must remain compatible with Miniflux without any custom conversion layer

This repository is intentionally focused on one job only: making Miniflux feed rules easier to inspect, add, edit, reorder, and remove.

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
- Run production Compose shape: use `docker-compose.prod.yml` on the VPS as `docker-compose.yml`

## Code style guidelines

- Use TypeScript with strict typing.
- Prefer small, focused functions over large multi-purpose utilities.
- Keep user-facing text, comments, and documentation in British English.
- Preserve Miniflux terminology where relevant, especially `blocklist_rules`, `keeplist_rules`, and the official field names.
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
- Do not log API tokens.

## Deployment notes

- The intended deployment target is a VPS using Docker.
- The app is designed to sit behind a reverse proxy such as Nginx or Caddy.
- The public site for this project is expected to be `https://flux-filters.autonate.dev`.
- The Miniflux hostname should be explicitly allow-listed in `MINIFLUX_ALLOWED_HOSTS`.
- GitHub Actions publishes Docker Hub images from `main` as `aut0nate/flux-filters:latest` and `aut0nate/flux-filters:<full-git-sha>`.
- Required GitHub secrets are `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.
- The local `docker-compose.yml` builds from source and publishes port `3000`.
- The production `docker-compose.prod.yml` uses the published image and the external `edge-net` Docker network.
- The production server should keep only `docker-compose.yml` and `.env`; do not build from source on the VPS once image deployment is working.

## Project constraints and rules

- This app manages feed-level entry blocking and allow rules only for now.
- It should read current rule text from Miniflux and write updated rule text back to Miniflux.
- It should not depend on the old YAML workflow.
- It should not introduce a database.
- The interface should make rule order visible because Miniflux stops on the first match.
