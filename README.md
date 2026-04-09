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

## Configuration

1. Create a `.env` file:

   ```bash
   cp .env.example .env
   ```

2. Update `.env`:

   - `PORT`
   - `MINIFLUX_ALLOWED_HOSTS`

Environment notes:

- `PORT` defaults to `3000` for the Express server.
- `MINIFLUX_ALLOWED_HOSTS` should be set to the exact Miniflux host you trust.
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

## Run with Docker

1. Create a `.env` file if you have not already:

   ```bash
   cp .env.example .env
   ```

2. Create the external Docker network if needed:

   ```bash
   docker network create edge-net
   ```

3. Build and start the container:

   ```bash
   docker compose up --build
   ```

Notes:

- The Compose file expects an existing external Docker network called `edge-net`.
- The container exposes port `3000` to that Docker network and does not publish a host port directly.
- If you want to access it through a domain or reverse proxy, point that proxy at the `flux-filters` service on port `3000`.

## Security Notes

- Do not commit `.env` files or live credentials.
- Do not log Miniflux API tokens.
- Restrict `MINIFLUX_ALLOWED_HOSTS` to the Miniflux host you trust.
- The server acts only as a thin proxy and does not persist user sessions.

## AI-Assisted Development

Flux Filters was built with **OpenAI Codex using GPT-5.4**. This repository includes an [`AGENTS.md`](./AGENTS.md) file, which provides structured instructions and context for AI coding agents. It defines expectations, constraints, and project-specific guidance to help keep contributions consistent and reliable.

## Contributions

Contributions, ideas, and suggestions are welcome.

I am not a developer by trade, so if you have improvements, feature ideas, or bug fixes, feel free to open an issue or submit a pull request.
