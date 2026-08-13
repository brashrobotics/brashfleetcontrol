import type { Clock, IdGenerator } from "@brash/application";

export class ManualClock implements Clock {
  private current: Date;

  constructor(initial = "2026-08-12T10:00:00.000Z") {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): Date {
    this.current = new Date(this.current.getTime() + milliseconds);
    return this.now();
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private mission = 0;
  private command = 0;
  private route = 0;
  private workflow = 0;
  private workflowReservation = 0;
  private workOrder = 0;
  private capabilityProfile = 0;

  next(prefix: "mission" | "command" | "route" | "workflow" | "workflowReservation" | "workOrder" | "capabilityProfile" | "integrationEvent"): string {
    if (prefix === "mission") return `MISSION-${String(++this.mission).padStart(4, "0")}`;
    if (prefix === "command") return `COMMAND-${String(++this.command).padStart(4, "0")}`;
    if (prefix === "route") return `ROUTE-${String(++this.route).padStart(4, "0")}`;
    if (prefix === "workflow") return `WORKFLOW-${String(++this.workflow).padStart(4, "0")}`;
    if (prefix === "workOrder") return `WORK-ORDER-${String(++this.workOrder).padStart(4, "0")}`;
    if (prefix === "capabilityProfile") return `CAPABILITY-PROFILE-${String(++this.capabilityProfile).padStart(4, "0")}`;
    return `WORKFLOW-RESERVATION-${String(++this.workflowReservation).padStart(4, "0")}`;
  }
}
