# Robot Simulator

**Path:** apps/robot-simulator/

## Purpose

Provides vendor-independent simulated robots for Fleet development and verification.

## Responsibilities

Run deterministic robot behavior, accept canonical missions, publish state, emulate energy use, and expose controllable faults.

## Run

```bash
npm run dev:emulator
```

The canonical robot API listens on `http://127.0.0.1:4280`. It runs in a
separate process from Fleet Core, animates robots along mission waypoints,
drains battery by travelled distance, publishes heartbeats and ordered mission
events, and preserves idempotent command receipts for the process lifetime.

Start Fleet Core against it in another terminal:

```bash
npm run dev:core:emulator
```

For the protocol-level emulator, start a local MQTT broker and use two
terminals:

```bash
# Terminal 1
npm run dev:emulator:vda

# Terminal 2
npm run dev:core:vda
```

The easiest complete VDA environment is the Docker profile documented below.
It creates Mosquitto, three independently connected VDA robots, PostgreSQL,
and Fleet Core. The robot clients publish retained connection/LWT messages and
VDA state heartbeats; Fleet publishes orders and `cancelOrder` actions.

Inspect and inject faults:

```bash
curl http://127.0.0.1:4280/control/v1/snapshot

curl -X POST http://127.0.0.1:4280/control/v1/robots/EMU-01/state \
  -H 'content-type: application/json' \
  -d '{"connection":"OFFLINE"}'

curl -X POST http://127.0.0.1:4280/control/v1/network \
  -H 'content-type: application/json' \
  -d '{"available":false}'
```

Restore network access through the same control endpoint with
`{"available":true}`. Set `ROBOT_EMULATOR_TOKEN` (or
`ROBOT_EMULATOR_TOKEN_FILE`) to require bearer authentication on all emulator
and control endpoints.

## Boundaries

It tests Fleet behavior and transport failure handling. Its in-memory command
ledger is intentionally a development tool and is not a physics,
safety-validation, or production robot-controller replacement.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
