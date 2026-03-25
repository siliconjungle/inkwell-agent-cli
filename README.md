# inkwell-api-cli

Standalone terminal CLI for local Inkwell API work, including runtime room websocket sessions.

## What it does

- Sends authenticated or AI-dev-mode-friendly HTTP requests to the API.
- Signs runtime-room websocket tokens locally with `BACKEND_JWT_SECRET`.
- Keeps a persistent room websocket open for interactive use.
- Supports headless room entry without booting the browser runtime.
- Downloads the same published world JSON the room browser client loads via the room-token runtime proxy.
- Publishes a lightweight idle `play.state` for headless room entry so multiplayer ghost players render without a browser runtime.
- Shows room presence and chat history from the live `room.snapshot`.
- Sends room chat messages and character-selection updates.
- Sets or clears the current account avatar by character/entity id.

## Default identity

When the local backend is running in AI-dev mode, the CLI defaults to the same injected identity:

- `INKWELL_AI_DEV_USERNAME=inkwell`
- `INKWELL_AI_DEV_USER_ID=aeee5d67-e9c5-4540-a1d6-8c021c445e1b`
- `INKWELL_AI_DEV_EMAIL=ai-dev@localhost`
- `INKWELL_AI_DEV_ROLE=admin`

Override those with env vars or `--user-id`, `--username`, `--email`, `--role`.

## Env loading

The CLI merges env in this order and lets the shell win last:

1. `../inkwell-api-backend/.env`
2. `../inkwell-api-backend/.env.local`
3. `../inkwell-api-frontend/.env`
4. `../inkwell-api-frontend/.env.local`
5. `./.env`
6. `./.env.local`
7. current shell env

Important variables:

- `BACKEND_JWT_SECRET`
- `JWT_ISSUER`
- `NEXT_PUBLIC_API_BASE` or `INKWELL_API_BASE`
- `INKWELL_RUNTIME_PUBLIC_BASE_URL` for the frontend runtime proxy base (defaults to `http://localhost:3000`)
- `INKWELL_API_BEARER_TOKEN` for non-AI-dev HTTP calls

## Usage

```bash
npm install
node src/cli.js help
```

### Avatar commands

```bash
node src/cli.js avatar get
node src/cli.js avatar set --entity-id char-123
node src/cli.js avatar clear
```

### Generic API request

```bash
node src/cli.js request GET /inkwell/runtime/rooms/runtime-123
node src/cli.js request POST /inkwell/runtime/rooms --body-json '{"publishedWorldId":"pub-123"}'
```

### Room commands

```bash
node src/cli.js room create --published-world-id pub-123
node src/cli.js room info --room-id runtime-123
node src/cli.js room presence --room-id runtime-123
node src/cli.js room history --room-id runtime-123 --limit 20
node src/cli.js room connect --room-id runtime-123 --selection world-default --enter
```

### Interactive room session

Once connected, plain text sends chat only after you enter the room. Slash commands:

- `/help`
- `/enter`
- `/exit`
- `/presence`
- `/history [limit]`
- `/select world-default`
- `/select profile-avatar`
- `/state <x> <y> [facing]`
- `/snapshot`
- `/ping`
- `/quit`

When a room session connects, the CLI now also downloads the full published world JSON through the frontend runtime proxy using the same room token the browser client uses. Headless enter uses that world payload to find the authored player character and publishes the first idle `play.state` from that exact spawn point. If the world payload cannot be loaded or has no player character, the CLI falls back to the nearby-player heuristic and then `0,0`.
