import { createPublicKey, verify } from "node:crypto";
import type { FleetRole } from "@brash/contracts";
import type { FleetPrincipal, IdentityProvider } from "./access-control.js";
import { permissionsForRole } from "./access-control.js";

interface JwtHeader { alg?: unknown; kid?: unknown; typ?: unknown }
interface JwtClaims extends Record<string, unknown> {
  iss?: unknown; aud?: unknown; sub?: unknown; exp?: unknown; nbf?: unknown;
  name?: unknown; preferred_username?: unknown; client_id?: unknown;
}
type JwksKey = JsonWebKey & { kid?: string; use?: string; alg?: string };
interface JwksDocument { keys?: JwksKey[] }

export interface OidcIdentityProviderOptions {
  issuer: string;
  audience: string;
  jwksUri: string;
  roleClaim?: string;
  sitesClaim?: string;
  subjectTypeClaim?: string;
  clockSkewSeconds?: number;
  jwksCacheMs?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  allowInsecureHttp?: boolean;
}

const ROLES: readonly FleetRole[] = ["VIEWER", "OPERATOR", "DISPATCHER", "FLEET_ADMIN", "INTEGRATION"];

export class OidcIdentityProvider implements IdentityProvider {
  private keys = new Map<string, JwksKey>();
  private keysExpireAt = 0;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: OidcIdentityProviderOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    validateUrl(options.issuer, "OIDC issuer", options.allowInsecureHttp);
    validateUrl(options.jwksUri, "OIDC JWKS URI", options.allowInsecureHttp);
    if (!options.audience.trim()) throw new Error("OIDC audience is required.");
    for (const claim of [options.roleClaim ?? "brash_role", options.sitesClaim ?? "brash_sites", options.subjectTypeClaim ?? "brash_subject_type"]) {
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/.test(claim)) throw new Error(`Invalid OIDC claim name: ${claim}`);
    }
  }

  async authenticate(authorizationHeader: string | null): Promise<FleetPrincipal | null> {
    const bearer = authorizationHeader?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!bearer || bearer.length > 16_384) return null;
    try {
      const parts = bearer.split(".");
      if (parts.length !== 3) return null;
      const header = parseSegment<JwtHeader>(parts[0]);
      const claims = parseSegment<JwtClaims>(parts[1]);
      if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return null;
      if (!this.validClaims(claims)) return null;
      const jwk = await this.getKey(header.kid);
      if (!jwk || jwk.kty !== "RSA" || (jwk.use && jwk.use !== "sig") || (jwk.alg && jwk.alg !== "RS256")) return null;
      const valid = verify(
        "RSA-SHA256",
        Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: "jwk" }),
        Buffer.from(parts[2], "base64url"),
      );
      if (!valid) return null;
      return this.toPrincipal(claims);
    } catch {
      return null;
    }
  }

  private validClaims(claims: JwtClaims): boolean {
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    const skew = this.options.clockSkewSeconds ?? 60;
    const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    return claims.iss === this.options.issuer
      && Array.isArray(audience) && audience.includes(this.options.audience)
      && typeof claims.sub === "string" && Boolean(claims.sub)
      && typeof claims.exp === "number" && claims.exp > nowSeconds - skew
      && (claims.nbf === undefined || (typeof claims.nbf === "number" && claims.nbf <= nowSeconds + skew));
  }

  private toPrincipal(claims: JwtClaims): FleetPrincipal | null {
    const roleValue = claims[this.options.roleClaim ?? "brash_role"];
    const sitesValue = claims[this.options.sitesClaim ?? "brash_sites"];
    if (typeof roleValue !== "string" || !ROLES.includes(roleValue as FleetRole)) return null;
    if (!Array.isArray(sitesValue) || !sitesValue.length || sitesValue.some((site) => typeof site !== "string" || !site)) return null;
    const subjectTypeValue = claims[this.options.subjectTypeClaim ?? "brash_subject_type"];
    const subjectType = subjectTypeValue === "SERVICE" || subjectTypeValue === "USER"
      ? subjectTypeValue
      : typeof claims.client_id === "string" ? "SERVICE" : "USER";
    const displayName = [claims.name, claims.preferred_username, claims.sub].find((value) => typeof value === "string" && value) as string;
    const role = roleValue as FleetRole;
    return {
      subjectId: claims.sub as string,
      displayName,
      subjectType,
      role,
      siteIds: [...sitesValue] as string[],
      permissions: permissionsForRole(role),
    };
  }

  private async getKey(kid: string): Promise<JwksKey | undefined> {
    if (this.now().getTime() >= this.keysExpireAt || !this.keys.has(kid)) await this.refreshKeys();
    return this.keys.get(kid);
  }

  private async refreshKeys(): Promise<void> {
    const response = await this.fetcher(this.options.jwksUri, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`JWKS request failed with status ${response.status}.`);
    const document = await response.json() as JwksDocument;
    if (!Array.isArray(document.keys)) throw new Error("JWKS response does not contain keys.");
    const nextKeys = new Map<string, JwksKey>();
    for (const key of document.keys) if (typeof key.kid === "string" && key.kid) nextKeys.set(key.kid, key);
    if (!nextKeys.size) throw new Error("JWKS response contains no keyed public keys.");
    this.keys = nextKeys;
    this.keysExpireAt = this.now().getTime() + (this.options.jwksCacheMs ?? 300_000);
  }
}

function parseSegment<T>(segment: string): T {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
}

function validateUrl(value: string, label: string, allowInsecureHttp = false): void {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(allowInsecureHttp && url.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS.`);
  }
}
