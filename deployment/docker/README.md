# Docker Images

**Path:** deployment/docker/

## Purpose

Defines container images for Fleet Server, Operator Console, and Robot Simulator.

## Responsibilities

The current pilot image uses pinned Node.js 22 Alpine, installs the locked npm
dependency graph, runs as the non-root `node` user, and is shared by Fleet Core
and the robot emulator. Runtime health checks live in `compose.yaml`.

```bash
docker build -f deployment/docker/Dockerfile -t brash-fleet-control:pilot .
```

## Boundaries

Do not bake customer configuration, credentials, or mutable operational data
into images. The current image intentionally retains `tsx` and TypeScript
sources for the pilot stage; a later release image should compile artifacts in
a builder stage and omit development dependencies.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
