import type { CreateMissionRequest, MissionLocation } from "./fleet-contracts.js";

export class ContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super("The request does not satisfy the Fleet contract.");
    this.name = "ContractValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

function finiteNumber(value: unknown, path: string, issues: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number.`);
    return 0;
  }
  return value;
}

function parseLocation(value: unknown, path: string, issues: string[]): MissionLocation {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`);
    return { stationId: "", mapId: "", x: 0, y: 0 };
  }

  const zoneId = value.zoneId === undefined
    ? undefined
    : nonEmptyString(value.zoneId, `${path}.zoneId`, issues);

  return {
    stationId: nonEmptyString(value.stationId, `${path}.stationId`, issues),
    mapId: nonEmptyString(value.mapId, `${path}.mapId`, issues),
    x: finiteNumber(value.x, `${path}.x`, issues),
    y: finiteNumber(value.y, `${path}.y`, issues),
    ...(zoneId ? { zoneId } : {}),
  };
}

export function parseCreateMissionRequest(value: unknown): CreateMissionRequest {
  const issues: string[] = [];
  if (!isRecord(value)) throw new ContractValidationError(["body must be an object."]);

  if (value.type !== "TRANSPORT") issues.push("type must be TRANSPORT.");

  const priority = finiteNumber(value.priority, "priority", issues);
  if (priority < 0 || priority > 100) issues.push("priority must be between 0 and 100.");

  const payloadKg = finiteNumber(value.payloadKg, "payloadKg", issues);
  if (payloadKg < 0) issues.push("payloadKg must be greater than or equal to 0.");

  const rawCapabilities = value.requiredCapabilities;
  let requiredCapabilities: string[] = [];
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0) {
    issues.push("requiredCapabilities must contain at least one capability.");
  } else {
    requiredCapabilities = [...new Set(rawCapabilities.map((item, index) =>
      nonEmptyString(item, `requiredCapabilities[${index}]`, issues),
    ).filter(Boolean))];
  }

  const pickup = parseLocation(value.pickup, "pickup", issues);
  const dropoff = parseLocation(value.dropoff, "dropoff", issues);
  if (pickup.mapId && dropoff.mapId && pickup.mapId !== dropoff.mapId) {
    issues.push("pickup.mapId and dropoff.mapId must match in the first Fleet contract version.");
  }

  const externalReference = value.externalReference === undefined
    ? undefined
    : nonEmptyString(value.externalReference, "externalReference", issues);

  if (value.autoDispatch !== undefined && typeof value.autoDispatch !== "boolean") {
    issues.push("autoDispatch must be a boolean when provided.");
  }

  if (issues.length > 0) throw new ContractValidationError(issues);

  return {
    type: "TRANSPORT",
    priority,
    payloadKg,
    requiredCapabilities,
    pickup,
    dropoff,
    ...(externalReference ? { externalReference } : {}),
    ...(typeof value.autoDispatch === "boolean" ? { autoDispatch: value.autoDispatch } : {}),
  };
}

