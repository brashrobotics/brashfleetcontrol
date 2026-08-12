# Application Ports

**Path:** packages/application/src/ports/

## Purpose

Defines abstract interfaces through which use cases access external capabilities.

## Responsibilities

Declare RobotAdapterPort, repositories, EventPublisher, Clock, IdGenerator, TransactionManager, TrafficEngine, and other external boundaries.

## Boundaries

Ports use canonical types and must not expose SQL rows, framework request objects, or vendor messages.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
