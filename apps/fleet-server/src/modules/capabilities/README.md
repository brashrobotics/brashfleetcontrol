# Robot Capability Registry

## Purpose

Provides an approved, versioned description of what each vendor/model can safely be considered for during assignment.

## Lifecycle

Profiles are created as `DRAFT`, reviewed, and then `PUBLISHED`. Only one version per vendor/model may be published. An available robot can be assigned a published matching profile; assignment copies the immutable profile data into its durable registration. Profiles assigned to robots cannot be retired.

## Matching fields

The registry covers canonical actions, payload, allowed zones, physical dimensions, supported floor types, attachments, cancellation guarantees, and adapter protocol version. Work orders and missions may make attachments, floor type, maximum width, and cancellation support mandatory.

## Boundaries

The registry is an assignment contract, not a safety certification. Physical limits and protective functions remain the responsibility of the robot and its independent safety system.
