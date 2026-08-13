import assert from "node:assert/strict";
import test from "node:test";
import { loadPersistenceConfig } from "./database-config.js";
import { loadSiteConfig } from "./site-config.js";

test("site and database schema configuration reject unsafe identifiers", () => {
  assert.deepEqual(loadSiteConfig({ FLEET_SITE_ID: "plant-north" }), { siteId: "plant-north" });
  assert.throws(() => loadSiteConfig({ NODE_ENV: "production" }), /FLEET_SITE_ID is required/);
  assert.throws(() => loadSiteConfig({ FLEET_SITE_ID: "Plant North" }), /lowercase kebab-case/);
  assert.throws(() => loadPersistenceConfig({ FLEET_PERSISTENCE: "postgres", DATABASE_URL: "postgresql://test", DATABASE_SCHEMA: "unsafe;drop" }), /lowercase PostgreSQL identifier/);
  assert.equal(loadPersistenceConfig({ FLEET_PERSISTENCE: "postgres", DATABASE_URL: "postgresql://test", DATABASE_SCHEMA: "brash_plant_north" }).database?.schema, "brash_plant_north");
});
