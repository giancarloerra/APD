import fs from "node:fs";
import vm from "node:vm";
import * as Astronomy from "astronomy-engine";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(new URL("../../public/solar-system.js", import.meta.url), "utf8");
const reference = JSON.parse(fs.readFileSync(new URL("../test/solar-system-reference.json", import.meta.url), "utf8"));
function geometry(engine = Astronomy) {
  const context = { Astronomy: engine, Date };
  vm.runInNewContext(source, context);
  return context.APDSolarSystem;
}
const api = geometry();
const location = { lat: 51.5, lon: -0.1, alt: 25 };
const date = "2026-10-25T00:00:00Z";
const radians = Math.PI / 180;
const html = fs.readFileSync(new URL("../../public/skychart.html", import.meta.url), "utf8");
function pageFunction(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf("\n    function ", start + 1);
  if (start < 0 || end < 0) throw new Error(`Missing sky-chart function: ${name}`);
  return html.slice(start, end);
}

function separation(a, b) {
  const ra = (a.ra - b.ra) * radians;
  const dec = (a.dec - b.dec) * radians;
  const haversine = Math.sin(dec / 2) ** 2 + Math.cos(a.dec * radians) * Math.cos(b.dec * radians) * Math.sin(ra / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(haversine))) / radians;
}

describe("solar-system angular framing", () => {
  // Public JPL Horizons observer tables: ICRF quantities 1,13,14,17,20,32.
  // Locations are London, Sydney and the equator/prime-meridian reference point.
  it.each(reference)("matches JPL dimensions and documented position precision for $name at $date ($lat, $lon)", row => {
    const body = api.calculate(row.name, row.date, { lat: row.lat, lon: row.lon, alt: row.height });
    // Astronomy Engine documents ±1 arcminute position accuracy. Diameter comparisons
    // allow 0.1 percent for radius conventions, model precision and printed rounding.
    expect(separation(body, row) * 3600).toBeLessThan(60);
    expect(Math.abs(body.diameter * 3600 / row.diameterArcsec - 1)).toBeLessThan(0.001);
    expect(Math.abs(body.distanceAU / row.distanceAU - 1)).toBeLessThan(0.001);
  });

  it("projects the Moon's actual angular radius instead of a minimum screen-sized symbol", () => {
    const moon = api.calculate("Moon", date, location);
    for (const point of moon.outlines[0]) {
      expect(separation(moon, { ra: point[0], dec: point[1] })).toBeCloseTo(moon.diameter / 2, 9);
    }
    const neptune = api.calculate("Neptune", date, location);
    expect(neptune.diameter * 3600).toBeLessThan(3);
    expect(neptune.outlines[0].at(-1)[0]).toBeCloseTo(neptune.outlines[0][0][0], 10);
  });

  it("uses observer position and elevation for lunar parallax and changing distance", () => {
    const london = api.calculate("Moon", date, location);
    const opposite = api.calculate("Moon", date, { lat: -51.5, lon: 179.9, alt: 25 });
    const mountain = api.calculate("Moon", date, { ...location, alt: 4000 });
    expect(separation(london, opposite)).toBeGreaterThan(0.5);
    expect(london.diameter).not.toBe(opposite.diameter);
    expect(london.diameter).not.toBe(mountain.diameter);
  });

  it("uses the selected instant consistently across equivalent timezone representations", () => {
    const utc = api.calculate("Jupiter", date, location);
    const nepal = api.calculate("Jupiter", "2026-10-25T05:45:00+05:45", location);
    expect(nepal).toEqual(utc);
    expect(api.calculate("Jupiter", "2026-11-25T00:00:00Z", location).ra).not.toBe(utc.ra);
    expect(api.calculate("Moon", date, { lat: 0, lon: 0, alt: 0 }).diameter).toBeGreaterThan(0);
  });

  it("includes Saturn's projected main rings and the flattened planetary disk", () => {
    const saturn = api.calculate("Saturn", date, location);
    expect(saturn.outlines).toHaveLength(2);
    expect(saturn.ringDiameter / saturn.diameter).toBeCloseTo(136780 / 60268, 5);
    expect(saturn.minorDiameter / saturn.diameter).toBeLessThan(0.92);
    const edge = api.calculate("Saturn", "2025-03-23T00:00:00Z", location);
    const open = api.calculate("Saturn", "2032-12-20T00:00:00Z", location);
    expect(Math.abs(edge.ringOpening)).toBeLessThan(1);
    expect(Math.abs(open.ringOpening)).toBeGreaterThan(20);
  });

  it.each(reference.filter(row => row.name === "Saturn"))("matches Saturn's J2000 ring orientation at $date", row => {
    const body = api.calculate(row.name, row.date, { lat: row.lat, lon: row.lon, alt: row.height });
    // Horizons' quantity 17 uses true-of-date north. Quantity 32 supplies the
    // ICRF pole, allowing an independent projection into the survey's J2000 frame.
    const ra = row.ra * radians, dec = row.dec * radians;
    const poleRA = row.northPoleRA * radians, poleDec = row.northPoleDec * radians;
    const east = Math.cos(poleDec) * Math.sin(poleRA - ra);
    const north = Math.sin(poleDec) * Math.cos(dec) - Math.cos(poleDec) * Math.sin(dec) * Math.cos(poleRA - ra);
    const lineOfSight = Math.sin(poleDec) * Math.sin(dec) + Math.cos(poleDec) * Math.cos(dec) * Math.cos(poleRA - ra);
    const expectedAngle = (Math.atan2(east, north) / radians + 360) % 360;
    const angleError = Math.abs((body.poleAngle - expectedAngle + 540) % 360 - 180);
    expect(angleError).toBeLessThan(0.02);
    expect(Math.abs(body.ringOpening + Math.asin(lineOfSight) / radians)).toBeLessThan(0.02);
  });

  it("does not hide unavailable calculations or invalid observing inputs", () => {
    expect(() => geometry(null).calculate("Moon", date, location)).toThrow("did not load");
    expect(() => api.calculate("Earth", date, location)).toThrow("Unsupported");
    expect(() => api.calculate("Moon", "not a date", location)).toThrow("Invalid observing time");
    for (const invalid of [{ ...location, lat: NaN }, { ...location, lon: 181 }, { ...location, alt: undefined }]) {
      expect(() => api.calculate("Moon", date, invalid)).toThrow("latitude, longitude and elevation");
    }
  });
});

describe("sky-chart angular-size compatibility", () => {
  it("keeps drawing a partial lunar limb when the body is larger than the viewport", () => {
    const body = api.calculate("Moon", date, location);
    let segments = 0;
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() { segments++; }, stroke() {} };
    const context = {
      document: { getElementById: () => ({ getContext: () => ctx }) },
      aladin: { getFov: () => [0.01, 0.01] }, PLANETS: {},
      safeW2P: (ra, dec) => [(ra - body.outlines[0][0][0]) * 100000 + 500, (body.outlines[0][0][1] - dec) * 100000 + 500],
      pixDist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    };
    vm.createContext(context);
    vm.runInContext(pageFunction("drawAngularBodies"), context);
    context.drawAngularBodies([body], [1000, 1000]);
    expect(segments).toBeGreaterThan(0);
  });

  it("restores older sky settings and saves the new choice under the original storage key", () => {
    const old = { mode: "skychart", chkMoon: true, chkPlanets: true, activeFovId: 17, rotation: "18", lat: "0", lon: "0", centerRA: 12.79, centerDec: 9, viewFov: 1.2 };
    let stored = JSON.stringify(old);
    const elements = new Map();
    const warnings = [];
    const element = id => {
      if (!elements.has(id)) elements.set(id, { value: id === "solar-system-size" ? "markers" : "", checked: false, style: {}, classList: { contains: () => false, toggle() {}, add() {} } });
      return elements.get(id);
    };
    const context = {
      document: { getElementById: element },
      localStorage: { getItem: key => { expect(key).toBe("astro-sky-dashboard-v1"); return stored; }, setItem: (key, value) => { expect(key).toBe("astro-sky-dashboard-v1"); stored = value; } },
      console: { warn: (...args) => warnings.push(args) }, SETTINGS_KEY: "astro-sky-dashboard-v1",
      aladin: { getRaDec: () => [12.79, 9], getFov: () => [1.2, 0.9], gotoRaDec() {}, setFov() {} },
      horizonEnabled: false, activeFovId: 1, fovLocked: false, fovLockedRaDec: null,
      mosaicActive: false, mosaicCols: 2, mosaicRows: 2, mosaicOverlap: 10,
      updateMosaicInfo() {},
      setHorizonEnabled: value => { context.horizonEnabled = value; },
    };
    vm.createContext(context);
    vm.runInContext(pageFunction("saveSettings") + pageFunction("loadAndApplySettings"), context);
    context.loadAndApplySettings();
    expect(warnings).toEqual([]);
    expect(element("solar-system-size").value).toBe("markers");
    expect(element("chk-moon").checked).toBe(true);
    expect(context.activeFovId).toBe(17);
    expect(context.obsLat).toBe(0);
    expect(context.obsLon).toBe(0);
    expect(context.horizonEnabled).toBe(true);
    element("solar-system-size").value = "angular";
    context.saveSettings();
    expect(JSON.parse(stored)).toMatchObject({ solarSystemSize: "angular", chkMoon: true, chkPlanets: true, activeFovId: 17, rotation: "18", lat: "0", lon: "0", viewFov: 1.2 });
    element("solar-system-size").value = "markers";
    context.loadAndApplySettings();
    expect(element("solar-system-size").value).toBe("angular");
    expect(warnings).toEqual([]);
  });

  it("shows actual location/calculation failures without substituting marker geometry, then recovers", () => {
    let errorText = "", alertUpdates = 0;
    const error = {
      hidden: true,
      get textContent() { return errorText; },
      set textContent(value) { errorText = value; alertUpdates++; },
    };
    const moon = { style: {}, querySelector: () => ({ textContent: "" }) };
    const context = {
      document: { getElementById: id => id === "solar-size-error" ? error : { checked: id === "chk-moon" } },
      moonMarkerEl: moon, planetMarkerEls: {}, PLANETS: {}, angularSizeLocation: null,
      angularSizeLocationError: "Observing location request failed (HTTP 503).", Date,
      getObsTime: () => new Date(date), safeW2P: () => [50, 50], APDSolarSystem: api,
    };
    vm.createContext(context);
    vm.runInContext(pageFunction("updateAngularBodies"), context);
    expect(context.updateAngularBodies([100, 100])).toBeNull();
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain("HTTP 503");
    expect(moon.style.display).toBe("none");
    context.updateAngularBodies([100, 100]);
    expect(alertUpdates).toBe(1);
    context.angularSizeLocation = location;
    context.APDSolarSystem = geometry(null);
    expect(context.updateAngularBodies([100, 100])).toBeNull();
    expect(error.textContent).toContain("did not load");
    context.APDSolarSystem = api;
    expect(context.updateAngularBodies([100, 100])[0].name).toBe("Moon");
    expect(error.hidden).toBe(true);
    expect(moon.style.display).toBe("block");
  });
});
