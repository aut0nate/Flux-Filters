# Flux Filters

## Introduction

Flux Filters is a personal web app for managing Miniflux feed-level block and allow rules in a simpler way.

It is for Miniflux users who want an easier way to manage regex filters without editing long blocks of raw rule text directly in the Miniflux interface. The app reads the current rule text from Miniflux, lets you inspect and edit it in a clearer interface, and writes the updated plain-text rules back in the same format Miniflux already expects.

![Screenshot or Preview](./images/Flux-Filters-Home.png)

## Features

- View feeds and see which ones already have rules
- Create block and allow rules using regex
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

Example `.env`:

```bash
PORT=3000
MINIFLUX_ALLOWED_HOSTS=miniflux.example.com
```

Environment notes:

- `PORT` - controls which port the Express server uses. The default is `3000`.
- `MINIFLUX_ALLOWED_HOSTS` - limits which Miniflux hostnames the proxy will talk to.

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

Use Docker locally when you want to test the application before deploying to your server. Start by building the image:

1. Build and start the local container:

   ```bash
   docker compose up --build
   ```

2. Open [http://localhost:3000](http://localhost:3000).

Notes:

- The local `docker-compose.yaml` file publishes port `3000` to `localhost`.
- There are no mounted data folders because the app does not store application data locally.
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

## AI-Assisted Development

Flux Filters was built with **OpenAI Codex using GPT-5.4**. This repository includes an [`AGENTS.md`](./AGENTS.md) file, which provides structured instructions and context for AI coding agents. It defines expectations, constraints, and project-specific guidance to help keep contributions consistent and reliable.

## Contributions

Contributions, ideas, and suggestions are welcome.

If you have improvements, feature ideas, or bug fixes, feel free to open an issue or submit a pull request. All contributions are appreciated and help improve the project.

## License

This project is licensed under the MIT License. See [LICENSE.md](./LICENSE.md) for details.
