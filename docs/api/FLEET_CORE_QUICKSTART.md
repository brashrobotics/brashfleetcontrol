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
- Mission audit events for assignment, command delivery, and execution state.
- Versioned factory map topologies.
- Route plans and edge/node reservation time windows.
- Robot heartbeat timestamps, recovery state, and renewable route leases.
- Priority-aged dispatch queue attempts, retry times, errors, and worker leases.
- Operational alarms, occurrence counters, acknowledgement records, and resolution history.

Robot and mission reservation is committed in one database transaction.
Dispatch candidates are locked with `FOR UPDATE SKIP LOCKED`, so concurrent
Fleet Core instances cannot reserve the same robot. A command is added to the
outbox in that same transaction. Pending commands are retried with the same
`commandId` when Fleet Core restarts, so adapters must implement idempotent
command handling. While Fleet Core is running, the outbox worker retries due
commands automatically using expiring leases and exponential backoff.

Dispatch also reserves the selected robot's complete graph route in the same
transaction. If an edge or intersection is occupied, Fleet Core moves the
complete route to the first conflict-free time slot and publishes
`scheduledStartAt` to the adapter. PostgreSQL rejects overlapping active
reservations even when multiple Fleet Core processes dispatch concurrently.

Fleet Core evaluates server-received robot heartbeats continuously. A heartbeat
first becomes `DEGRADED`, then `OFFLINE`. If an offline robot owns a mission,
the mission becomes `RECOVERY_REQUIRED`, command retry is suspended, and its
route resources become a visible `SAFETY_HOLD`. The hold is not released merely
because a timer expired: the robot must reconnect and report whether the old
command is still active. Only a confirmed clear state permits reassignment.

Queued missions are evaluated continuously by the mission-dispatch worker.
Selection uses the mission priority plus one aging point per configured interval,
up to priority 100, so low-priority work cannot starve indefinitely. Failed
assignment attempts use bounded exponential backoff. PostgreSQL workers claim
due missions with expiring leases and `SKIP LOCKED`, allowing multiple Fleet
Core instances to run without dispatching one queued mission twice.

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
- The reserved route, schedule, and any conflict-induced wait.
- The mission's current lifecycle state.

## Inspect Fleet state

```bash
curl http://127.0.0.1:4273/api/v1/fleet/snapshot
```

Inspect the factory traffic graph and current reservation schedule:

```bash
curl http://127.0.0.1:4273/api/v1/maps/plant-a%401/topology
curl 'http://127.0.0.1:4273/api/v1/traffic/schedule?mapId=plant-a%401'
curl http://127.0.0.1:4273/api/v1/missions/MISSION_ID/route
curl http://127.0.0.1:4273/api/v1/recovery/status
curl http://127.0.0.1:4273/api/v1/dispatch/queue
curl http://127.0.0.1:4273/api/v1/alarms
```

The operator dashboard renders the same topology and colors active/upcoming
reserved lanes. Its traffic card shows route timing and wait duration.
Safety holds are red; robot details show heartbeat age and connection state.
The mission table shows each queued mission's effective priority and next
automatic dispatch attempt.

Operators can close an edge or node from the dashboard traffic card. New routes
are calculated around active closures, and a critical alarm is raised if a
closure intersects a route that is already active. The API equivalent is:

```bash
curl -X POST http://127.0.0.1:4273/api/v1/traffic/restrictions \
  -H 'content-type: application/json' \
  -d '{"mapId":"plant-a@1","resourceId":"edge:E-NORTH-02","reason":"Aisle maintenance","operatorId":"operator-1"}'

curl 'http://127.0.0.1:4273/api/v1/traffic/restrictions?mapId=plant-a%401'

curl -X POST http://127.0.0.1:4273/api/v1/traffic/restrictions/RESTRICTION_ID/clear \
  -H 'content-type: application/json' \
  -d '{"operatorId":"operator-1"}'
```

Closing a resource does not silently revoke an already-issued robot route.
That situation requires operator coordination because the robot may already be
inside the affected area.

Robot heartbeat loss, recovery-required missions, command-delivery failures,
and rejected cancellation requests create deduplicated alarms. Repeated
observations increment one alarm instead of flooding the operator. Acknowledge
an active alarm with:

```bash
curl -X POST http://127.0.0.1:4273/api/v1/alarms/ALARM_ID/acknowledge \
  -H 'content-type: application/json' \
  -d '{"operatorId":"operator-1","note":"Area inspection started"}'
```

Acknowledgement records operator ownership but does not hide the condition.
Fleet Core resolves the alarm only when the underlying robot or mission state
is safe again.

Select any mission row in the dashboard to open its durable event timeline, or
query it directly:

```bash
curl http://127.0.0.1:4273/api/v1/missions/MISSION_ID/events
```

The same timeline includes an operator cancellation control for queued,
dispatched, and executing missions. The equivalent API request is:

```bash
curl -X POST http://127.0.0.1:4273/api/v1/missions/MISSION_ID/cancel
```

A queued mission is cancelled locally. For a dispatched or executing mission,
Fleet Core first records `CANCELLING`, asks the robot adapter to cancel the
accepted command, and keeps its traffic reservations until the robot confirms
`CANCELLED`. Adapter delivery failures and rejections remain visible in the
mission timeline, and the same request can be retried safely.

## Verify the implementation

```bash
npm run typecheck
npm run test:core
npm run test:postgres # requires TEST_DATABASE_URL
npm run build
```
