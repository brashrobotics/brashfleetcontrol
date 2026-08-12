# Fleet Server Bootstrap

**Path:** apps/fleet-server/src/bootstrap/

## Purpose

Builds the application dependency graph and controls process startup and shutdown.

## Responsibilities

Load and validate configuration, create database and broker clients, register adapters, start workers, and handle signals.

## Boundaries

Must not contain mission, dispatch, or traffic business decisions.

## Completion expectations

Public interfaces must be documented, inputs validated, relevant tests added, and operational logs/metrics defined before this area is considered production-ready.
