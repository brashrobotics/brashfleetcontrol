# Local Database Initialization

## Purpose

Contains PostgreSQL entrypoint scripts used only when a fresh local Compose volume is initialized.

## Responsibilities

Create the isolated `brash_fleet_test` database alongside the development database so integration tests cannot be claimed by a running Fleet worker.

## Boundaries

Product schema changes belong in `database/migrations`. These scripts are local bootstrap conveniences and do not replace migrations or production database provisioning.
