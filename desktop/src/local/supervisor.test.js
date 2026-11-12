const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertBackendNodeSupported,
  hasExited,
  startLocalStack,
  stopLocalStack,
  localStackActive,
  isLocalStackStopped,
} = require("./supervisor");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The stop loop and the boot-time crash detector both ask "is this child
// gone?". A process killed by a signal never gets an exit CODE — Node reports
// exitCode === null and signalCode === "SIGTERM" — which is exactly how
// PostgREST leaves on every quit. Reading exitCode alone therefore answered
// "still running" for a dead process, and Cmd+Q sat through the whole 10 s
// deadline.
test("hasExited is true for a child killed by a signal, not only for a clean exit code", async () => {
  const killed = spawn("sleep", ["30"]);
  const clean = spawn("sh", ["-c", "exit 3"]);
  assert.equal(hasExited(killed), false, "a running child has not exited");
  killed.kill("SIGTERM");
  const deadline = Date.now() + 5_000;
  while ((!hasExited(killed) || !hasExited(clean)) && Date.now() < deadline) await sleep(20);
  assert.equal(killed.exitCode, null, "signal death carries no exit code (the trap)");
  assert.equal(killed.signalCode, "SIGTERM");
  assert.equal(hasExited(killed), true);
  assert.equal(clean.exitCode, 3);
  assert.equal(hasExited(clean), true);
});

// Cmd+Q during the first-run boot used to find localStackRunning() false and
// skip the stop, orphaning postgres/gotrue on the fixed ports. The quit path
// must see a booting stack as active, and a stop must end the boot without
// it spawning anything more. The stop must also outlast the step in flight:
// before, it returned while that step was still running, so the boot
// rejected later, after the quit had moved on (shown as "Local mode failed
// to start", or an unhandled rejection when nobody was listening yet).
test("a stop during boot waits out the step in flight, which then spawns nothing", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mike-supervisor-"));
  const pgBin = path.join(tmp, "resources", "local-stack", "bin", "pg", "bin");
  fs.mkdirSync(pgBin, { recursive: true });
  fs.writeFileSync(path.join(pgBin, "postgres"), "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
  const userData = path.join(tmp, "userData");
  fs.mkdirSync(path.join(userData, "local", "pgdata"), { recursive: true });
  fs.writeFileSync(path.join(userData, "local", "pgdata", "PG_VERSION"), "16\n");

  // Postgres "answers" at once, and role bootstrap is a step this test
  // finishes by hand after the stop has been requested.
  const { Client } = require("pg");
  const schema = require("./schema");
  const original = { connect: Client.prototype.connect, query: Client.prototype.query, end: Client.prototype.end, bootstrapRoles: schema.bootstrapRoles };
  Client.prototype.connect = async () => {};
  Client.prototype.query = async () => ({ rows: [] });
  Client.prototype.end = async () => {};
  let finishStep;
  schema.bootstrapRoles = () => new Promise((resolve) => { finishStep = resolve; });
  const originalResources = process.resourcesPath;
  process.resourcesPath = path.join(tmp, "resources");
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  t.after(() => {
    Object.assign(Client.prototype, { connect: original.connect, query: original.query, end: original.end });
    schema.bootstrapRoles = original.bootstrapRoles;
    process.resourcesPath = originalResources;
    process.off("unhandledRejection", onUnhandled);
  });
  const app = { isPackaged: true, getPath: () => userData };

  const statuses = [];
  const booting = startLocalStack(app, (msg) => statuses.push(msg));
  const deadline = Date.now() + 5_000;
  while (!finishStep && Date.now() < deadline) await sleep(20);
  assert.ok(finishStep, "boot reached the role bootstrap step");
  assert.equal(localStackActive(), true, "a booting stack must count as active");

  let stopped = false;
  const stopping = stopLocalStack().then(() => { stopped = true; });
  await sleep(300);
  assert.equal(stopped, false, "the stop waits for the step in flight");
  finishStep(); // the step succeeds after the stop was requested
  await stopping;

  // Settled by the time the stop returns: nothing later can reject or spawn.
  const outcome = await Promise.race([
    booting.then(() => "resolved", (err) => err),
    sleep(0).then(() => "still pending"),
  ]);
  assert.ok(isLocalStackStopped(outcome), `boot ended as stopped, got ${outcome}`);
  await sleep(50);
  assert.deepEqual(unhandled, []);
  assert.equal(localStackActive(), false);
  assert.ok(!statuses.includes("Starting auth…"), "no service starts after the stop");
});

// The backend runs on Electron's bundled Node. A Node below the backend's
// engines floor crashed it at boot inside undici (MIKE-BACKEND-3R), so the
// supervisor refuses to start the stack on one, naming the cause.
test("refuses to start the backend on an Electron whose Node is below the backend's engines floor", () => {
  const backendDir = path.resolve(__dirname, "../../../backend");
  const fakeNode = (version) => ({
    NODE_OPTIONS: `--import="data:text/javascript,Object.defineProperty(process,'versions',{value:{...process.versions,node:'${version}'}})"`,
  });
  assert.throws(
    () => assertBackendNodeSupported(backendDir, fakeNode("22.14.0")),
    /Electron's Node\. Mike's backend needs Node >=22\.19\.0 .* this is Node 22\.14\.0/,
  );
  assert.doesNotThrow(() => assertBackendNodeSupported(backendDir, fakeNode("22.22.0")));
  // The Node this test runs on (the same floor applies to it).
  assert.doesNotThrow(() => assertBackendNodeSupported(backendDir));
});
