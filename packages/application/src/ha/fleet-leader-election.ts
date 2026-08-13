import type { Clock } from "../ports/platform.js";
import type { LeaderLeaseRepository } from "../ports/repositories.js";

export interface FleetLeadershipStatus {
  resourceName: string;
  ownerId: string;
  role: "LEADER" | "FOLLOWER";
  fencingToken: number | null;
  leaseExpiresAt: string | null;
  observedAt: string;
}

export interface FleetLeaderElectionOptions {
  resourceName: string;
  ownerId: string;
  leaseDurationMs?: number;
}

export class FleetLeaderElection {
  private currentToken: number | null = null;
  private currentStatus: FleetLeadershipStatus;
  private readonly leaseDurationMs: number;

  constructor(
    private readonly leases: LeaderLeaseRepository,
    private readonly clock: Clock,
    private readonly options: FleetLeaderElectionOptions,
  ) {
    this.leaseDurationMs = options.leaseDurationMs ?? 15_000;
    if (!options.resourceName.trim() || !options.ownerId.trim()) throw new Error("Leader resource and owner identifiers are required.");
    if (!Number.isInteger(this.leaseDurationMs) || this.leaseDurationMs < 1_000) throw new Error("Leader lease duration must be at least 1000ms.");
    this.currentStatus = this.followerStatus(this.clock.now(), null);
  }

  get status(): FleetLeadershipStatus {
    return { ...this.currentStatus };
  }

  async tick(): Promise<FleetLeadershipStatus> {
    const now = this.clock.now();
    const lease = await this.leases.acquire(this.options.resourceName, this.options.ownerId, now, this.leaseDurationMs);
    if (lease) {
      this.currentToken = lease.fencingToken;
      this.currentStatus = {
        resourceName: lease.resourceName,
        ownerId: this.options.ownerId,
        role: "LEADER",
        fencingToken: lease.fencingToken,
        leaseExpiresAt: lease.expiresAt.toISOString(),
        observedAt: now.toISOString(),
      };
      return this.status;
    }
    const observed = await this.leases.get(this.options.resourceName);
    this.currentToken = null;
    this.currentStatus = this.followerStatus(now, observed?.expiresAt ?? null);
    return this.status;
  }

  async validateFence(): Promise<boolean> {
    if (this.currentToken === null) return false;
    return this.leases.validateFence(
      this.options.resourceName,
      this.options.ownerId,
      this.currentToken,
      this.clock.now(),
    );
  }

  async stop(): Promise<void> {
    if (this.currentToken !== null) {
      await this.leases.release(this.options.resourceName, this.options.ownerId, this.currentToken, this.clock.now());
    }
    this.currentToken = null;
    this.currentStatus = this.followerStatus(this.clock.now(), null);
  }

  private followerStatus(now: Date, leaseExpiresAt: Date | null): FleetLeadershipStatus {
    return {
      resourceName: this.options.resourceName,
      ownerId: this.options.ownerId,
      role: "FOLLOWER",
      fencingToken: null,
      leaseExpiresAt: leaseExpiresAt?.toISOString() ?? null,
      observedAt: now.toISOString(),
    };
  }
}
