# Identity Module

**Path:** apps/fleet-server/src/modules/identity/

## Purpose

Manages users, service identities, roles, and scoped access.

## Responsibilities

Implement authentication integration, authorization policies, site-level access, service accounts, and token/certificate identity references.

## Boundaries

Never store plaintext passwords, private keys, or permanent credentials in source control.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
