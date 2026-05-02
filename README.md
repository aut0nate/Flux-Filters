# Flux Filters

Flux Filters is a simple personal web app for managing Miniflux feed-level block and allow rules without changing how Miniflux stores them.

It was built to make managing regex filters for Miniflux feeds easier, while keeping the saved rule text fully compatible with Miniflux.

![Home](./images/Flux-Filters-Home.png)

## Stack

- React 18
- TypeScript
- Vite
- Express
- Node.js 20+
- Docker
- Vitest
- ESLint

## Configuration

1. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

2. Update `.env`:

   - `PORT`
   - `MINIFLUX_ALLOWED_HOSTS`
   - `IMAGE_TAG` for production Compose deployments, usually managed by CD

Environment notes:

- `PORT` defaults to `3000` for the Express server.
- `MINIFLUX_ALLOWED_HOSTS` should be set to the exact Miniflux host you trust.
- `IMAGE_TAG` selects the GHCR image tag used by production Compose. The CD workflow updates it to the deployed commit SHA.
- The browser stores the Miniflux API token in session storage only.
- The app reads and writes Miniflux rules as plain text, one rule per line, without introducing a custom format.

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   npm run dev
   ```

3. Open [http://localhost:5173](http://localhost:5173).

Notes:

- The Vite development server runs on port `5173`.
- `/api` requests are proxied to the Express server on port `3000`.

Before opening a pull request, run:

```bash
npm run lint
npm run test
npm run build
```

## Run with Docker

1. Create a `.env` file if you have not already:

   ```bash
   cp .env.example .env
   ```

2. Build and start the local container:

   ```bash
   docker compose up --build
   ```

3. Open [http://localhost:3000](http://localhost:3000).

Notes:

- The local Compose file builds from source and publishes port `3000`.
- Flux Filters does not need a local storage volume because it does not persist app data.

## CI/CD Deployment

Flux Filters uses separate GitHub Actions workflows for CI and CD.

CI runs on pull requests and pushes to `main`:

```bash
npm ci
npm run lint
npm run test
npm run build
docker build
```

The CI workflow also starts the built Docker image and checks `/api/health`.

CD runs only after CI succeeds on `main`. It builds and publishes GHCR images, then deploys the matching commit image to the VPS:

- `ghcr.io/aut0nate/flux-filters:latest`
- `ghcr.io/aut0nate/flux-filters:<full-git-sha>`

Required GitHub repository secrets for deployment:

- `VPS_HOST`
- `VPS_PORT`
- `VPS_SSH_KEY`
- `VPS_USER`

`VPS_SSH_KEY` should be a dedicated deployment private key, not a personal SSH key. The matching public key must be in the VPS deployment user's `~/.ssh/authorized_keys` file.

The GHCR package should be public unless you also configure Docker login on the VPS, because the production Compose file pulls the image directly from GHCR.

Recommended GitHub settings for `main`:

- Require a pull request before merging.
- Require status checks to pass.
- Require branches to be up to date before merging.
- Block force pushes.
- Restrict deletions.
- Use squash merging.
- Automatically delete merged head branches.

Required check:

```text
Lint, test and build Docker image
```

## VPS Deployment

The VPS should pull the published GHCR image instead of building from source. The deployment workflow copies `docker-compose.prod.yaml` to this server path:

```text
/opt/stacks/flux-filters/docker-compose.yaml
```

After image-based deployment is working, keep only these files on the VPS:

```text
/opt/stacks/flux-filters/docker-compose.yaml
/opt/stacks/flux-filters/.env
```

The VPS `.env` file should contain runtime configuration:

```bash
PORT=3000
MINIFLUX_ALLOWED_HOSTS=rss.autonate.dev
IMAGE_TAG=latest
```

The CD workflow updates `IMAGE_TAG` to the deployed commit SHA during each deployment.

The production Compose file expects an existing external Docker network called `edge-net`, so create it once if needed:

```bash
docker network create edge-net
```

Prepare the deployment directory once before the first deployment:

```bash
sudo mkdir -p /opt/stacks/flux-filters
sudo chown <vps-user>:<vps-user> /opt/stacks/flux-filters
chmod 755 /opt/stacks/flux-filters
```

If the deployment user cannot run Docker commands, add it to the Docker group:

```bash
sudo usermod -aG docker <vps-user>
```

The production container exposes port `3000` only to `edge-net`. Point the reverse proxy at the `flux-filters` service on port `3000`.

Manual rollback can be done by setting `IMAGE_TAG` in `/opt/stacks/flux-filters/.env` to a previous commit SHA and running:

```bash
cd /opt/stacks/flux-filters
docker compose pull
docker compose up -d
```

## Security Notes

- Do not commit `.env` files or live credentials.
- Do not log Miniflux API tokens.
- Restrict `MINIFLUX_ALLOWED_HOSTS` to the Miniflux host you trust.
- The server acts only as a thin proxy and does not persist user sessions.
- Do not store source code on the production server once image-based deployment is working.

## AI-Assisted Development

Flux Filters was built with **OpenAI Codex using GPT-5.4**. This repository includes an [`AGENTS.md`](./AGENTS.md) file, which provides structured instructions and context for AI coding agents. It defines expectations, constraints, and project-specific guidance to help keep contributions consistent and reliable.

## Contributions

Contributions, ideas, and suggestions are welcome.

I am not a developer by trade, so if you have improvements, feature ideas, or bug fixes, feel free to open an issue or submit a pull request.
