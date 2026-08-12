# Fleet Core Development Quick Start

## Requirements

- Node.js 22 or newer
- npm

## Start the existing demo

```bash
npm run dev
```

The existing operator demo remains available at `http://127.0.0.1:4173`.

## Start the new Fleet Core API

The default mode keeps data in memory and is convenient for fast development:

```bash
npm run dev:core
```

The API starts at `http://127.0.0.1:4273`.

Open `http://127.0.0.1:4273` in a browser to view the Fleet Management screen.
It reads Fleet Core data from the same server. The health endpoint remains at
`/api/v1/health`.

## Start Fleet Core with PostgreSQL

Start PostgreSQL and copy the documented development configuration:

```bash
docker compose up -d --wait postgres
cp .env.example .env
set -a
source .env
set +a
npm run db:migrate
npm run dev:core:postgres
```

Then open `http://127.0.0.1:4273`. The dashboard reads the PostgreSQL-backed
Fleet Core snapshot and its **New mission** action creates a real mission through
the Fleet Core API.

Fleet Core also selects PostgreSQL automatically when `DATABASE_URL` is set.
The migration runner is safe to run more than once and rejects changes to an
already-applied migration. It retries transient startup connections for up to
30 seconds, which also covers PostgreSQL's first-run initialization restart.

PostgreSQL persists:

- Robot registration and last known state.
- Mission lifecycle and robot assignment.
- Every dispatch decision and candidate evaluation.
- Pending commands, delivery attempts, and adapter receipts.

Robot and mission reservation is committed in one database transaction.
Dispatch candidates are locked with `FOR UPDATE SKIP LOCKED`, so concurrent
Fleet Core instances cannot reserve the same robot. A command is added to the
outbox in that same transaction. Pending commands are retried with the same
`commandId` when Fleet Core restarts, so adapters must implement idempotent
command handling.

## Create and automatically dispatch a transport mission

```bash
curl -X POST http://127.0.0.1:4273/api/v1/missions \
  -H 'content-type: application/json' \
  -d '{
    "type": "TRANSPORT",
    "externalReference": "WMS-ORDER-1001",
    "priority": 70,
    "requiredCapabilities": ["pallet_transport"],
    "payloadKg": 300,
    "pickup": {
      "stationId": "WAREHOUSE-A",
      "mapId": "plant-a@1",
      "x": 10,
      "y": 5,
      "zoneId": "warehouse"
    },
    "dropoff": {
      "stationId": "ASSEMBLY-02",
      "mapId": "plant-a@1",
      "x": 70,
      "y": 25,
      "zoneId": "production"
    }
  }'
```

The development simulator exposes three robots. The dispatch response includes:

- The selected robot.
- Every rejected or eligible candidate.
- Human-readable selection reasons.
- The adapter command receipt.
- The mission's current lifecycle state.

## Inspect Fleet state

```bash
curl http://127.0.0.1:4273/api/v1/fleet/snapshot
```

## Verify the implementation

```bash
npm run typecheck
npm run test:core
npm run test:postgres # requires TEST_DATABASE_URL
npm run build
```
