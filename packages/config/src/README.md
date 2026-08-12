# Typed Runtime Configuration

**Path:** `packages/config/src/`

## Purpose

Parses runtime environment variables into validated configuration objects.

## Current responsibility

`database-config.ts` selects the persistence mode and validates PostgreSQL pool,
timeout, and TLS options. It contains no credentials or environment-specific
defaults.
