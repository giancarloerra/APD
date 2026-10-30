import { afterAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import { SKY_SURVEYS, createSkySurveyService, parseSkyProperties } from "./skySurveyService.js";

const survey = SKY_SURVEYS[0];
const properties = (id = survey.creatorId) => `creator_did = ${id}\nhips_frame = equatorial\nhips_order = 9\nhips_tile_width = 512\nhips_tile_format = jpeg\n`;
// Image signatures exercise the proxy's response validation, not image decoding.
const jpeg = Buffer.from([255, 216, 255, 224, 255, 217]);
const imagePath = "Norder5/Dir0/Npix388.jpg";
const servers = [];
afterAll(async () => { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); });

describe("published sky-survey compatibility", () => {
  it("retains every existing survey selector and the pinned rendering choices", () => {
    const html = fs.readFileSync(new URL("../../public/skychart.html", import.meta.url), "utf8");
    const options = html.split('<select id="survey-select">')[1].split("</select>")[0];
    const ids = [...options.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
    expect(SKY_SURVEYS.map(item => item.id)).toEqual(ids);
    expect(new Set(SKY_SURVEYS.map(item => item.key)).size).toBe(ids.length);
    expect(SKY_SURVEYS.every(item => item.mirrors.length > 0 && item.creatorId.startsWith("ivo://"))).toBe(true);
    expect(SKY_SURVEYS.find(item => item.key === "dss-red").renderOptions.imgFormat).toBe("fits");
    expect(SKY_SURVEYS.find(item => item.key === "panstarrs").mirrors).toHaveLength(2);
    expect(SKY_SURVEYS.find(item => item.key === "rosat")).toMatchObject({ id: "P/ROSAT/intensity", creatorId: "ivo://ov-gso/P/RASS" });
  });

  it.each(SKY_SURVEYS)("tries every registered mirror for $name before declaring failure", async item => {
    const fetchImpl = vi.fn(async url => url.startsWith(item.mirrors.at(-1))
      ? new Response(properties(item.creatorId)) : new Response("upstream unavailable", { status: 503 }));
    const service = createSkySurveyService({ fetchImpl });
    const result = await service.resource(item.key, "properties");
    expect(result.mirror).toBe(item.mirrors.at(-1));
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual(item.mirrors.map(root => `${root}/properties`));
    expect(result.attempts).toHaveLength(item.mirrors.length - 1);
  });
});

describe("sky-survey network failures and recovery", () => {
  it("keeps using the working mirror for actual tiles and retains the primary's error", async () => {
    const fetchImpl = vi.fn(async url => url.startsWith(survey.mirrors[0])
      ? new Response("maintenance", { status: 503 })
      : new Response(url.endsWith("properties") ? properties() : jpeg));
    const service = createSkySurveyService({ fetchImpl });
    await service.resource(survey.key, "properties");
    // Aladin reads the same properties after APD's preflight. That second read
    // must not erase the reason an alternate mirror was selected.
    await service.resource(survey.key, "properties");
    const tile = await service.resource(survey.key, imagePath);
    expect(tile.body).toEqual(jpeg);
    expect(tile.contentType).toBe("image/jpeg");
    expect(fetchImpl.mock.calls.at(-1)[0]).toBe(`${survey.mirrors[1]}/${imagePath}`);
    expect(service.status(survey.key)).toMatchObject({ state: "ready", mirror: survey.mirrors[1], attempts: [{ status: 503 }] });
  });

  it("retries mirrors when an already selected server stops serving images", async () => {
    let failed = false;
    const service = createSkySurveyService({ fetchImpl: vi.fn(async url => {
      if (failed && url.startsWith(survey.mirrors[0])) throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
      return new Response(url.endsWith("properties") ? properties() : jpeg);
    }) });
    await service.resource(survey.key, "properties");
    await service.resource(survey.key, imagePath);
    failed = true;
    const result = await service.resource(survey.key, imagePath);
    expect(result.mirror).toBe(survey.mirrors[1]);
    expect(service.status(survey.key)).toMatchObject({ state: "ready", attempts: [{ code: "ECONNREFUSED", message: "Connection failed (ECONNREFUSED)" }] });
  });

  it("exposes complete exhaustion and permits an immediate explicit retry", async () => {
    let recovered = false;
    const fetchImpl = vi.fn(async url => recovered ? new Response(url.endsWith("properties") ? properties() : jpeg) : new Response("unavailable", { status: 503 }));
    const service = createSkySurveyService({ fetchImpl });
    await expect(service.resource(survey.key, "properties")).rejects.toMatchObject({ code: "mirrors_unavailable", attempts: expect.any(Array) });
    expect(service.status(survey.key)).toMatchObject({ state: "unavailable", attempts: expect.arrayContaining([{ host: new URL(survey.mirrors[0]).host, status: 503, code: "http_error", message: "HTTP 503" }]) });
    const calls = fetchImpl.mock.calls.length;
    await expect(service.resource(survey.key, imagePath)).rejects.toMatchObject({ code: "mirrors_unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    recovered = true;
    await service.resource(survey.key, "properties");
    await service.resource(survey.key, imagePath);
    expect(service.status(survey.key)).toMatchObject({ state: "ready", attempts: [] });
  });

  it("does not let an older failed tile overwrite a successful explicit retry", async () => {
    let finishOld;
    let old = true;
    const single = { ...survey, mirrors: [survey.mirrors[0]] };
    const service = createSkySurveyService({ surveys: [single], fetchImpl: async url => {
      if (url.endsWith("properties")) return new Response(properties());
      if (old) return new Promise(resolve => { finishOld = resolve; });
      return new Response(jpeg);
    } });
    await service.resource(survey.key, "properties");
    const pending = service.resource(survey.key, imagePath);
    const rejection = expect(pending).rejects.toMatchObject({ code: "mirrors_unavailable" });
    old = false;
    await service.resource(survey.key, "properties");
    await service.resource(survey.key, imagePath);
    finishOld(new Response("unavailable", { status: 503 }));
    await rejection;
    expect(service.status(survey.key)).toMatchObject({ state: "ready", mirror: survey.mirrors[0] });
  });

  it("rejects a different dataset and HTML responses before accepting a mirror", async () => {
    let stage = "metadata";
    const fetchImpl = vi.fn(async url => {
      if (url.startsWith(survey.mirrors[0])) return new Response(stage === "metadata" ? properties("ivo://CDS/P/DSS2/red")
        : url.endsWith("properties") ? properties() : "<html>upstream error</html>");
      return new Response(url.endsWith("properties") ? properties() : jpeg);
    });
    const service = createSkySurveyService({ fetchImpl });
    expect((await service.resource(survey.key, "properties")).attempts[0].code).toBe("invalid_metadata");
    stage = "image";
    const fresh = createSkySurveyService({ fetchImpl });
    expect((await fresh.resource(survey.key, imagePath)).attempts[0].code).toBe("invalid_resource");
  });

  it("checks a new mirror's dataset before accepting its image tiles", async () => {
    const subset = { ...survey, mirrors: survey.mirrors.slice(0, 3) };
    const fetchImpl = vi.fn(async url => {
      if (url.endsWith("properties")) return new Response(properties(url.startsWith(subset.mirrors[1]) ? "ivo://CDS/P/DSS2/red" : survey.creatorId));
      return url.startsWith(subset.mirrors[0]) ? new Response("unavailable", { status: 503 }) : new Response(jpeg);
    });
    const service = createSkySurveyService({ surveys: [subset], fetchImpl });
    await service.resource(survey.key, "properties");
    const result = await service.resource(survey.key, imagePath);
    expect(result.mirror).toBe(subset.mirrors[2]);
    expect(result.attempts.map(attempt => attempt.code)).toEqual(["http_error", "invalid_metadata"]);
    expect(fetchImpl.mock.calls.some(([url]) => url === `${subset.mirrors[1]}/${imagePath}`)).toBe(false);
  });

  it("preserves missing sky coverage and optional footprint failures without hiding working images", async () => {
    let missing = false;
    const service = createSkySurveyService({ fetchImpl: async url => missing && url.startsWith(survey.mirrors[1]) ? new Response("unavailable", { status: 503 })
      : url.endsWith("properties") ? new Response(properties())
      : missing || url.endsWith("Moc.fits") ? new Response("not found", { status: 404 }) : new Response(jpeg) });
    await service.resource(survey.key, imagePath);
    missing = true;
    await expect(service.resource(survey.key, "Norder9/Dir0/Npix1.jpg")).rejects.toMatchObject({ code: "resource_not_found", status: 404 });
    expect(service.status(survey.key).state).toBe("ready");
    await expect(service.resource(survey.key, "Moc.fits")).rejects.toMatchObject({ status: 404 });
    expect(service.status(survey.key).state).toBe("ready");
  });

  it("reports missing coverage while no image has loaded and recovers when a covered tile arrives", async () => {
    let missing = true;
    const service = createSkySurveyService({ fetchImpl: async url => url.endsWith("properties") ? new Response(properties())
      : missing ? new Response("not found", { status: 404 }) : new Response(jpeg) });
    await service.resource(survey.key, "properties");
    await expect(service.resource(survey.key, imagePath)).rejects.toMatchObject({ code: "resource_not_found" });
    expect(service.status(survey.key).state).toBe("no_coverage");
    missing = false;
    await service.resource(survey.key, imagePath);
    expect(service.status(survey.key).state).toBe("ready");
  });

  it("bounds a stalled upstream and distinguishes user cancellation", async () => {
    const single = { ...survey, mirrors: [survey.mirrors[0]] };
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })));
    const service = createSkySurveyService({ surveys: [single], fetchImpl, timeoutMs: 10 });
    await expect(service.resource(single.key, "properties")).rejects.toMatchObject({ attempts: [{ code: "timeout" }] });
    const controller = new AbortController();
    const pending = service.resource(single.key, "properties", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(["../.env", "https://example.org/properties", "Norder0/Dir0/Npix1.svg", "Norder0/Dir0/Npix1.jpg?url=https://example.org", "properties/extra"])(
    "does not request arbitrary URLs or paths: %s", async path => {
      const fetchImpl = vi.fn();
      const service = createSkySurveyService({ fetchImpl });
      await expect(service.resource(survey.key, path)).rejects.toMatchObject({ code: "invalid_resource_path", status: 400 });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

  it("exercises failover through real local HTTP sockets", async () => {
    const start = async handler => {
      const server = http.createServer(handler);
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      servers.push(server);
      return `http://127.0.0.1:${server.address().port}`;
    };
    const first = await start((_req, res) => { res.writeHead(503); res.end("unavailable"); });
    const second = await start((req, res) => res.end(req.url === "/properties" ? properties() : jpeg));
    const service = createSkySurveyService({ surveys: [{ ...survey, mirrors: [first, second] }] });
    expect((await service.resource(survey.key, "properties")).mirror).toBe(second);
    expect((await service.resource(survey.key, imagePath)).body).toEqual(jpeg);
  });
});

describe("name resolver boundaries", () => {
  const ngc6820 = { ra: 295.616375, dec: 23.087431 };
  const simbad = "Object NGC 6820 --- GNe\nCoordinates(ICRS,ep=J2000,eq=2000): 19 42 27.930 +23 05 14.75 (Opt ) B [32 18 90] 2009yCat.1315....0Z";
  const santa = JSON.stringify({ resolvedCoordinate: [{ ra: ngc6820.ra, decl: ngc6820.dec, resolver: "SIMBADCFA", cached: false }], status: "" });
  const heasarc = "19 42 27.93|23 05 14.8|19 40 19.81|22 58 05.6|59 08 21.2|-00 06 47.4|303 19 03.5|43 36 31.1\n295.616375|23.087431|295.082548|22.968235|59.139223|-0.113171|303.317641|43.608650\n";

  it("tries Harvard after CDS fails and returns the actual J2000 position", async () => {
    const fetchImpl = vi.fn(async url => url.includes("cds.unistra.fr") ? new Response("error", { status: 503 })
      : new Response("# M42\n%J 83.82010000 -5.38760000 = 05 35 16.8 -05 23 15"));
    const service = createSkySurveyService({ fetchImpl });
    await expect(service.resolve("M 42")).resolves.toMatchObject({ ra: 83.8201, dec: -5.3876, source: "vizier.cfa.harvard.edu", attempts: [{ status: 503 }] });
    expect(fetchImpl.mock.calls[1][0]).toBe("https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-o/SVNI?M%2042");
  });
  it.each(["NGC 6820", "NGC6820"])("resolves %s through direct SIMBAD when both Sesame hosts fail", async name => {
    const fetchImpl = vi.fn(async url => new Response(url.startsWith("https://simbad.cfa.harvard.edu/") ? simbad : "unavailable",
      { status: url.startsWith("https://simbad.cfa.harvard.edu/") ? 200 : 503 }));
    const service = createSkySurveyService({ fetchImpl });
    const result = await service.resolve(name);
    expect(result.ra).toBeCloseTo(ngc6820.ra, 6);
    expect(result.dec).toBeCloseTo(ngc6820.dec, 6);
    expect(result.source).toBe("simbad.cfa.harvard.edu");
    expect(result.attempts).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new URL(fetchImpl.mock.calls[2][0]).searchParams.get("Ident")).toBe(name);
  });
  it.each([
    ["mastresolver.stsci.edu", santa, 4],
    ["heasarc.gsfc.nasa.gov", heasarc, 5],
  ])("reaches %s after all preceding lookup routes fail", async (host, body, calls) => {
    const fetchImpl = vi.fn(async url => new URL(url).host === host ? new Response(body) : new Response("unavailable", { status: 503 }));
    const result = await createSkySurveyService({ fetchImpl }).resolve("NGC 6820");
    expect(result).toMatchObject({ ...ngc6820, source: host });
    expect(result.attempts).toHaveLength(calls - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    if (host === "mastresolver.stsci.edu") {
      const params = new URL(fetchImpl.mock.calls.at(-1)[0]).searchParams;
      expect(params.get("useCache")).toBe("false");
      expect(params.getAll("resolver")).toContain("SimbadCFA");
      expect(params.getAll("resolver")).toContain("NED");
    }
  });
  it("retains the southern declination and hour-to-degree conversion for Sirius", async () => {
    const body = "Coordinates(ICRS,ep=J2000,eq=2000): 06 45 08.91728 -16 42 58.0171 (Opt )";
    const service = createSkySurveyService({ fetchImpl: async url => new URL(url).host === "simbad.cfa.harvard.edu"
      ? new Response(body) : new Response("unavailable", { status: 503 }) });
    const result = await service.resolve("Sirius");
    expect(result.ra).toBeCloseTo(101.28715533333333, 6);
    expect(result.dec).toBeCloseTo(-16.71611586111111, 6);
  });
  it("does not manufacture a position when every service rejects the name", async () => {
    const service = createSkySurveyService({ fetchImpl: async url => new Response(url.includes("mastresolver.stsci.edu")
      ? JSON.stringify({ resolvedCoordinate: [], status: "" }) : url.includes("simbad.cfa.harvard.edu")
        ? "!! No known catalog could be found" : url.includes("heasarc.gsfc.nasa.gov") ? "" : "#! Nothing found") });
    await expect(service.resolve("M 999999")).rejects.toMatchObject({ code: "name_not_found", status: 404 });
  });
  it.each(["<html>Service error</html>", "null", JSON.stringify({ resolvedCoordinate: [null], status: "" }), JSON.stringify({ resolvedCoordinate: [{ ra: null, decl: null }], status: "" }),
    JSON.stringify({ resolvedCoordinate: [{ ra: 361, decl: 23 }], status: "" })])("rejects unusable resolver data without converting it to zero coordinates", async body => {
    const result = createSkySurveyService({ fetchImpl: async url => new URL(url).host === "mastresolver.stsci.edu"
      ? new Response(body) : new Response("unavailable", { status: 503 }) }).resolve("NGC 6820");
    await expect(result).rejects.toMatchObject({ code: "resolvers_unavailable", attempts: expect.arrayContaining([expect.objectContaining({ code: "invalid_response" })]) });
  });
  it("reports each route's timeout and preserves immediate cancellation", async () => {
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })));
    const service = createSkySurveyService({ fetchImpl, timeoutMs: 5, resolverTimeoutMs: 10 });
    await expect(service.resolve("NGC 6820")).rejects.toMatchObject({ attempts: [
      expect.objectContaining({ message: "Timed out after 0.005s" }), expect.objectContaining({ message: "Timed out after 0.005s" }),
      expect.objectContaining({ message: "Timed out after 0.01s" }), expect.objectContaining({ message: "Timed out after 0.01s" }), expect.objectContaining({ message: "Timed out after 0.01s" }),
    ] });
    const controller = new AbortController();
    const pending = service.resolve("NGC 6820", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
  it("does not continue to later services after cancellation during direct SIMBAD", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async (url, options) => {
      if (!url.startsWith("https://simbad.cfa.harvard.edu/")) return new Response("unavailable", { status: 503 });
      controller.abort();
      options.signal.throwIfAborted();
    });
    await expect(createSkySurveyService({ fetchImpl }).resolve("NGC 6820", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("closes the real upstream HTTP socket when a name lookup is cancelled", async () => {
    let received;
    const requested = new Promise(resolve => { received = resolve; });
    let closed;
    const disconnected = new Promise(resolve => { closed = resolve; });
    const server = http.createServer((req, _res) => { req.socket.once("close", closed); received(); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const fetchImpl = vi.fn((url, options) => url.startsWith("https://simbad.cfa.harvard.edu/")
      ? fetch(base, options) : Promise.resolve(new Response("unavailable", { status: 503 })));
    const controller = new AbortController();
    const pending = createSkySurveyService({ fetchImpl }).resolve("NGC 6820", controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await requested;
    controller.abort();
    await rejected;
    await disconnected;
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each([undefined, [], {}, "", "a\nb", "x".repeat(161)])("rejects malformed names before making a request", async name => {
    const fetchImpl = vi.fn();
    await expect(createSkySurveyService({ fetchImpl }).resolve(name)).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("parses public metadata without executable values", () => {
    expect(parseSkyProperties("# source\nhips_frame = equatorial\nignored\nobs_title = A = B")).toEqual({ hips_frame: "equatorial", obs_title: "A = B" });
  });
});
