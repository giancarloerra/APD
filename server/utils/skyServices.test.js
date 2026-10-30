import fs from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKY_SURVEYS } from "../services/skySurveyService.js";

const source = fs.readFileSync(new URL("../../public/sky-services.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../public/skychart.html", import.meta.url), "utf8");
const dsos = JSON.parse(fs.readFileSync(new URL("../../public/data/celestial/dsos.14.json", import.meta.url), "utf8")).features
  .filter(item => ["M 42", "M 45"].includes(item.properties.desig)).map(item => ({
    id: item.id, desig: item.properties.desig,
    ra: (item.geometry.coordinates[0] + 360) % 360, dec: item.geometry.coordinates[1],
  }));
const controllers = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.useRealTimers(); });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const unavailable = () => json({ error: "Online name resolvers are unavailable", attempts: [{ host: "cds.unistra.fr", message: "Timed out" }] }, 503);
const metadata = survey => ({ properties: { hips_frame: "equatorial", hips_order: "9", hips_tile_width: "512", hips_tile_format: "jpeg", creator_did: survey.creatorId } });

function fixture(fetchImpl, catalogue = { stars: [], dsos }) {
  const imagery = [], searches = [];
  let terminal, position = [10, 20], imageLayer;
  const original = vi.fn((_target, callbacks) => { callbacks?.success?.(position); return "native-coordinate-result"; });
  const aladin = {
    gotoObject: original,
    gotoRaDec: vi.fn((ra, dec) => { position = [ra, dec]; }), getRaDec: () => position,
    showSurvey: vi.fn(), getBaseImageLayer: () => imageLayer,
    createImageSurvey: vi.fn((_id, _name, url) => {
      // Pinned 3.6.5 signature: createImageSurvey(id, name, url, frame, order, options).
      new URL(url);
      return { query: Promise.resolve() };
    }), setBaseImageLayer: vi.fn(layer => { imageLayer = layer; }),
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: "", hidden: false, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }, getAttribute(name) { return this.attributes[name] ?? null; } });
    return elements.get(id);
  };
  element("search-btn").setAttribute("aria-busy", "false");
  const context = { AbortController, URL, location: { href: "https://apd.example/skychart.html" }, fetch: fetchImpl, setTimeout, clearTimeout, aladin, lockFovOnTarget: vi.fn(), document: { getElementById: element } };
  vm.createContext(context);
  vm.runInContext(source, context);
  for (const name of ["updateSkySearchStatus", "updateSkyNoticeVisibility"]) {
    const start = html.indexOf(`    function ${name}(`);
    const end = html.indexOf("\n    }", start) + 6;
    if (start < 0 || end <= start) throw new Error(`Missing search UI function: ${name}`);
    vm.runInContext(html.slice(start, end), context);
  }
  const getCatalogue = vi.fn(async () => catalogue);
  const controller = context.APDSkyServices.create({
    aladin, fetchImpl, getCatalogue,
    onImagery: state => imagery.push(state),
    onSearch: state => { context.updateSkySearchStatus(state); searches.push(state); if (["ready", "error"].includes(state.state)) terminal?.(state); },
  });
  controllers.push(controller);
  const start = html.indexOf("    function goToTarget(");
  const end = html.indexOf("\n    function ", start + 1);
  vm.runInContext(html.slice(start, end), context);
  return { controller, aladin, original, imagery, searches, context, element, getCatalogue,
    result: () => new Promise(resolve => { terminal = resolve; }),
  };
}

describe("sky-chart name search and existing navigation", () => {
  it("keeps Go busy until a provider response completes, then restores it", async () => {
    let respond;
    const scene = fixture(() => new Promise(resolve => { respond = resolve; }));
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
    const result = scene.result();
    vm.runInContext("goToTarget('M 42')", scene.context);
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("true");
    expect(scene.context.lockFovOnTarget).not.toHaveBeenCalled();
    respond(json({ ra: 83.8201, dec: -5.3876, source: "simbad.cfa.harvard.edu" }));
    await result;
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
    expect(scene.context.lockFovOnTarget).toHaveBeenCalledWith(83.8201, -5.3876, null);
  });

  it("keeps Go busy while the bundled catalogue is loading after provider failure", async () => {
    let catalogueReady;
    const scene = fixture(async () => unavailable(), new Promise(resolve => { catalogueReady = resolve; }));
    const result = scene.result();
    scene.aladin.gotoObject("M 45");
    await vi.waitFor(() => expect(scene.getCatalogue).toHaveBeenCalled());
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("true");
    catalogueReady({ stars: [], dsos });
    expect(await result).toMatchObject({ state: "ready", local: true });
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
  });

  it("restores Go when a failed provider lookup has no bundled name", async () => {
    const scene = fixture(async () => unavailable());
    const result = scene.result();
    scene.aladin.gotoObject("NGC 6820");
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("true");
    expect(await result).toMatchObject({ state: "error" });
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
  });

  it("clears Go on cancellation without letting an old response clear a newer search", async () => {
    const pending = [];
    const scene = fixture(() => new Promise(resolve => pending.push(resolve)));
    scene.aladin.gotoObject("M 42");
    scene.controller.cancelSearch();
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
    const result = scene.result();
    scene.aladin.gotoObject("M 45");
    pending[0](json({ ra: 83.8201, dec: -5.3876 }));
    await Promise.resolve();
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("true");
    pending[1](json({ ra: 56.75, dec: 24.1167 }));
    await result;
    expect(scene.element("search-btn").getAttribute("aria-busy")).toBe("false");
    expect(scene.aladin.gotoRaDec).toHaveBeenCalledOnce();
  });

  it("locks the FOV only after an online name produces a position", async () => {
    const scene = fixture(async () => json({ ra: 83.8201, dec: -5.3876, source: "vizier.cfa.harvard.edu" }));
    const result = scene.result();
    vm.runInContext("goToTarget('M 42')", scene.context);
    expect(scene.context.lockFovOnTarget).not.toHaveBeenCalled();
    await result;
    expect(scene.aladin.gotoRaDec).toHaveBeenCalledWith(83.8201, -5.3876);
    expect(scene.context.lockFovOnTarget).toHaveBeenCalledWith(83.8201, -5.3876, null);
  });

  it.each(["M42", "M 42", "m 45"])("uses a real bundled catalogue position for %s after online failure", async name => {
    const scene = fixture(async () => unavailable());
    const result = scene.result();
    scene.aladin.gotoObject(name);
    expect(await result).toMatchObject({ state: "ready", local: true, source: "Bundled catalogue" });
    const expected = dsos.find(item => item.desig.replace(/\s/g, "").toLowerCase() === name.replace(/\s/g, "").toLowerCase());
    expect(scene.aladin.gotoRaDec).toHaveBeenCalledWith(expected.ra, expected.dec);
  });

  it("reports an unknown name without moving or locking even after the former timer period", async () => {
    const scene = fixture(async () => unavailable());
    const result = scene.result();
    vm.runInContext("goToTarget('M 999999')", scene.context);
    expect(await result).toMatchObject({ state: "error", error: expect.stringContaining("no matching name"), attempts: [{ host: "cds.unistra.fr", message: "Timed out" }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(scene.aladin.gotoRaDec).not.toHaveBeenCalled();
    expect(scene.context.lockFovOnTarget).not.toHaveBeenCalled();
  });

  it("preserves the native coordinate parser and legacy error-callback signature", () => {
    const fetchImpl = vi.fn();
    const scene = fixture(fetchImpl);
    const success = vi.fn();
    expect(scene.aladin.gotoObject("12 34 56 +23 45 56", { success })).toBe("native-coordinate-result");
    expect(scene.original.mock.calls[0][0]).toBe("12 34 56 +23 45 56");
    expect(success).toHaveBeenCalledWith([10, 20]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not let a late name response overwrite a newer target or favourite", async () => {
    let resolveOld;
    const scene = fixture(url => url.includes("M42") ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve(json({ ra: 56.9, dec: 24.1, source: "cds.unistra.fr" })));
    const oldSuccess = vi.fn();
    scene.aladin.gotoObject("M42", { success: oldSuccess });
    const latest = scene.result();
    scene.aladin.gotoObject("M45");
    await latest;
    resolveOld(json({ ra: 83.82, dec: -5.38 }));
    await Promise.resolve(); await Promise.resolve();
    expect(oldSuccess).not.toHaveBeenCalled();
    expect(scene.aladin.getRaDec()).toEqual([56.9, 24.1]);
    scene.aladin.gotoObject("M42", { success: oldSuccess });
    scene.controller.cancelSearch();
    expect(scene.searches.at(-1)).toMatchObject({ state: "cancelled" });
    scene.aladin.gotoRaDec(1, 2);
    resolveOld(json({ ra: 83.82, dec: -5.38 }));
    await Promise.resolve(); await Promise.resolve();
    expect(scene.aladin.getRaDec()).toEqual([1, 2]);
  });

  it("does not substitute an empty catalogue for a failed local data boundary", async () => {
    const scene = fixture(async () => unavailable());
    // The actual loader rejects/marks unavailable when its required files fail.
    scene.controller.dispose();
    const errors = [];
    const controller = scene.context.APDSkyServices.create({ aladin: scene.aladin, fetchImpl: async () => unavailable(),
      getCatalogue: async () => { throw new Error("Local catalogue HTTP 503"); },
      onImagery() {}, onSearch: state => errors.push(state) });
    controllers.push(controller);
    scene.aladin.gotoObject("M42");
    await vi.waitFor(() => expect(errors.at(-1)).toMatchObject({ state: "error", error: "Local catalogue HTTP 503" }));
    expect(scene.aladin.gotoRaDec).not.toHaveBeenCalled();
  });
});

describe("sky imagery, catalogue view and recovery", () => {
  it("creates the original selected survey through the local proxy without moving the sky", async () => {
    const survey = SKY_SURVEYS.find(item => item.key === "dss-red");
    const scene = fixture(async url => url.endsWith("sky-surveys.json") ? json(SKY_SURVEYS)
      : url.endsWith("metadata") ? json(metadata(survey)) : json({ state: "ready", mirror: survey.mirrors[0], attempts: [] }));
    await scene.controller.selectSurvey(survey.id);
    expect(scene.aladin.createImageSurvey).toHaveBeenCalledWith(survey.id, survey.name, `https://apd.example/api/skychart/surveys/${survey.key}`, undefined, undefined,
      expect.objectContaining({ imgFormat: "fits", colormap: survey.renderOptions.colormap }));
    expect(scene.imagery[0]).toMatchObject({ local: true, state: "loading" });
    expect(scene.imagery.at(-1)).toMatchObject({ local: false, state: "ready" });
    expect(scene.aladin.gotoRaDec).not.toHaveBeenCalled();
  });

  it("keeps the local chart active when metadata exhausts all mirrors, then retries immediately", async () => {
    let recovered = false;
    const survey = SKY_SURVEYS[0];
    const scene = fixture(async url => url.endsWith("sky-surveys.json") ? json(SKY_SURVEYS)
      : !recovered ? json({ error: "All survey mirrors are unavailable", attempts: [{ host: "alasky.cds.unistra.fr", message: "Timed out" }] }, 503)
        : url.endsWith("metadata") ? json(metadata(survey)) : json({ state: "ready", mirror: survey.mirrors[2], attempts: [] }));
    await scene.controller.selectSurvey(survey.id);
    expect(scene.imagery.at(-1)).toMatchObject({ state: "unavailable", local: true, error: "All survey mirrors are unavailable" });
    // A new chart has no image layer to hide. Aladin's native showSurvey throws
    // in that state; local catalogue startup must not call it until a layer exists.
    expect(scene.aladin.showSurvey).not.toHaveBeenCalled();
    recovered = true;
    await scene.controller.retry();
    expect(scene.imagery.at(-1)).toMatchObject({ state: "ready", local: false });
    expect(scene.aladin.showSurvey).toHaveBeenLastCalledWith(true);
  });

  it("switches back to local visuals after a later tile outage and stops requesting status", async () => {
    const survey = SKY_SURVEYS[0];
    let statusCalls = 0;
    const scene = fixture(async url => url.endsWith("sky-surveys.json") ? json(SKY_SURVEYS)
      : url.endsWith("metadata") ? json(metadata(survey))
        : json({ state: ++statusCalls === 1 ? "ready" : "unavailable", mirror: null, attempts: [] }));
    await scene.controller.selectSurvey(survey.id);
    await vi.advanceTimersByTimeAsync(1500);
    expect(scene.imagery.at(-1)).toMatchObject({ state: "unavailable", local: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect(statusCalls).toBe(2);
  });

  it("does not apply an old survey after a newer selection completes", async () => {
    let oldMetadata;
    const first = SKY_SURVEYS[0], second = SKY_SURVEYS[1];
    const fetchImpl = vi.fn(async url => url.endsWith("sky-surveys.json") ? json(SKY_SURVEYS)
      : url.includes(`${first.key}/metadata`) ? new Promise(resolve => { oldMetadata = resolve; })
        : url.endsWith("metadata") ? json(metadata(second)) : json({ state: "ready", mirror: second.mirrors[0], attempts: [] }));
    const scene = fixture(fetchImpl);
    const old = scene.controller.selectSurvey(first.id);
    await vi.waitFor(() => expect(oldMetadata).toBeTypeOf("function"));
    await scene.controller.selectSurvey(second.id);
    oldMetadata(json(metadata(first)));
    await old;
    expect(scene.aladin.createImageSurvey).toHaveBeenCalledTimes(1);
    expect(scene.aladin.createImageSurvey.mock.calls[0][0]).toBe(second.id);
  });
});
