import type { RobotCapabilities } from "@brash/contracts";

export const CANONICAL_ROBOT_ACTIONS = [
  "pallet_transport",
  "cart_transport",
  "tote_transport",
  "material_transport",
  "inspection",
  "inventory_scan",
  "docking",
  "charging",
] as const;

export type CanonicalRobotAction = typeof CANONICAL_ROBOT_ACTIONS[number];

export interface CapabilityMapping {
  vendorAction: string;
  canonicalAction: string;
}

export function normalizeCapabilityName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function mapVendorCapabilities(
  vendorActions: string[],
  mappings: CapabilityMapping[],
  constraints: { maxPayloadKg: number; allowedZones?: string[] },
): RobotCapabilities {
  const lookup = new Map(mappings.map((mapping) => [normalizeCapabilityName(mapping.vendorAction), normalizeCapabilityName(mapping.canonicalAction)]));
  const actions = [...new Set(vendorActions.map((action) => lookup.get(normalizeCapabilityName(action))).filter((action): action is string => Boolean(action)))].sort();
  if (actions.length === 0) throw new Error("No vendor actions map to a canonical Fleet capability.");
  if (!Number.isFinite(constraints.maxPayloadKg) || constraints.maxPayloadKg < 0) throw new Error("maxPayloadKg must be non-negative.");
  return {
    actions,
    maxPayloadKg: constraints.maxPayloadKg,
    allowedZones: [...new Set((constraints.allowedZones ?? []).map(normalizeCapabilityName).filter(Boolean))].sort(),
  };
}

export function isCanonicalRobotAction(value: string): value is CanonicalRobotAction {
  return (CANONICAL_ROBOT_ACTIONS as readonly string[]).includes(value);
}

