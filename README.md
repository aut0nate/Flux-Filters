# Flux Filters

Flux Filters is a small web app for managing Miniflux feed-level block and allow rules without changing how Miniflux stores them.

It reads the existing plain-text rules from the Miniflux API, lets you inspect and edit them in a friendlier interface, and writes the exact newline-based text back to Miniflux. There is no database and no custom rules format.

## What it does

- Lists feeds and shows which ones already have rules
- Lets you edit block rules and allow rules per feed
- Preserves rule order, which matters because Miniflux stops on the first match
- Keeps the saved format compatible with Miniflux
- Stores the Miniflux API token in browser session storage only

## Stack

- React 18
- TypeScript
- Vite
- Express
- Node.js 20+
- Docker
- Vitest

## Local development

1. Install dependencies:

```bash
npm install
```

2. Start the development servers:

```bash
npm run dev
```

3. Open the app:

```text
http://localhost:5173
```

The Vite development server proxies `/api` requests to the Express server on port `3000`.

## Build and test

Build the production assets:

```bash
npm run build
```

Run the test suite:

```bash
npm run test
```

## Environment variables

Copy the example file before running in Docker or production:

```bash
cp .env.example .env
```

Available variables:

- `PORT`: Express server port inside the container. Default `3000`.
- `MINIFLUX_ALLOWED_HOSTS`: Comma-separated allow-list for Miniflux hosts. In production this should be set to your Miniflux hostname, for example `rss.autonate.dev`.

## Docker deployment on a VPS

The included Compose file is set up for a reverse-proxy-based deployment on an existing external Docker network called `edge-net`.

### 1. Prepare the server

Clone the repository onto the VPS and create the environment file:

```bash
cp .env.example .env
```

Edit `.env` and confirm the values:

```dotenv
PORT=3000
MINIFLUX_ALLOWED_HOSTS=rss.autonate.dev
```

Make sure the external Docker network already exists:

```bash
docker network ls
```

If `edge-net` does not exist yet:

```bash
docker network create edge-net
```

### 2. Start the app

```bash
docker compose up --build -d
```

Useful commands:

```bash
docker compose ps
docker compose logs -f
docker compose pull
docker compose up -d --build
```

### 3. How the container is exposed

- The service is attached to the external `edge-net` network
- It exposes port `3000` to other containers on that network
- It does not publish a host port directly
- It runs with a read-only root filesystem and `no-new-privileges`

That means Nginx Proxy Manager should connect to the container by its Docker service name on the shared network.

## Nginx Proxy Manager configuration

Create a new Proxy Host in Nginx Proxy Manager with these values:

- `Domain Names`: your public hostname, for example `flux-filters.autonate.dev`
- `Scheme`: `http`
- `Forward Hostname / IP`: `flux-filters`
- `Forward Port`: `3000`
- `Block Common Exploits`: enabled
- `Websockets Support`: enabled
- `Cache Assets`: optional, usually leave disabled at first

On the SSL tab:

- Request a new SSL certificate
- Enable `Force SSL`
- Enable `HTTP/2 Support`

Leave the Advanced tab empty unless you already have a specific Nginx rule you want to add.

Important:

- The Nginx Proxy Manager container must also be connected to `edge-net`
- The DNS record for your chosen hostname must point to your VPS

## GitHub publishing

If this repository does not already have the remote configured, add it:

```bash
git remote add origin git@github.com:aut0nate/Miniflux-Filter-Manager.git
```

Then commit and push:

```bash
git add .
git commit -m "Initial commit"
git branch -M main
git push -u origin main
```

If the remote already exists, update it instead:

```bash
git remote set-url origin git@github.com:aut0nate/Miniflux-Filter-Manager.git
```

## Security notes

- Do not commit `.env` files or live credentials
- Do not log Miniflux API tokens
- Restrict `MINIFLUX_ALLOWED_HOSTS` to the exact Miniflux host you trust
- The server acts only as a thin proxy and does not persist user sessions
