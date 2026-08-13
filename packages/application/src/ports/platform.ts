import { randomUUID } from "node:crypto";

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: "mission" | "command" | "route" | "workflow" | "workflowReservation" | "workOrder" | "capabilityProfile" | "integrationEvent"): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class RandomIdGenerator implements IdGenerator {
  next(prefix: "mission" | "command" | "route" | "workflow" | "workflowReservation" | "workOrder" | "capabilityProfile" | "integrationEvent"): string {
    return `${prefix}-${randomUUID()}`;
  }
}
