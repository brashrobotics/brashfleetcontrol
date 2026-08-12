import assert from "node:assert/strict";
import test from "node:test";
import { retryPostgresStartup } from "./migrations.js";

test("PostgreSQL startup retry recovers from transient connection failures", async () => {
  let attempts = 0;
  const result = await retryPostgresStartup(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw Object.assign(new Error("Connection terminated unexpectedly"), {
        code: "ECONNRESET",
      });
    }
    return "connected";
  }, {
    timeoutMs: 100,
    initialDelayMs: 1,
    maxDelayMs: 2,
  });

  assert.equal(result, "connected");
  assert.equal(attempts, 3);
});

test("PostgreSQL startup retry does not hide configuration errors", async () => {
  let attempts = 0;
  await assert.rejects(
    retryPostgresStartup(async () => {
      attempts += 1;
      throw Object.assign(new Error("password authentication failed"), { code: "28P01" });
    }, {
      timeoutMs: 100,
      initialDelayMs: 1,
      maxDelayMs: 2,
    }),
    /password authentication failed/,
  );
  assert.equal(attempts, 1);
});
