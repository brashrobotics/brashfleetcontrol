import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveSecret } from "@brash/config";
import { createConfiguredIdentityProvider } from "../../apps/fleet-server/src/modules/identity/access-control.js";
import { OidcIdentityProvider } from "../../apps/fleet-server/src/modules/identity/oidc-identity-provider.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const now = new Date("2026-08-13T10:00:00.000Z");

test("OIDC provider validates issuer, audience, signature, expiry, role, and site scopes", async () => {
  let fetches = 0;
  const provider = new OidcIdentityProvider({
    issuer: "https://identity.example.test/realms/factory",
    audience: "brash-fleet-api",
    jwksUri: "https://identity.example.test/jwks",
    now: () => now,
    fetch: async () => {
      fetches += 1;
      return Response.json({ keys: [publicJwk] });
    },
  });
  const token = jwt({
    iss: "https://identity.example.test/realms/factory",
    aud: ["account", "brash-fleet-api"],
    sub: "operator-42",
    name: "Factory Operator",
    exp: epoch(now) + 300,
    nbf: epoch(now) - 5,
    brash_role: "OPERATOR",
    brash_sites: ["plant-a"],
  });

  const identity = await provider.authenticate(`Bearer ${token}`);
  assert.equal(identity?.subjectId, "operator-42");
  assert.equal(identity?.role, "OPERATOR");
  assert.deepEqual(identity?.siteIds, ["plant-a"]);
  assert.ok(identity?.permissions.includes("recovery:manage"));
  assert.equal(await provider.authenticate(`Bearer ${token}`) !== null, true);
  assert.equal(fetches, 1, "JWKS should be cached");

  assert.equal(await provider.authenticate(`Bearer ${jwt({
    iss: "https://identity.example.test/realms/factory", aud: "wrong-api", sub: "operator-42",
    exp: epoch(now) + 300, brash_role: "OPERATOR", brash_sites: ["plant-a"],
  })}`), null);
  assert.equal(await provider.authenticate(`Bearer ${jwt({
    iss: "https://identity.example.test/realms/factory", aud: "brash-fleet-api", sub: "operator-42",
    exp: epoch(now) - 120, brash_role: "OPERATOR", brash_sites: ["plant-a"],
  })}`), null);
});

test("configured identity selects OIDC and production rejects insecure endpoints", () => {
  const provider = createConfiguredIdentityProvider({
    FLEET_OIDC_ISSUER: "https://identity.example.test",
    FLEET_OIDC_AUDIENCE: "fleet",
    FLEET_OIDC_JWKS_URI: "https://identity.example.test/jwks",
    NODE_ENV: "production",
  });
  assert.ok(provider instanceof OidcIdentityProvider);
  assert.throws(() => createConfiguredIdentityProvider({
    FLEET_OIDC_ISSUER: "http://identity.example.test",
    FLEET_OIDC_AUDIENCE: "fleet",
    FLEET_OIDC_JWKS_URI: "http://identity.example.test/jwks",
    NODE_ENV: "production",
  }), /must use HTTPS/);
});

test("secret resolver reads mounted files and rejects ambiguous configuration", () => {
  const directory = mkdtempSync(join(tmpdir(), "brash-secret-test-"));
  const secretFile = join(directory, "api-token.json");
  try {
    writeFileSync(secretFile, "mounted-secret\n", { mode: 0o600 });
    assert.equal(resolveSecret("TOKEN", { TOKEN_FILE: secretFile }), "mounted-secret");
    assert.throws(() => resolveSecret("TOKEN", { TOKEN: "direct", TOKEN_FILE: secretFile }), /mutually exclusive/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function jwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function epoch(value: Date): number {
  return Math.floor(value.getTime() / 1_000);
}
