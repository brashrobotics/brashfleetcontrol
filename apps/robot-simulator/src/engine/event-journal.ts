import type { RobotAdapterEvent } from "@brash/contracts";
import type { AdapterEventBatch, SequencedAdapterEvent } from "@brash/http-robot-adapter";

export class EmulatorEventJournal {
  private readonly events: SequencedAdapterEvent[] = [];
  private nextSequence = 1;

  constructor(private readonly capacity = 10_000) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error("Event journal capacity must be a positive integer.");
  }

  append(event: RobotAdapterEvent): number {
    const sequence = this.nextSequence++;
    this.events.push({ sequence, event: structuredClone(event) });
    if (this.events.length > this.capacity) this.events.splice(0, this.events.length - this.capacity);
    return sequence;
  }

  read(after: number, limit: number): AdapterEventBatch {
    const oldestSequence = this.events[0]?.sequence ?? this.nextSequence;
    const latestSequence = this.nextSequence - 1;
    if (after > 0 && after < oldestSequence - 1) {
      throw new EmulatorEventCursorExpiredError(oldestSequence, latestSequence);
    }
    return {
      oldestSequence,
      latestSequence,
      events: this.events
        .filter((item) => item.sequence > after)
        .slice(0, limit)
        .map((item) => structuredClone(item)),
    };
  }
}

export class EmulatorEventCursorExpiredError extends Error {
  constructor(readonly oldestSequence: number, readonly latestSequence: number) {
    super(`Event cursor expired; retained range is ${oldestSequence}-${latestSequence}.`);
    this.name = "EmulatorEventCursorExpiredError";
  }
}
