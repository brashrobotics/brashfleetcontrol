# Docker Images

**Path:** deployment/docker/

## Purpose

Defines container images for Fleet Server, Operator Console, and Robot Simulator.

## Responsibilities

Use pinned base images, non-root users, health checks, minimal runtime contents, and reproducible builds.

## Boundaries

Do not bake customer configuration, credentials, or mutable operational data into images.

## Completion expectations

Keep this README current as implementation is added, and define ownership, validation, tests, and operational behavior for production use.
