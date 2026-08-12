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

```bash
npm run dev:core
```

The API starts at `http://127.0.0.1:4273`.

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
npm run build
```

The first vertical slice currently uses in-memory repositories. Restarting Fleet Core resets its state. PostgreSQL persistence is the next infrastructure milestone.
