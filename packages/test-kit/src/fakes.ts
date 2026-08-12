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

  next(prefix: "mission" | "command"): string {
    if (prefix === "mission") return `MISSION-${String(++this.mission).padStart(4, "0")}`;
    return `COMMAND-${String(++this.command).padStart(4, "0")}`;
  }
}

