import { createHash, timingSafeEqual } from "node:crypto";
import type { FleetPermission, FleetRole, IdentityView } from "@brash/contracts";
import { resolveSecret } from "@brash/config";
import { OidcIdentityProvider } from "./oidc-identity-provider.js";

export interface FleetPrincipal extends IdentityView {}

export interface TokenIdentity {
  token: string;
  subjectId: string;
  displayName: string;
  subjectType: "USER" | "SERVICE";
  role: FleetRole;
  siteIds: string[];
}

export interface IdentityProvider {
  authenticate(authorizationHeader: string | null): Promise<FleetPrincipal | null>;
}

const ROLE_PERMISSIONS: Record<FleetRole, readonly FleetPermission[]> = {
  VIEWER: ["fleet:read"],
  OPERATOR: ["fleet:read", "mission:create", "mission:cancel", "workflow:create", "workflow:cancel", "orchestrator:submit", "orchestrator:cancel", "alarm:acknowledge", "traffic:manage", "resource:manage", "recovery:manage"],
  DISPATCHER: ["fleet:read", "mission:create", "mission:dispatch", "mission:cancel", "workflow:create", "workflow:cancel", "orchestrator:submit", "orchestrator:cancel"],
  FLEET_ADMIN: ["fleet:read", "mission:create", "mission:dispatch", "mission:cancel", "workflow:create", "workflow:cancel", "template:manage", "orchestrator:submit", "orchestrator:cancel", "alarm:acknowledge", "traffic:manage", "map:manage", "resource:manage", "capability:manage", "recovery:manage", "integration:read", "integration:manage", "observability:read", "audit:read"],
  INTEGRATION: ["fleet:read", "mission:create", "workflow:create", "orchestrator:submit", "integration:read", "observability:read"],
};

export class StaticTokenIdentityProvider implements IdentityProvider {
  private readonly identities: Array<{ tokenDigest: Buffer; principal: FleetPrincipal }>;

  constructor(identities: TokenIdentity[]) {
    if (!identities.length) throw new Error("At least one Fleet API identity is required.");
    this.identities = identities.map(({ token, ...identity }) => {
      if (token.length < 12) throw new Error(`Token for ${identity.subjectId} must contain at least 12 characters.`);
      return {
        tokenDigest: digest(token),
        principal: { ...identity, permissions: [...ROLE_PERMISSIONS[identity.role]] },
      };
    });
  }

  async authenticate(authorizationHeader: string | null): Promise<FleetPrincipal | null> {
    const match = authorizationHeader?.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    const candidate = digest(match[1]);
    const identity = this.identities.find((entry) => timingSafeEqual(candidate, entry.tokenDigest));
    return identity ? structuredClone(identity.principal) : null;
  }
}

export function hasPermission(principal: FleetPrincipal, permission: FleetPermission, siteId: string): boolean {
  return principal.permissions.includes(permission)
    && (principal.siteIds.includes("*") || principal.siteIds.includes(siteId));
}

export function permissionsForRole(role: FleetRole): FleetPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function createConfiguredIdentityProvider(environment: NodeJS.ProcessEnv = process.env): IdentityProvider {
  const issuer = environment.FLEET_OIDC_ISSUER?.trim();
  const audience = environment.FLEET_OIDC_AUDIENCE?.trim();
  const jwksUri = environment.FLEET_OIDC_JWKS_URI?.trim();
  if (issuer || audience || jwksUri) {
    if (!issuer || !audience || !jwksUri) {
      throw new Error("FLEET_OIDC_ISSUER, FLEET_OIDC_AUDIENCE, and FLEET_OIDC_JWKS_URI must be configured together.");
    }
    return new OidcIdentityProvider({
      issuer,
      audience,
      jwksUri,
      roleClaim: environment.FLEET_OIDC_ROLE_CLAIM?.trim() || undefined,
      sitesClaim: environment.FLEET_OIDC_SITES_CLAIM?.trim() || undefined,
      subjectTypeClaim: environment.FLEET_OIDC_SUBJECT_TYPE_CLAIM?.trim() || undefined,
      allowInsecureHttp: environment.NODE_ENV !== "production",
    });
  }
  return createDevelopmentIdentityProvider(resolveSecret("FLEET_API_TOKENS", environment), environment);
}

export function createDevelopmentIdentityProvider(
  serialized = resolveSecret("FLEET_API_TOKENS"),
  environment: NodeJS.ProcessEnv = process.env,
): StaticTokenIdentityProvider {
  if (serialized) return new StaticTokenIdentityProvider(parseTokenIdentities(serialized));
  if (environment.NODE_ENV === "production") {
    throw new Error("OIDC configuration or FLEET_API_TOKENS(_FILE) is required when NODE_ENV=production.");
  }
  return new StaticTokenIdentityProvider([
    { token: "brash-dev-viewer", subjectId: "dev-viewer", displayName: "Development Viewer", subjectType: "USER", role: "VIEWER", siteIds: ["*"] },
    { token: "brash-dev-operator", subjectId: "dev-operator", displayName: "Development Operator", subjectType: "USER", role: "OPERATOR", siteIds: ["*"] },
    { token: "brash-dev-admin", subjectId: "dev-admin", displayName: "Development Administrator", subjectType: "USER", role: "FLEET_ADMIN", siteIds: ["*"] },
  ]);
}

function parseTokenIdentities(serialized: string): TokenIdentity[] {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error("FLEET_API_TOKENS must be valid JSON.");
  }
  if (!Array.isArray(value)) throw new Error("FLEET_API_TOKENS must be a JSON array.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`FLEET_API_TOKENS[${index}] must be an object.`);
    const token = readString(entry, "token", index);
    const subjectId = readString(entry, "subjectId", index);
    const displayName = readString(entry, "displayName", index);
    const subjectType = readEnum(entry, "subjectType", ["USER", "SERVICE"] as const, index);
    const role = readEnum(entry, "role", ["VIEWER", "OPERATOR", "DISPATCHER", "FLEET_ADMIN", "INTEGRATION"] as const, index);
    const siteIds = (entry as Record<string, unknown>).siteIds;
    if (!Array.isArray(siteIds) || !siteIds.length || siteIds.some((siteId) => typeof siteId !== "string" || !siteId.trim())) {
      throw new Error(`FLEET_API_TOKENS[${index}].siteIds must be a non-empty string array.`);
    }
    return { token, subjectId, displayName, subjectType, role, siteIds };
  });
}

function readString(value: object, key: string, index: number): string {
  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error(`FLEET_API_TOKENS[${index}].${key} is required.`);
  return candidate;
}

function readEnum<const T extends readonly string[]>(value: object, key: string, allowed: T, index: number): T[number] {
  const candidate = readString(value, key, index);
  if (!allowed.includes(candidate)) throw new Error(`FLEET_API_TOKENS[${index}].${key} is invalid.`);
  return candidate as T[number];
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
