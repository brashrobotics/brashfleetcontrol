# Work-Order Orchestrator

## Purpose

Accepts high-level factory work orders from ERP, WMS, MES, or operator systems and converts them into durable Fleet Core workflows.

## Responsibilities

- Validate transport intent and optional wait, charge, inspection, and dock actions.
- Evaluate every known robot against connection, availability, map revision, payload, capability, battery, and zone constraints.
- Rank eligible robots deterministically and retain human-readable candidate reasons.
- Persist pending work, retry allocation with bounded exponential backoff, and use expiring leases for multi-instance workers.
- Compile allocated work into dependency-ordered workflows and bind the selected robot as a dispatch preference.
- Correlate work-order, workflow, mission, command, traffic, and audit identifiers.
- Cascade cancellation to the compiled workflow and synchronize terminal state.

## Allocation behavior

The lowest score wins. The score combines pickup distance, remaining-battery penalty, and a small capability-surplus penalty. Eligibility failures never receive a score. Robot IDs break equal scores deterministically.

The selected robot is a soft preference in the compiled mission. Fleet dispatch chooses it while it remains eligible. If its state changes before dispatch, the normal Fleet Core policy may substitute another eligible robot instead of blocking the factory order.

## Boundaries

This module decides *which capable fleet resource should receive factory work*; it does not control motors, bypass adapter validation, or implement a safety function. ERP/WMS connectors should call the authenticated work-order API and keep their external reference stable for idempotency.

## Operational contract

- `POST /api/v1/work-orders` creates or returns an idempotent order.
- `GET /api/v1/work-orders` exposes allocation and execution state.
- `GET /api/v1/work-orders/{workOrderId}` exposes candidates and correlation IDs.
- `POST /api/v1/work-orders/{workOrderId}/cancel` requests controlled cancellation.
- `WorkOrderWorker` claims due `PENDING` records with a lease and retries allocation.

Production integrations must monitor `PENDING` age, repeated allocation attempts, `FAILED` orders, and workflow cancellation state.
