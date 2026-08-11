import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createFleetServer, createInitialState } from "../server.mjs";

let server;
let baseUrl;

before(async () => {
  server = createFleetServer(createInitialState());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("health endpoint reports the fleet", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.robots, 6);
});

test("a mission can be assigned", async () => {
  const response = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ robotId: "BR-04", destination: "quality", destinationLabel: "Quality" }),
  });
  assert.equal(response.status, 201);
  const mission = await response.json();
  assert.equal(mission.robot, "BR-04");
  assert.equal(mission.to, "Quality");
});

test("a robot can be stopped and resumed", async () => {
  let response = await fetch(`${baseUrl}/api/robots/BR-01/stop`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "stopped");
  response = await fetch(`${baseUrl}/api/robots/BR-01/resume`, { method: "POST" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "moving");
});
