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

function framingScene(initialSize, { mosaic = false, locked = false, rotation = 0 } = {}) {
  const moon = api.calculate("Moon", date, location);
  const scene = { size: initialSize, aperture: 6 };
  // Independent STG projection reference. Aladin's angular aperture spans the
  // longer viewport axis; real browser acceptance checks verify this contract.
  const project = (ra, dec) => {
    const delta = (ra - moon.ra) * radians, d = dec * radians, center = moon.dec * radians;
    const denominator = 1 + Math.sin(center) * Math.sin(d) + Math.cos(center) * Math.cos(d) * Math.cos(delta);
    const x = 2 * Math.cos(d) * Math.sin(delta) / denominator;
    const y = 2 * (Math.cos(center) * Math.sin(d) - Math.sin(center) * Math.cos(d) * Math.cos(delta)) / denominator;
    const span = scene.size[0] >= scene.size[1] ? scene.size[0] : scene.size[1];
    const focalLength = span / (4 * Math.tan(scene.aperture * radians / 4));
    return [scene.size[0] / 2 - x * focalLength, scene.size[1] / 2 - y * focalLength];
  };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: id === "solar-system-size" ? "markers" : id === "mount-select" ? "eq" : String(rotation),
      checked: false, style: {}, classList: { toggle() {} },
    });
    return elements.get(id);
  };
  const tiles = Array.from({ length: 4 }, () => ({ style: {} }));
  const context = {
    document: { getElementById: element }, requestAnimationFrame() {},
    aladin: {
      getRaDec: () => [moon.ra, moon.dec], getSize: () => scene.size,
      getFov: () => [scene.aperture, scene.aperture * scene.size[1] / scene.size[0]],
      world2pix: project,
    },
    getJD: () => 0, getLST: () => 0, getObsTime: () => new Date(date),
    getViewRotation: () => 0, obsLat: location.lat, obsLon: location.lon,
    activeFov: [2, 1], fovLocked: locked, fovLockedRaDec: [moon.ra, moon.dec],
    mosaicActive: mosaic, mosaicCols: 2, mosaicRows: 2, mosaicOverlap: 10, mosaicTileEls: tiles,
    horizonEnabled: false, cardinalsData: [], celestialDataLoaded: false,
    moonMarkerEl: { style: {}, classList: { toggle() {} } }, planetMarkerEls: {}, PLANETS: {},
    drawOverlayCanvas() {},
  };
  vm.createContext(context);
  vm.runInContext(pageFunction("updateMosaicTiles") + "\n" + pageFunction("syncUI"), context);
  return {
    context, scene, tiles, element, render: () => context.syncUI(),
    moonPixelDiameter: () => {
      const xs = moon.outlines[0].map(([ra, dec]) => project(ra, dec)[0]);
      return Math.max(...xs) - Math.min(...xs);
    },
    expectedWidthToMoonRatio: context.activeFov[0] / moon.diameter,
  };
}

describe("camera FOV angular scale across viewport changes", () => {
  it.each([[1200, 800], [800, 1200], [600, 400], [400, 600], [800, 800], [320, 740]])(
    "keeps camera and mosaic footprints proportional to the sky at %i by %i", (width, height) => {
      for (const mosaic of [false, true]) {
        const view = framingScene([width, height], { mosaic, rotation: 30 });
        view.render();
        const box = mosaic ? view.tiles[0] : view.element("camera-fov-box");
        const tileWidth = parseFloat(box.style.width), tileHeight = parseFloat(box.style.height);
        const ratio = tileWidth / view.moonPixelDiameter();
        // Small-field STG curvature and the sampled lunar limb account for less
        // than 0.2%; the reported portrait defect loses tens of percent.
        expect(Math.abs(ratio / view.expectedWidthToMoonRatio - 1)).toBeLessThan(0.002);
        expect(tileWidth / tileHeight).toBeCloseTo(2, 10);
        expect(box.style.transform).toContain("rotate(30deg)");
        if (mosaic) {
          const dx = parseFloat(view.tiles[1].style.left) - parseFloat(view.tiles[0].style.left);
          const dy = parseFloat(view.tiles[1].style.top) - parseFloat(view.tiles[0].style.top);
          expect(Math.hypot(dx, dy) / tileWidth).toBeCloseTo(0.9, 10);
        }
      }
    }
  );

  it("preserves locked framing and saved dimensions through repeated resize and zoom", () => {
    const view = framingScene([1000, 700], { locked: true });
    const original = [...view.context.activeFov];
    for (const [size, aperture] of [[[1000, 700], 6], [[350, 700], 6], [[350, 700], 3], [[1000, 700], 6]]) {
      view.scene.size = size;
      view.scene.aperture = aperture;
      view.render();
      expect(view.context.activeFov).toEqual(original);
      expect(view.element("fov-overlay").style.left).toBe(size[0] / 2 + "px");
      expect(view.element("fov-overlay").style.top).toBe(size[1] / 2 + "px");
      const ratio = parseFloat(view.element("camera-fov-box").style.width) / view.moonPixelDiameter();
      expect(Math.abs(ratio / view.expectedWidthToMoonRatio - 1)).toBeLessThan(0.002);
    }
  });
});

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
  it.each([
    { size: [1000, 1000], aperture: 0.01 },
    { size: [25, 740], aperture: 0.001 },
  ])("keeps a partial lunar limb visible at $aperture degrees with viewport $size", ({ size, aperture }) => {
    const body = api.calculate("Moon", date, location);
    let segments = 0;
    const projectedScale = Math.max(...size) / aperture;
    const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() { segments++; }, stroke() {} };
    const context = {
      document: { getElementById: () => ({ getContext: () => ctx }) },
      aladin: { getFov: () => [aperture, aperture * size[1] / size[0]] }, PLANETS: {},
      safeW2P: (ra, dec) => [(ra - body.outlines[0][0][0]) * projectedScale + size[0] / 2, (body.outlines[0][0][1] - dec) * projectedScale + size[1] / 2],
      pixDist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    };
    vm.createContext(context);
    vm.runInContext(pageFunction("drawAngularBodies"), context);
    context.drawAngularBodies([body], size);
    expect(segments).toBeGreaterThan(0);
  });

  it.each(["created", "alphabetical"])("restores older sky settings and saves %s favourite order under the original storage key", order => {
    const old = { mode: "skychart", chkMoon: true, chkPlanets: true, activeFovId: 17, rotation: "18", lat: "0", lon: "0", centerRA: 12.79, centerDec: 9, viewFov: 1.2 };
    let stored = JSON.stringify(old);
    const elements = new Map();
    const warnings = [];
    const favoriteSelects = { "fav-view": ["night", "season"], "fav-sort": ["ranked", "created", "alphabetical"], "fav-min-alt": ["0", "20", "30", "40", "50", "60"], "fav-min-hours": ["0", "1", "2", "3", "4", "5", "6"] };
    const favoriteDefaults = { "fav-view": "night", "fav-sort": "ranked", "fav-min-alt": "30", "fav-min-hours": "0" };
    const element = id => {
      if (!elements.has(id)) elements.set(id, { value: favoriteDefaults[id] ?? (id === "solar-system-size" ? "markers" : ""), options: (favoriteSelects[id] || []).map(value => ({ value })), checked: false, style: {}, classList: { contains: () => false, toggle() {}, add() {} } });
      return elements.get(id);
    };
    const context = {
      document: { getElementById: element },
      localStorage: { getItem: key => { expect(key).toBe("astro-sky-dashboard-v1"); return stored; }, setItem: (key, value) => { expect(key).toBe("astro-sky-dashboard-v1"); stored = value; } },
      console: { warn: (...args) => warnings.push(args) }, SETTINGS_KEY: "astro-sky-dashboard-v1",
      aladin: { getRaDec: () => [12.79, 9], getFov: () => [1.2, 0.9], gotoRaDec() {}, setFov() {} },
      horizonEnabled: false, activeFovId: 1, selectedFavoriteId: null, fovLocked: false, fovLockedRaDec: null,
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
    expect(element("fav-view").value).toBe("night");
    expect(element("fav-sort").value).toBe("ranked");
    expect(context.selectedFavoriteId).toBeNull();
    expect(element("fav-min-alt").value).toBe("30");
    expect(element("fav-min-hours").value).toBe("0");
    element("solar-system-size").value = "angular";
    element("fav-view").value = "season";
    element("fav-sort").value = order;
    context.selectedFavoriteId = 42;
    element("fav-min-alt").value = "40";
    element("fav-min-hours").value = "2";
    context.saveSettings();
    expect(JSON.parse(stored)).toMatchObject({ solarSystemSize: "angular", chkMoon: true, chkPlanets: true, activeFovId: 17, rotation: "18", lat: "0", lon: "0", viewFov: 1.2, favoriteView: "season", favoriteSort: order, selectedFavoriteId: 42, favoriteMinAlt: "40", favoriteMinHours: "2" });
    element("solar-system-size").value = "markers";
    element("fav-view").value = "night";
    element("fav-sort").value = "ranked";
    context.selectedFavoriteId = null;
    element("fav-min-alt").value = "30";
    element("fav-min-hours").value = "0";
    context.loadAndApplySettings();
    expect(element("solar-system-size").value).toBe("angular");
    expect(element("fav-view").value).toBe("season");
    expect(element("fav-sort").value).toBe(order);
    expect(context.selectedFavoriteId).toBe(42);
    expect(element("fav-min-alt").value).toBe("40");
    expect(element("fav-min-hours").value).toBe("2");
    stored = JSON.stringify({ ...JSON.parse(stored), selectedFavoriteId: null });
    context.loadAndApplySettings();
    expect(context.selectedFavoriteId).toBeNull();
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
