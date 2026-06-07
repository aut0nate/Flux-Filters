# Flux Filters

## Introduction

Flux Filters is a personal web app for managing Miniflux feed-level block and allow rules in a simpler way.

It is for Miniflux users who want an easier way to manage regex filters without editing long blocks of raw rule text directly in the Miniflux interface. The app reads the current rule text from Miniflux, lets you inspect and edit it in a clearer interface, and writes the updated plain-text rules back in the same format Miniflux already expects.

![Screenshot or Preview](./images/Flux-Filters-Home.png)

## Features

- View feeds and see which ones already have rules
- Review starred Miniflux entries as filter candidates
- Review duplicate unread entries across feeds before marking newer matches as read
- Optionally run duplicate cleanup automatically and review the last 7 days of actions
- Create draft block rules from starred entry titles, authors, tags, or URLs
- Create block and allow rules using regex
- Use literal text mode for generated rules, or regex mode for exact Miniflux patterns
- Preserve rule order, which matters because Miniflux stops on the first match
- Keep saved rule text compatible with Miniflux without a custom conversion layer
- Update Miniflux feed rules without needing a separate database or custom format

## Stack

- Node.js 20+
- React 18
- TypeScript
- Vite
- Express
- Vitest
- Docker

## Requirements

Before running this project, install:

- Node.js 20 or newer
- npm
- Docker and Docker Compose, if you want to run the app with Docker

## Configuration (.env)

1. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

2. Update `.env` with the required values:

   - `PORT`
   - `MINIFLUX_ALLOWED_HOSTS`
   - Optional dedupe automation values, if you want Flux Filters to mark duplicates as read without the browser being open

Example `.env`:

```bash
PORT=3000
MINIFLUX_ALLOWED_HOSTS=miniflux.example.com
DEDUPE_AUTOMATION_ENABLED=false
DEDUPE_INTERVAL_MINUTES=30
DEDUPE_WINDOW_DAYS=7
DEDUPE_AUDIT_PATH=/data/dedupe-audit.jsonl
DEDUPE_CONFIG_PATH=/data/dedupe-config.json
DEDUPE_SIMILAR_TITLE_THRESHOLD=0.82
DEDUPE_LLM_ENABLED=false
DEDUPE_LLM_CANDIDATE_MIN_SCORE=0.35
DEDUPE_LLM_AUTO_CONFIDENCE=0.85
DEDUPE_LLM_MAX_PAIRS=30
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MODEL=google/gemma-4-26b-a4b-it
OPENROUTER_API_KEY=
MINIFLUX_BASE_URL=
MINIFLUX_API_TOKEN=
FAILED_FEEDS_NOTIFICATION_ENABLED=false
FAILED_FEEDS_INTERVAL_MINUTES=60
FAILED_FEEDS_STATE_PATH=/data/failed-feeds-notification-state.json
NTFY_BASE_URL=
NTFY_TOPIC=miniflux
NTFY_ACCESS_TOKEN=
```

Environment notes:

- `PORT` - controls which port the Express server uses. The default is `3000`.
- `MINIFLUX_ALLOWED_HOSTS` - limits which Miniflux hostnames the proxy will talk to.
- `DEDUPE_AUTOMATION_ENABLED` - set to `true` to run unread duplicate cleanup automatically.
- `DEDUPE_INTERVAL_MINUTES` - how often the automatic dedupe job runs. `30` is recommended.
- `DEDUPE_WINDOW_DAYS` - how far back unread entries are compared. The intended value is `7`.
- `DEDUPE_AUDIT_PATH` - where Flux Filters stores the JSONL audit log of marked-read duplicate groups.
- `DEDUPE_CONFIG_PATH` - optional JSON file for overriding dedupe scoring words and thresholds without editing code.
- `DEDUPE_SIMILAR_TITLE_THRESHOLD` - deterministic similar-title score required before an article is marked read.
- `DEDUPE_LLM_ENABLED` - set to `true` to let OpenRouter review borderline similar-title candidates.
- `DEDUPE_LLM_CANDIDATE_MIN_SCORE` - minimum local score before a pair is sent to OpenRouter.
- `DEDUPE_LLM_AUTO_CONFIDENCE` - minimum OpenRouter confidence required before a semantic match is marked read.
- `DEDUPE_LLM_MAX_PAIRS` - maximum number of candidate pairs sent to OpenRouter per dedupe run.
- `OPENROUTER_BASE_URL` - OpenRouter API base URL. The default is `https://openrouter.ai/api/v1`.
- `OPENROUTER_MODEL` - OpenRouter model used for semantic title checks.
- `OPENROUTER_API_KEY` - OpenRouter API key used only by the server. Keep this only in `.env` on the server.
- `MINIFLUX_BASE_URL` - Miniflux server URL used by the automatic dedupe job.
- `MINIFLUX_API_TOKEN` - Miniflux API token used by the automatic dedupe job. Keep this only in `.env` on the server.
- `FAILED_FEEDS_NOTIFICATION_ENABLED` - set to `true` to send ntfy alerts when Miniflux reports failed feeds.
- `FAILED_FEEDS_INTERVAL_MINUTES` - how often failed feeds are checked. `60` is recommended.
- `FAILED_FEEDS_STATE_PATH` - where Flux Filters stores the last notified failed-feed state to avoid repeated alerts.
- `NTFY_BASE_URL` - ntfy server URL used for failed-feed notifications.
- `NTFY_TOPIC` - ntfy topic used for failed-feed notifications.
- `NTFY_ACCESS_TOKEN` - ntfy bearer token used for publishing notifications. Keep this only in `.env` on the server.

### Optional Dedupe Tuning

Flux Filters always runs deterministic URL, exact-title, and similar-title matching first. If
`DEDUPE_LLM_ENABLED=true`, it then sends only borderline title pairs to OpenRouter for a semantic
decision. The OpenRouter request includes the two titles, feed names, timestamps, and local
similarity score; it does not send article bodies, URLs, or Miniflux credentials.

You can override the deterministic scoring defaults with `DEDUPE_CONFIG_PATH` without changing the
application code. For example:

```json
{
  "similarTitleThreshold": 0.82,
  "llmCandidateMinScore": 0.35,
  "llmAutoMatchConfidence": 0.85,
  "llmMaxPairs": 30,
  "genericSharedEntities": [
    "world cup",
    "world cup 2026",
    "premier league"
  ]
}
```

## Test Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Prepare the application:

   ```bash
   cp .env.example .env
   ```

3. Start the project:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173).

## Test Locally Using Docker

Docker is useful for checking the production container before server deployment. The local Compose file builds the image from this repository, reads `.env`, publishes the app on `127.0.0.1:3000`.

1. Start the local Docker stack:

    ```bash
    docker compose up --build
    ```

    The app will be available at `http://127.0.0.1:3001`.

2. Stop the stack:

    ```bash
    docker compose down
    ```

>[!Note]
The local Compose file is `docker-compose.yml`. The production source Compose file is `docker-compose.prod.yaml`.

Notes:

- The local `docker-compose.yaml` file publishes port `3000` to `localhost`.
- The `flux-filters-data` volume stores the dedupe audit log when duplicate cleanup is applied.
- The container runs with a read-only root filesystem and `no-new-privileges`.
- No first-run database or migration step is required.

## Server Deployment

You can run this on your own server by pulling the latest Docker image from `ghcr.io/aut0nate/flux-filters:${IMAGE_TAG:-latest}`.

Use the structure that fits your own environment and preferred deployment methods.
For public-facing access, put the service behind HTTPS using a reverse proxy such as Nginx Proxy Manager, Caddy, Traefik, or any other preferred method.

For most Docker-based deployments:

1. Create a directory in your chosen location on your server, for example `/opt/stacks/flux-filters`.
2. Change into this directory.
3. Ensure the `docker-compose.prod.yaml` file is saved in this directory.
4. Create a `.env` file:

   ```bash
   PORT=3000
   MINIFLUX_ALLOWED_HOSTS=<your-miniflux-host>
   IMAGE_TAG=latest
   DEDUPE_AUTOMATION_ENABLED=true
   DEDUPE_INTERVAL_MINUTES=30
   DEDUPE_WINDOW_DAYS=7
   DEDUPE_AUDIT_PATH=/data/dedupe-audit.jsonl
   DEDUPE_CONFIG_PATH=/data/dedupe-config.json
   DEDUPE_LLM_ENABLED=false
   OPENROUTER_API_KEY=
   MINIFLUX_BASE_URL=https://<your-miniflux-host>
   MINIFLUX_API_TOKEN=<server-side-miniflux-token>
   FAILED_FEEDS_NOTIFICATION_ENABLED=true
   FAILED_FEEDS_INTERVAL_MINUTES=60
   FAILED_FEEDS_STATE_PATH=/data/failed-feeds-notification-state.json
   NTFY_BASE_URL=https://<your-ntfy-host>
   NTFY_TOPIC=miniflux
   NTFY_ACCESS_TOKEN=<server-side-ntfy-token>
   ```

5. Create the external Docker network or use an existing one. If you use an existing network, update the `docker-compose.prod.yaml` file accordingly.

   ```bash
   docker network create edge-net
   ```

6. Start the public image:

   ```bash
   docker compose -f docker-compose.prod.yaml up -d
   ```

7. Verify the public URL after deployment.

Example production files:

- `docker-compose.prod.yaml`
- `.env`

After deployment, verify:

- The public homepage loads.
- The app can reach the expected Miniflux host.
- Existing rules can still be fetched and saved.
- The Duplicates page shows the last 7 days of articles Flux Filters marked read.
- Failed-feed notifications publish to the configured ntfy topic when Miniflux reports a changed set of failed feeds.

## AI-Assisted Development

Flux Filters was built with **OpenAI Codex using GPT-5.4**. This repository includes an [`AGENTS.md`](./AGENTS.md) file, which provides structured instructions and context for AI coding agents. It defines expectations, constraints, and project-specific guidance to help keep contributions consistent and reliable.


## Contributions

Contributions, ideas, and suggestions are welcome.

If you have improvements, feature ideas, or bug fixes, feel free to open an issue or submit a pull request. All contributions are appreciated and help improve the project.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.
