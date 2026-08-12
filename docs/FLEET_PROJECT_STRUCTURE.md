# BRASH Fleet Control — Proposed Project and Directory Structure

This document describes the proposed directory structure for turning the BRASH Fleet Control demo into a product that centrally manages different brands and models of mobile robots, assigns missions, and coordinates factory traffic.

This system does not manage a robot's motors, sensors, or local navigation. Instead of sending low-level commands such as wheel velocities, Fleet Control sends semantic missions such as `pick up a load from Station A and deliver it to Station B`. Robot-vendor-specific API and protocol differences are handled by the adapter layer.

> The entire structure should not be created on day one. Directories should be added only when development begins on the corresponding capability. The initial target should be a modular monolith with one database and one deployable backend.

## 1. Core architecture boundaries

```text
Operator Console / MES / WMS
              │
              ▼
         Fleet API
              │
              ▼
  Mission + Dispatch + Traffic
              │
              ▼
       Robot Adapter Port
              │
      ┌───────┼────────┐
      ▼       ▼        ▼
 Simulator  VDA 5050  Customer-specific adapter
```

Core rules:

1. The Fleet Core never knows a robot vendor's message format.
2. The Fleet Core knows nothing about ROS topics, motor drivers, lidar, or `cmd_vel`.
3. Every robot integration implements the shared `RobotAdapter` contract.
4. Mission state changes only through explicitly defined state-machine transitions.
5. Every command, mission, operator action, and state transition must be traceable.
6. Maps, stations, and traffic graphs must be versioned.
7. A lost robot connection does not mean that the physical mission has failed or completed.
8. The UI never accesses the database or adapters directly; it communicates only with the Fleet API.

## 2. Target directory tree

```text
brashfleetcontrol/
├── apps/
│   ├── fleet-server/
│   │   └── src/
│   │       ├── bootstrap/
│   │       ├── api/
│   │       ├── modules/
│   │       │   ├── robots/
│   │       │   ├── missions/
│   │       │   ├── dispatch/
│   │       │   ├── traffic/
│   │       │   ├── maps/
│   │       │   ├── charging/
│   │       │   ├── alarms/
│   │       │   ├── identity/
│   │       │   ├── audit/
│   │       │   └── integrations/
│   │       └── workers/
│   ├── operator-console/
│   │   └── src/
│   │       ├── app/
│   │       ├── features/
│   │       ├── components/
│   │       ├── api/
│   │       └── assets/
│   └── robot-simulator/
│       └── src/
│           ├── engine/
│           ├── scenarios/
│           ├── faults/
│           └── fixtures/
├── packages/
│   ├── domain/
│   │   └── src/
│   │       ├── robot/
│   │       ├── mission/
│   │       ├── map/
│   │       ├── traffic/
│   │       └── shared/
│   ├── application/
│   │   └── src/
│   │       ├── commands/
│   │       ├── queries/
│   │       ├── ports/
│   │       └── policies/
│   ├── contracts/
│   │   ├── openapi/
│   │   ├── json-schema/
│   │   ├── events/
│   │   └── generated/
│   ├── robot-adapter-sdk/
│   │   └── src/
│   │       ├── adapter/
│   │       ├── capabilities/
│   │       ├── conformance/
│   │       └── testing/
│   ├── adapters/
│   │   ├── simulator/
│   │   ├── vda5050/
│   │   ├── rest/
│   │   ├── mqtt/
│   │   └── customer-template/
│   ├── persistence/
│   │   └── src/
│   │       ├── repositories/
│   │       ├── outbox/
│   │       └── transactions/
│   ├── observability/
│   ├── config/
│   └── test-kit/
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── fixtures/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   ├── load/
│   └── failure/
├── deployment/
│   ├── docker/
│   ├── compose/
│   ├── kubernetes/
│   └── monitoring/
├── config/
│   ├── development/
│   ├── test/
│   └── production/
├── scripts/
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── adapters/
│   ├── decisions/
│   ├── operations/
│   └── security/
├── package.json
├── tsconfig.json
└── README.md
```

## 3. `apps/` — Executable applications

`apps/` contains applications that are started or deployed directly. These applications should not own business rules; they should assemble and run capabilities provided by `packages/`.

### `apps/fleet-server/`

This is the Fleet system's primary backend application. It starts the HTTP API, real-time state streaming, database connections, and background jobs.

Responsibilities:

- Manage application startup and graceful shutdown.
- Wire modules, repository implementations, and robot adapters together.
- Expose the REST API and SSE/WebSocket endpoints.
- Run authentication and authorization middleware.
- Expose health, readiness, and liveness endpoints.
- Run scheduled or queue-based background jobs.

What must not be implemented here:

- Writing robot-selection algorithms inside route handlers.
- Executing SQL queries inside controllers.
- Processing VDA 5050 or customer-specific robot messages directly.
- Generating fake state for the UI.

#### `src/bootstrap/`

Application construction and dependency wiring are performed here.

- Loads and validates configuration.
- Creates the database connection.
- Registers active robot adapters.
- Starts the API server and workers.
- Gracefully closes connections on SIGTERM/SIGINT.

#### `src/api/`

This is the transport layer exposed to external clients.

- Robot, mission, map, alarm, and user routes.
- Request validation and response mapping.
- OpenAPI-compatible error responses.
- SSE or WebSocket connection management.
- Authentication, authorization, rate limiting, and correlation ID middleware.

The API layer calls use cases; it does not contain business rules.

#### `src/modules/robots/`

This module manages robots registered with the Fleet system.

- Robot registration, updates, and deactivation.
- Robot identity, vendor, model, and adapter mapping.
- Capability, payload, footprint, and operating-zone definitions.
- Telemetry normalization and `lastSeenAt` tracking.
- Management of states such as `ONLINE`, `OFFLINE`, `AVAILABLE`, `EXECUTING`, and `ERROR`.
- Consistency checks between a robot and its active mission.

Motor, navigation, and physical safety logic does not belong in this module.

#### `src/modules/missions/`

Manages a mission's lifecycle from creation to completion.

- Mission types such as `TRANSPORT`, `MOVE`, `CHARGE`, and `DOCK`.
- Mission plans composed of pickup, drop-off, and intermediate steps.
- Priority, deadline, customer reference, and idempotency key.
- Mission state machine and valid state transitions.
- Pause, resume, cancel, and retry requests.
- Mission event history and failure reasons.

Recommended core states:

```text
CREATED → QUEUED → ASSIGNED → DISPATCHED → EXECUTING → COMPLETED
                    │              │             │
                    └──────────────┴─────────────┴→ FAILED / CANCELLED
```

#### `src/modules/dispatch/`

Selects the most suitable robot for a mission and performs the assignment atomically.

- Applies mandatory eligibility filters first.
- Scores eligible robots by estimated cost.
- Evaluates capability, payload, location, battery, zone permissions, and robot state.
- Creates mission and robot reservations in a single transaction.
- Prevents the same robot from being assigned to two missions concurrently.
- Records the reasoning behind an assignment decision.
- Applies reassignment or retry policy if a robot rejects the mission.

Scoring strategies should be placed behind a replaceable interface. A weighted cost calculation is sufficient for the first release.

#### `src/modules/traffic/`

Coordinates shared factory resources so robots can use them without conflicts.

- Node/edge-based traffic graph.
- Reservations for narrow aisles, intersections, doors, elevators, and loading areas.
- Time-bounded leases and reservation renewal.
- Conflict, deadlock, and livelock detection.
- Priority and waiting policies.
- Safe handling of resources held by offline or failed robots.

Local obstacle avoidance is not this module's responsibility. Fleet traffic management concerns planned global movement and shared-resource allocation.

#### `src/modules/maps/`

Manages the factory model used by the Fleet system.

- Sites, buildings, floors, and map versions.
- Stations, zones, traffic nodes, and edges.
- Speed zones, restricted zones, and one-way routes.
- Locations of resources such as chargers, doors, elevators, and conveyors.
- Map publishing, archiving, and active-version management.
- Transformation metadata between Fleet coordinates and robot/vendor coordinates.

A mission must explicitly carry the map version on which it was created or executed.

#### `src/modules/charging/`

Manages mission and charging plans according to robot energy state.

- Minimum mission and safety battery thresholds.
- Charger capabilities and compatibility.
- Charging queues and station reservations.
- Opportunity-charging policies.
- Estimated energy cost before and after a mission.
- Alternative plans when a charger is unavailable or occupied.

The first MVP may use simple thresholds; an energy-estimation model can be added later.

#### `src/modules/alarms/`

Manages events that operators need to see or act upon.

- Robot, mission, traffic, and infrastructure alarms.
- Severity, category, source, and deduplication key.
- Opening, acknowledging, and closing alarms.
- Prevention of repeated alarms for the same recurring fault.
- Links to the relevant robot, mission, command, and map version.
- Events forwarded to notification systems.

#### `src/modules/identity/`

Manages human users and service identities.

- User and service-account definitions.
- Roles such as `operator`, `supervisor`, `integrator`, and `admin`.
- Site- or factory-scoped access control.
- API tokens and robot connection identities.
- Authorization policies.

Passwords and permanent access keys must not be stored in source code.

#### `src/modules/audit/`

Answers who performed which action and when.

- Operator mission creation and cancellation actions.
- Manual robot assignments.
- Map and configuration changes.
- User and permission changes.
- Previous and new values, actor, timestamp, and correlation ID.

Audit records are separate from ordinary application logs and must not be silently mutable afterward.

#### `src/modules/integrations/`

Manages factory-system integrations other than robots.

- Receiving missions from MES, WMS, and ERP systems.
- Door, elevator, conveyor, and PLC services.
- Incoming and outgoing webhooks.
- Mapping external-system identities to internal mission identities.
- Idempotent handling of repeated messages.

Robot integrations belong under `packages/adapters/`, not in this directory.

#### `src/workers/`

Runs periodic jobs or work that outlives an HTTP request.

- Offline robot detection.
- Expired command and lease checks.
- Dispatching queued missions.
- Publishing outbox events.
- Telemetry aggregation and retention cleanup.
- Retry and timeout policies.

When multiple worker instances are running, each worker must use a lock or lease to prevent the same job from running twice.

### `apps/operator-console/`

This is the web application operators use to monitor and control the Fleet system. The existing `public/` content can be migrated here over time.

#### `src/app/`

- Router and primary page layout.
- Global providers and session management.
- Theme, error boundary, and application startup.

#### `src/features/`

Screen- and capability-oriented UI code:

- `fleet-map/`
- `robots/`
- `missions/`
- `traffic/`
- `alarms/`
- `settings/`

Each feature may contain its own views, state, and API hooks.

#### `src/components/`

- Reusable components such as buttons, dialogs, tables, badges, and forms.
- Must not contain business rules specific to a mission or robot vendor.

#### `src/api/`

- Fleet REST client.
- SSE/WebSocket connection.
- API model mapping and shared error handling.
- Authentication token management.

#### `src/assets/`

- Icons, fonts, and application visuals.
- Factory maps must not be embedded here as permanent product data; they are retrieved through the Maps API.

### `apps/robot-simulator/`

This is the vendor-independent simulator used to test Fleet behavior without physical robots. The robot-motion simulation currently inside `server.mjs` can be extracted here.

#### `src/engine/`

- Robot movement and time progression.
- Mission acceptance, execution, and completion behavior.
- Battery consumption and charging simulation.
- Deterministic clock and seed support.

#### `src/scenarios/`

- Normal shift operation.
- Heavy mission queues.
- Narrow-aisle and intersection conflicts.
- Low battery and charging queues.
- Multiple robot types and capability combinations.

#### `src/faults/`

- Connection loss.
- Mission rejection.
- Delayed or out-of-order telemetry.
- Robot entering an error state.
- Stuck missions and command timeouts.

#### `src/fixtures/`

- Reusable robot, map, and mission examples.
- Fixed datasets for deterministic tests.

## 4. `packages/` — Reusable product core

This directory contains libraries used by the applications but not deployed independently.

### `packages/domain/`

This is the pure business model at the center of the product. It contains no framework, HTTP, MQTT, SQL, or vendor dependencies.

#### `src/robot/`

- `Robot`, `RobotId`, `RobotState`, and `RobotCapability`.
- Valid robot state transitions.
- Payload, footprint, battery, and availability rules.

#### `src/mission/`

- `Mission`, `MissionId`, `MissionStep`, and `MissionPriority`.
- Mission state machine.
- Valid pause, cancel, retry, and complete conditions.

#### `src/map/`

- `Site`, `Floor`, `MapVersion`, `Station`, and `Zone`.
- Coordinate, waypoint, and version value objects.

#### `src/traffic/`

- `TrafficResource`, `Reservation`, `Lease`, and `Route`.
- Conflict and reservation rules.

#### `src/shared/`

- Shared primitives such as entities, domain events, result/error types, and time.
- Must not become a generic `utils` dumping ground.

### `packages/application/`

Defines product use cases with domain objects. It uses port interfaces instead of directly calling external systems.

#### `src/commands/`

Use cases that modify the system:

- `CreateMission`
- `AssignMission`
- `CancelMission`
- `RegisterRobot`
- `ReserveTrafficResource`
- `AcknowledgeAlarm`

#### `src/queries/`

Read-only use cases:

- `GetFleetSnapshot`
- `ListAvailableRobots`
- `GetMissionTimeline`
- `GetTrafficOccupancy`

#### `src/ports/`

Interfaces that the application layer expects from the outside world:

- `RobotAdapterPort`
- `MissionRepository`
- `RobotRepository`
- `EventPublisher`
- `Clock`
- `IdGenerator`
- `TransactionManager`

#### `src/policies/`

- Robot eligibility filters.
- Assignment-scoring strategy.
- Retry and timeout policies.
- Battery and charging policies.
- Traffic-priority policy.

### `packages/contracts/`

The single source of truth for versioned data contracts crossing system boundaries.

#### `openapi/`

- Fleet REST API definitions.
- Endpoint, request, response, and error schemas.

#### `json-schema/`

- Robot state, capability, mission command, and adapter message schemas.
- Used for runtime validation and adapter conformance tests.

#### `events/`

- Event contracts such as `RobotStateUpdatedV1`, `MissionAssignedV1`, and `MissionCompletedV1`.
- Rules for event naming and schema-version changes.

#### `generated/`

- TypeScript models generated from OpenAPI or JSON Schema.
- Never edited manually; regenerated during the build.

### `packages/robot-adapter-sdk/`

Standardizes how a new customer robot connects to Fleet Control.

#### `src/adapter/`

Defines the shared interface:

```ts
interface RobotAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCapabilities(robotId: string): Promise<RobotCapabilities>;
  executeMission(command: MissionCommand): Promise<CommandReceipt>;
  pauseMission(commandId: string): Promise<void>;
  resumeMission(commandId: string): Promise<void>;
  cancelMission(commandId: string): Promise<void>;
  subscribeState(handler: RobotStateHandler): Unsubscribe;
}
```

The actual interface may evolve during development, but transport or vendor-specific types must not leak into this contract.

#### `src/capabilities/`

- Standard capability names.
- Capability parameter and constraint schemas.
- Helpers for mapping vendor capabilities to the canonical capability model.

#### `src/conformance/`

- Rules that verify whether an adapter complies with the common contract.
- Command acknowledgment, idempotency, and state-ordering checks.

#### `src/testing/`

- Fake clock, fake transport, and sample robot states.
- A shared test suite that every adapter must pass.

### `packages/adapters/`

This is where robot-vendor or protocol data is translated into the Fleet model. Every adapter implements the `robot-adapter-sdk` contract.

#### `simulator/`

- The first and reference adapter.
- Forwards Fleet commands to the simulator.
- Converts simulator telemetry into the canonical `RobotState` model.
- Demonstrates expected behavior for other adapters.

#### `vda5050/`

- Converts canonical missions into VDA 5050 order/action messages.
- Normalizes VDA 5050 state, error, connection, and factsheet messages.
- Manages MQTT topics, headers, and sequences.
- Explicitly declares the supported VDA 5050 version.
- Prevents VDA 5050 messages from leaking into the Fleet Core.

#### `rest/`

- General base adapter for robot systems exposing REST APIs.
- Authentication, polling/webhooks, retry, and rate-limit behavior.
- If vendor-specific conditionals begin to accumulate, create a separate adapter.

#### `mqtt/`

- General transport adapter for custom MQTT robots that do not use VDA 5050.
- Topic mapping, QoS, retained-message, and session management.

#### `customer-template/`

- A reusable starting template for new customer integrations.
- Example configuration, mappings, adapter class, and conformance tests.
- Contains no real customer secrets, passwords, or certificates.

### `packages/persistence/`

Contains PostgreSQL implementations of application ports.

#### `src/repositories/`

- Robot, mission, map, reservation, alarm, and audit repositories.
- Mapping between domain objects and database rows.
- SQL or ORM details remain inside this layer.

#### `src/outbox/`

- Reliably couples database changes with event publishing.
- Retries unpublished events.
- Uses event IDs that allow consumers to prevent duplicate effects.

#### `src/transactions/`

- Atomic mission/robot assignment.
- Transaction boundaries and locking policies.
- Prevention of race conditions during concurrent dispatch operations.

### `packages/observability/`

- Structured-logging standard.
- Fields such as `robotId`, `missionId`, `commandId`, and `correlationId`.
- Metrics and tracing helpers.
- Rules for removing sensitive data from logs.
- Service health and performance measurements.

### `packages/config/`

- Environment-variable schemas.
- Startup-time type and required-field validation.
- Shared tools for loading site and adapter configuration.
- Single source of truth for default values.

Secret values themselves are not stored here.

### `packages/test-kit/`

- Builders for test robots, missions, and maps.
- Fake adapter, fake clock, and in-memory repositories.
- Reusable assertions and polling helpers.
- Shared fixture conventions across tests.

## 5. `database/` — Database lifecycle

### `database/migrations/`

- Ordered and traceable schema changes.
- Table, index, constraint, and required extension definitions.
- Manual production schema changes are not accepted.

Initial tables may include:

```text
robots
robot_capabilities
robot_states
missions
mission_steps
mission_events
commands
maps
stations
traffic_nodes
traffic_edges
traffic_reservations
alarms
audit_events
outbox_events
```

### `database/seeds/`

- Sample sites, maps, stations, and users for development.
- Contains no production secrets or real customer data.

### `database/fixtures/`

- Fixed datasets for integration and end-to-end tests.
- Must be reproducible at the start of every test run.

## 6. `tests/` — System-level verification

Package unit tests may live next to their packages. The `tests/` directory is reserved for tests that verify multiple packages or applications together.

### `tests/contract/`

- RobotAdapter conformance tests.
- OpenAPI request/response compliance.
- Event and JSON Schema backward compatibility.
- VDA 5050 mapping tests.

### `tests/integration/`

- PostgreSQL repository tests.
- MQTT broker, outbox, and API integration.
- Transaction and concurrent-assignment tests.

### `tests/e2e/`

- Create mission → select robot → dispatch → accept → complete flow.
- UI API flows.
- Pause, resume, cancel, and failure scenarios.

### `tests/load/`

- High-volume robot telemetry.
- Concurrent mission creation and dispatch.
- SSE/WebSocket connection capacity.
- Database and assignment-engine latency.

### `tests/failure/`

- Robot disconnection and reconnection.
- Adapter, database, or worker restarts.
- Duplicate and out-of-order messages.
- Expired commands and reservations.
- Scenarios that prevent the same physical mission from being assigned to two robots accidentally.

## 7. `deployment/` — Running and releasing the system

### `deployment/docker/`

- Dockerfiles for the Fleet server, UI, and simulator.
- Small, reproducible, non-root images.

### `deployment/compose/`

- Local development and single-server pilot deployments.
- Fleet server, PostgreSQL, MQTT broker, and monitoring components.

### `deployment/kubernetes/`

- Manifests or Helm charts when production requirements justify them.
- Should remain empty or not exist during the initial MVP.

### `deployment/monitoring/`

- Dashboards, metric-scrape configuration, and alert rules.
- Alerts for offline robots, stuck missions, dispatch failures, and high API latency.

## 8. `config/` — Environment- and site-specific settings

### `config/development/`

- Local simulator and sample factory settings.
- Safe development defaults.

### `config/test/`

- Deterministic clock, short timeouts, and test-database settings.

### `config/production/`

- Non-secret production defaults.
- Log levels, connection limits, and feature flags.

Sensitive customer-specific values must come from a secret manager or the deployment environment. Robot certificates and passwords must never be committed to the repository.

## 9. `scripts/` — Developer and operations tools

- Validate the local development environment.
- Generate API or schema code.
- Run migrations.
- Load demo data.
- Run adapter conformance tests.
- Validate and transform map data.

Scripts must not become alternative implementations of business rules from the main application.

## 10. `docs/` — Permanent product knowledge

### `docs/architecture/`

- System context and container diagrams.
- Module boundaries and dependency rules.
- Mission, command, and robot state-machine diagrams.

### `docs/api/`

- Fleet API usage examples.
- MES/WMS webhook and integration guides.
- Event catalogs.

### `docs/adapters/`

- Guide for developing a new robot adapter.
- Canonical-model mapping rules.
- VDA 5050, REST, and MQTT adapter notes.
- How to use the conformance tests.

### `docs/decisions/`

Contains Architecture Decision Records. Examples:

- Why was a modular monolith selected?
- Why was VDA 5050 not used as the internal domain model?
- Why were PostgreSQL and a transactional outbox selected?
- Why is the traffic-reservation model lease-based?

### `docs/operations/`

- Installation, upgrade, and rollback procedures.
- Backup/restore and incident runbooks.
- Response procedures for offline robots, stuck missions, and broker outages.

### `docs/security/`

- Threat model.
- Role and permission matrix.
- Secret and certificate management.
- Audit-retention and security-incident response plans.

## 11. Dependency direction between directories

Dependencies must flow inward:

```text
apps
  ↓
application
  ↓
domain
```

Adapter and persistence layers implement ports defined by the application:

```text
application/ports/RobotAdapterPort
                 ▲
                 │ implements
packages/adapters/vda5050
```

Allowed dependencies:

- `domain` does not depend on another product package.
- `application` may depend on `domain` and port interfaces.
- `adapters` may use application ports, `domain`, and `contracts`.
- `persistence` may use repository ports and domain models.
- `fleet-server` may wire all implementations together during bootstrap.
- `operator-console` uses only published API contracts.

Forbidden dependencies:

- `domain → adapters`
- `domain → persistence`
- `dispatch → vda5050`
- `operator-console → database`
- `robot adapter → operator-console`

## 12. Migration from the current demo

The current files can be extracted gradually, without deleting everything at once:

| Current area | Target location |
|---|---|
| `public/index.html` | `apps/operator-console/` |
| `public/app.js` | `apps/operator-console/src/` |
| `public/styles.css` | `apps/operator-console/src/` |
| HTTP routes in `server.mjs` | `apps/fleet-server/src/api/` |
| Robot simulation in `server.mjs` | `apps/robot-simulator/src/engine/` |
| Mission handling in `server.mjs` | Mission application/domain modules |
| Robot selection in `server.mjs` | `dispatch` module |
| In-memory robots and missions | `packages/persistence/` + PostgreSQL |
| Existing SSE stream | Fleet API real-time streaming layer |
| `tests/fleet-server.test.mjs` | Split into contract, integration, and end-to-end tests |

## 13. Recommended implementation order

### Phase 1 — Working product core

Create these areas first:

```text
apps/fleet-server
apps/operator-console
apps/robot-simulator
packages/domain
packages/application
packages/contracts
packages/robot-adapter-sdk
packages/adapters/simulator
packages/persistence
database/migrations
tests/integration
tests/e2e
```

Delivery target:

- Missions persisted in PostgreSQL.
- Simulated robots connected through SimulatorAdapter.
- A valid mission state machine.
- A dispatch engine that filters by capability and scores robots.
- Atomic robot reservation.
- Real-time mission and robot monitoring in the existing UI.

### Phase 2 — Reliability and traffic

- Command acknowledgment and idempotency.
- Transactional outbox.
- Offline robot detection.
- Versioned semantic map.
- Traffic graph and resource reservations.
- Failure and load tests.

### Phase 3 — First physical robot integration

- Analyze the customer robot's API.
- Map it to canonical capabilities and state.
- Implement the required adapter.
- Run the shared conformance tests.
- Verify the simulator and physical robot against the same Fleet Core.

### Phase 4 — Factory and production capabilities

- MES/WMS integrations.
- User roles and audit screens.
- Door, elevator, and conveyor integrations.
- Monitoring, backup/restore, and operations runbooks.
- High availability and horizontal scaling when justified.

## 14. Definition of done for a module

When a new directory or module is added, the following items must be complete:

- It has a clear responsibility and boundary definition.
- Public interfaces are documented.
- Input data is validated at runtime.
- Domain errors are defined and mapped to API errors.
- Unit or integration tests exist.
- Logs include the correlation ID and relevant entity IDs.
- Timeout, retry, and duplicate behavior is defined.
- Authorization requirements are identified.
- Migration or configuration changes are documented.
- Its operational observability is defined.

This structure keeps the Fleet Core independent of customer robots. When a new robot is introduced, the core mission, dispatch, and traffic code remains unchanged; only a new integration implementing the shared `RobotAdapter` contract is added.
