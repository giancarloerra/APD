import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Isolated HTTP fixture for the real Redis client's REST protocol. Tests may
// provide an execute function to exercise a separately namespaced real store.
export async function createApiHarness(execute) {
  const values = new Map();
  const run = execute ?? (async command => {
    const [name, key, value] = command;
    if (name.toLowerCase() === "ping") return "PONG";
    if (name.toLowerCase() === "get") return values.get(key) ?? null;
    if (name.toLowerCase() === "set") { values.set(key, value); return "OK"; }
    if (name.toLowerCase() === "del") return values.delete(key) ? 1 : 0;
    throw new Error(`Unexpected test Redis command: ${name}`);
  });
  const proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const commands = Array.isArray(body[0]) ? body : [body];
      const results = [];
      for (const command of commands) {
        try { results.push({ result: await run(command) }); }
        catch (error) { results.push({ error: error.message }); }
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(Array.isArray(body[0]) ? results : results[0]));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let child;
  let output = "";
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise(resolve => child.once("exit", resolve));
    child.kill("SIGTERM");
    await exited;
  };
  return {
    base, values,
    async start(overrides = {}) {
      await stop();
      output = "";
      child = spawn(process.execPath, ["server/index.js"], {
        cwd: new URL("../../", import.meta.url),
        env: { ...process.env, PORT: String(port), NODE_ENV: "development", CORS_ORIGIN: "", UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${proxy.address().port}`, UPSTASH_REDIS_REST_TOKEN: "synthetic-rest-token", MASTER_PASSWORD: "synthetic-password", SESSION_SECRET: "synthetic-session-secret", CRON_TRIGGER_TOKEN: "", METEOBLUE_API_KEY: "", METSERVICE_API_KEY: "", TELESCOPIUS_API_KEY: "", OBSERVER_LAT: "51.5", OBSERVER_LON: "-0.1", OBSERVER_ALT: "25", ...overrides },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", chunk => { output = (output + chunk).slice(-5000); });
      child.stderr.on("data", chunk => { output = (output + chunk).slice(-5000); });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
        if (output.includes("Server running on port")) return;
        await delay(25);
      }
      throw new Error(`Test server startup timed out: ${output}`);
    },
    async login() {
      const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "synthetic-password" }) });
      if (!response.ok) throw new Error(`Test login HTTP ${response.status}`);
      return response.headers.get("set-cookie").split(";")[0];
    },
    stop,
    async close() { await stop(); await new Promise(resolve => proxy.close(resolve)); },
  };
}
