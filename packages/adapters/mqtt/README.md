# MQTT Robot Adapter

**Path:** packages/adapters/mqtt/

## Purpose

Provides shared infrastructure for custom MQTT robot protocols that are not VDA 5050.

## Implemented transport

`MqttJsTransport` provides an MQTT 3.1.1 client boundary with automatic
reconnect/resubscription, QoS 0/1 publishing, retained-message support, last
will configuration, broker connection events, URL validation, and secret-safe
error text. Its small interface is also implemented by the deterministic
in-memory broker used by contract tests.

The caller owns protocol topic mapping, message validation, sequencing, and
business acknowledgements. The VDA 5050 adapter is the first production-facing
consumer of this transport.

## Boundaries

Broker delivery is not mission acceptance; explicit robot state is still
required. Development Compose permits anonymous plaintext MQTT only inside the
local stack. A customer deployment requires TLS, per-device credentials,
least-privilege topic ACLs, persistence, monitoring, and certificate rotation.

## Completion expectations

Document public interfaces, validate external inputs, add focused tests, and define logs/metrics before considering this area production-ready.
