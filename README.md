# Flux Filters

## Description

Flux Filters is a personal web app for managing Miniflux feed-level block and allow rules without changing how Miniflux stores them.

It is for Miniflux users who want an easier way to inspect, add, edit, reorder, and remove feed filters. The app keeps the saved rule text compatible with Miniflux by preserving plain text rules, one rule per line.

![Flux Filters home screen](./images/Flux-Filters-Home.png)

## Stack

- React 18
- TypeScript
- Vite
- Express
- Node.js 20+
- Docker and Docker Compose
- Vitest
- ESLint
- GitHub Actions
- GitHub Container Registry (GHCR)

## Features

- Sign in with a Miniflux server URL and API token.
- View feed-level Miniflux rule text in a clearer interface.
- Add, edit, reorder, and remove block rules and allow rules.
- Preserve Miniflux rule ordering and plain text formatting.
- Proxy Miniflux API requests through the Express server.
- Restrict allowed Miniflux hosts in production with `MINIFLUX_ALLOWED_HOSTS`.
- Package the app as a Docker image for VPS deployment.

## Requirements

Before running this project, install:

- Node.js 20 or newer. Node.js 22 is used in Docker and GitHub Actions.
- npm.
- Docker and Docker Compose, if you want to test or deploy the container.
- A Miniflux instance with API access enabled.
- A Miniflux API token.

For automated VPS deployment, you also need:

- A VPS with Docker and Docker Compose installed.
- An SSH deployment user, currently expected to be `deploy`.
- Access to the `/opt/stacks/flux-filters` deployment directory.
- A public GHCR package, unless you configure Docker login on the VPS.

## Configuration

1. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

2. Update `.env` with the required values:

   ```bash
   PORT=3000
   MINIFLUX_ALLOWED_HOSTS=rss.autonate.dev
   IMAGE_TAG=latest
   ```

Environment notes:

- `PORT` controls the Express server port. It defaults to `3000`.
- `MINIFLUX_ALLOWED_HOSTS` should contain the exact Miniflux host names the proxy is allowed to contact.
- `IMAGE_TAG` selects the GHCR image tag used by production Docker Compose. The CD workflow updates this to the deployed commit SHA.

Keep `.env` files out of GitHub. Use separate `.env` files for local development and production.

## Repository Layout

```text
.github/workflows/   GitHub Actions CI and CD workflows
images/              README screenshots
src/client/          React front end
src/server/          Express server and Miniflux proxy
src/shared/          Shared Miniflux parsing and compiling helpers
tests/               Vitest unit tests
Dockerfile           Production Docker image definition
docker-compose.yml   Local Docker Compose file
docker-compose.prod.yaml  Production Docker Compose file copied to the VPS
```

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the local environment file:

   ```bash
   cp .env.example .env
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:5173](http://localhost:5173).

Notes:

- The Vite development server runs on port `5173`.
- The Express server runs on port `3000`.
- `/api` requests from the front end are proxied to the Express server.

## Test Locally

Run linting:

```bash
npm run lint
```

Run the automated tests:

```bash
npm run test
```

Build the production assets:

```bash
npm run build
```

Before opening a pull request, run all three commands.

## Test Locally with Docker

Use Docker locally when you want to test the production container shape before pushing changes. Day-to-day development is usually faster with `npm run dev`.

1. Build and start the local container:

   ```bash
   docker compose up --build
   ```

2. Open [http://localhost:3000](http://localhost:3000).

3. Check the health endpoint:

   ```bash
   curl http://127.0.0.1:3000/api/health
   ```

Notes:

- The local Compose file builds from source.
- Port `3000` is published on the host.
- Flux Filters does not need a local storage volume because it does not persist app data.
- The production image runs as the non-root `node` user.

## CI/CD

This repository uses GitHub Actions to test changes, publish a Docker image, and deploy to a VPS.

The CI workflow runs on pull requests and pushes to `main`:

1. Install dependencies with `npm ci`.
2. Run linting.
3. Run automated tests.
4. Build the application.
5. Build the Docker image.
6. Start the Docker image and smoke test `/api/health`.

The CD workflow runs only after CI succeeds on `main`:

1. Build the Docker image from the exact commit that passed CI.
2. Publish these GHCR tags:

   ```text
   ghcr.io/aut0nate/flux-filters:latest
   ghcr.io/aut0nate/flux-filters:<full-git-sha>
   ```

3. Copy the production Compose file to the VPS.
4. Update `IMAGE_TAG` in the VPS `.env` file.
5. Run `docker compose pull` and `docker compose up -d`.
6. Prune unused Docker images.

If branch protection is enabled, require this status check before merging:

```text
Lint, test and build Docker image
```

## GitHub Secrets

Add these repository secrets for VPS deployment:

- `VPS_HOST` - the VPS hostname or IP address.
- `VPS_PORT` - the SSH port for the VPS.
- `VPS_SSH_KEY` - the private SSH key used by the deployment workflow.
- `VPS_USER` - the SSH deployment user, currently expected to be `deploy`.

Do not commit secrets to GitHub. `VPS_SSH_KEY` should be a dedicated deployment key, not a personal SSH key. The matching public key must be in the deployment user's `~/.ssh/authorized_keys` file on the VPS.

## Production

Production runs from the published GHCR image. The VPS should not build from source once image-based deployment is working.

The deployment path is:

```text
/opt/stacks/flux-filters
```

The final VPS structure should be:

```text
/opt/stacks/flux-filters/
  docker-compose.yaml
  .env
```

The production `.env` file should contain:

```bash
PORT=3000
MINIFLUX_ALLOWED_HOSTS=rss.autonate.dev
IMAGE_TAG=latest
```

The CD workflow copies `docker-compose.prod.yaml` from the repository to:

```text
/opt/stacks/flux-filters/docker-compose.yaml
```

The deployed Compose file should be owned by `nathan` and use the `deploy` group:

```text
-rw-r--r-- 1 nathan deploy ... docker-compose.yaml
```

The CD workflow installs it with:

```bash
sudo install -o nathan -g deploy -m 644 /tmp/flux-filters-docker-compose.yaml /opt/stacks/flux-filters/docker-compose.yaml
```

The `deploy` user needs passwordless sudo permission for that `install` command.

Create the reverse proxy network once if it does not already exist:

```bash
docker network create edge-net
```

Prepare the deployment directory once before the first deployment:

```bash
sudo mkdir -p /opt/stacks/flux-filters
sudo chown nathan:deploy /opt/stacks/flux-filters
sudo chmod 775 /opt/stacks/flux-filters
```

If the deployment user cannot run Docker commands, add it to the Docker group:

```bash
sudo usermod -aG docker deploy
```

The `deploy` user may need to log out and back in before the Docker group change takes effect.

The production container exposes port `3000` only to the external `edge-net` Docker network. Point the reverse proxy at the `flux-filters` service on port `3000`.

After deployment, verify:

- The public URL loads.
- The health endpoint returns `{"status":"ok"}`.
- Login works with your Miniflux URL and API token.
- Existing Miniflux rules still appear as expected.

Rollback can be done by changing `IMAGE_TAG` in `/opt/stacks/flux-filters/.env` to a previous commit SHA and running:

```bash
cd /opt/stacks/flux-filters
docker compose pull
docker compose up -d
```

## Usage

1. Open Flux Filters in your browser.
2. Enter your Miniflux URL and API token.
3. Select a feed from the sidebar.
4. Review the current block rules and allow rules.
5. Add, edit, reorder, or remove rules.
6. Save the changes back to Miniflux.

Flux Filters stores the Miniflux API token in browser session storage only. Closing the browser session clears the token.

## Backups and Persistence

Flux Filters does not store user data, uploaded files, a database, or local application state on the server.

The source of truth is still Miniflux. Back up Miniflux using your normal Miniflux backup process before making risky rule changes or larger Miniflux maintenance changes.

No `storage/` or `data/` folder is required for this project on the VPS.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| The app cannot reach Miniflux | `MINIFLUX_ALLOWED_HOSTS` does not include the Miniflux host | Update `.env`, then restart the app. |
| Login fails | The Miniflux URL or API token is wrong | Create a fresh Miniflux API token and try again. |
| CI fails during the Docker smoke test | The container did not start or `/api/health` failed | Check the GitHub Actions logs for the container output. |
| CD cannot write to `/opt/stacks/flux-filters` | The `deploy` user cannot write to the deployment directory | Run `sudo chown nathan:deploy /opt/stacks/flux-filters` and `sudo chmod 775 /opt/stacks/flux-filters` on the VPS. |
| CD fails at `sudo install` | The `deploy` user does not have passwordless sudo for `install` | Add a tightly scoped sudoers rule for the install command. |
| The VPS cannot pull the GHCR image | The GHCR package is private or Docker is not logged in | Make the GHCR package public, or configure Docker login on the VPS. |
| The reverse proxy cannot reach the app | The container is not attached to `edge-net` or the proxy points to the wrong service | Confirm the proxy uses `flux-filters:3000` on the `edge-net` network. |

## Security Notes

- Do not commit `.env` files or live credentials.
- Do not hardcode API tokens, SSH keys, passwords, or production host details.
- Keep production credentials separate from development credentials.
- Use a dedicated deployment SSH key for GitHub Actions.
- Restrict `MINIFLUX_ALLOWED_HOSTS` to the Miniflux host you trust.
- Do not log Miniflux API tokens.
- Rotate secrets if they are exposed.
- Keep dependencies updated through Dependabot and reviewed pull requests.
- Do not store source code on the VPS once image-based deployment is working.

## Licence

No licence file is currently included. Until a licence is added, treat this project as all rights reserved.

## AI-Assisted Development

Flux Filters was built with **OpenAI Codex using GPT-5.4**. This repository includes an [`AGENTS.md`](./AGENTS.md) file, which provides structured instructions and context for AI coding agents. It defines expectations, constraints, and project-specific guidance to help keep contributions consistent and reliable.

## Contributions

Contributions, ideas, and suggestions are welcome.

If you have improvements, feature ideas, or bug fixes, feel free to open an issue or submit a pull request. All contributions are appreciated and help improve the project.
