# Docker Compose Deployments

**Path:** deployment/compose/

## Purpose

Provides local development and single-server pilot stacks.

## Responsibilities

The `pilot` profile in the repository root `compose.yaml` composes Fleet Server,
Operator Console static assets, PostgreSQL, and the external robot emulator.

```bash
docker compose --profile pilot up --build
```

Open Fleet Management at `http://127.0.0.1:4273` and the emulator snapshot at
`http://127.0.0.1:4280/control/v1/snapshot`.

If those host ports are already occupied, leave the container ports unchanged
and override only the published ports:

```bash
FLEET_PUBLISHED_PORT=4274 ROBOT_EMULATOR_PUBLISHED_PORT=4281 \
  docker compose --profile pilot up --build
```

Stop the stack without deleting PostgreSQL data:

```bash
docker compose --profile pilot down
```

Run the complete VDA 5050 3.0.0 path on separate default ports:

```bash
docker compose --profile vda up --build -d
docker compose --profile vda ps
```

Open Fleet Management at `http://127.0.0.1:4275`. The broker is published on
`127.0.0.1:1883` by default. Follow component logs with:

```bash
docker compose --profile vda logs -f fleet-core-vda vda-robot-emulator mosquitto
```

Stop it without deleting PostgreSQL data:

```bash
docker compose --profile vda down
```

Use `VDA_FLEET_PUBLISHED_PORT` and `MQTT_PUBLISHED_PORT` when those host ports
are occupied. The VDA profile uses isolated PostgreSQL schema
`brash_vda_pilot_plant_a`.

The checked-in Mosquitto configuration is deliberately development-only: it
allows anonymous plaintext access and has no persistent broker storage. Never
expose it to a factory network. Production requires TLS/mTLS, per-device
identity, topic ACLs, persistent sessions where designed, credential rotation,
broker monitoring, and restore tests.

The basic `docker compose up -d postgres` workflow remains available for local
database-only development.

The pilot profile uses the isolated `brash_pilot_plant_a` PostgreSQL schema so
robots and missions from the in-process development adapter cannot leak into
the external-emulator inventory.

## Boundaries

Compose is for local development and a single-server isolated pilot. It is not
the production HA solution. Credentials in the root Compose file are
development defaults and must not be used at a customer site.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
