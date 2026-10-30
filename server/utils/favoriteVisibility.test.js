import fs from "node:fs";
import vm from "node:vm";
import * as Astronomy from "astronomy-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = fs.readFileSync(new URL("../../public/skychart.html", import.meta.url), "utf8");
const catalogue = JSON.parse(fs.readFileSync(new URL("../../public/data/celestial/dsos.14.json", import.meta.url), "utf8")).features;
const targets = ["M 42", "M 45"].map((name, index) => {
  const item = catalogue.find(entry => entry.properties.desig === name);
  return { id: index + 1, name, ra: (item.geometry.coordinates[0] + 360) % 360, dec: item.geometry.coordinates[1], rotation: 17, fov: 4 };
});

function pageFunction(name) {
  const match = new RegExp(`^    (?:async )?function ${name}\\(`, "m").exec(html);
  if (!match) throw new Error(`Missing sky-chart function: ${name}`);
  const rest = html.slice(match.index + 1);
  const end = rest.search(/\n    (?:async )?function /);
  return html.slice(match.index, match.index + 1 + end);
}

function scene({ lat = 51.5, lon = -0.13, date = new Date(2026, 9, 29, 12), favorites = targets } = {}) {
  const elements = new Map();
  const node = () => ({
    children: [], listeners: {}, value: "", textContent: "", html: "", collapsed: false, style: {},
    set innerHTML(value) { this.html = value; this.children = []; }, get innerHTML() { return this.html; },
    appendChild(child) { this.children.push(child); }, addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelector() { return this.deleteButton ||= { listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; } }; },
    classList: { contains() { return false; } },
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  element("fav-view").value = "night";
  element("fav-min-alt").value = "30";
  element("fav-min-hours").value = "0";
  element("sp-favorites").classList.contains = () => element("sp-favorites").collapsed;
  const context = vm.createContext({
    Date, Math, setTimeout, clearTimeout,
    document: { getElementById: element, createElement: node },
    obsLat: lat, obsLon: lon, isTimeNow: false, manualTime: date,
    favList: favorites, favoritesLoaded: true, favoritesLoadError: "", favoriteRenderVersion: 0, favoriteSeasonCache: null, favoriteDateKey: "",
    angularSizeLocation: { lat, lon, alt: 0 }, angularSizeLocationError: "", API_BASE: "",
    getTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    goToFavorite: vi.fn(), deleteFavorite: vi.fn(), fetch: vi.fn(),
  });
  const mathStart = html.indexOf("    // ===== ASTRONOMY MATH =====");
  vm.runInContext(html.slice(mathStart, html.indexOf("    function getViewRotation()", mathStart)), context);
  const names = ["formatRA", "formatDec", "favoriteCoordinates", "favoriteNight", "favoriteNightStats", "favoriteMonthStats", "rankFavorites",
    "renderFavoriteSeason", "paintFavoriteCards", "renderFavList", "renderAltCurveSvg", "renderCurveTimeAxis", "fmtHM", "escapeHtml", "loadFavoritesFromServer", "loadSharedLocation"];
  names.forEach(name => vm.runInContext(pageFunction(name), context));
  return { context, element, rows: () => favorites.map((favorite, index) => ({ favorite, index, coordinates: context.favoriteCoordinates(favorite) })) };
}

beforeEach(() => vi.stubEnv("TZ", "Europe/London"));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("favourite astronomical-night geometry", () => {
  it.each([
    ["London", 51.5, -0.13], ["Wellington", -41.29, 174.78], ["Mumbai", 19.08, 72.88], ["Quito", -0.18, -78.47],
  ])("finds %s twilight independently of the browser's timezone", (_name, lat, lon) => {
    const { context } = scene({ lat, lon });
    const date = new Date(2026, 9, 29, 12);
    const intervals = context.favoriteNight(date, lat, lon);
    expect(intervals).toHaveLength(1);
    const start = new Date(Date.UTC(2026, 9, 29, 12) - lon / 360 * 86400000);
    const observer = new Astronomy.Observer(lat, lon, 0);
    const dusk = Astronomy.SearchAltitude("Sun", observer, -1, start, 1, -18);
    const dawn = Astronomy.SearchAltitude("Sun", observer, 1, dusk.date, 1, -18);
    expect(Math.abs(intervals[0].dusk - dusk.date)).toBeLessThan(180000);
    expect(Math.abs(intervals[0].dawn - dawn.date)).toBeLessThan(180000);
    vi.stubEnv("TZ", "Pacific/Auckland");
    expect(context.favoriteNight(new Date(2026, 9, 29, 12), lat, lon)).toEqual(intervals);
  });

  it("distinguishes continuous polar darkness from no astronomical darkness", () => {
    const { context } = scene({ lat: 89, lon: 0 });
    const winter = context.favoriteNight(new Date(2026, 11, 21, 12), 89, 0);
    expect(winter).toHaveLength(1);
    expect(winter[0].dawn - winter[0].dusk).toBe(86400000);
    expect(context.favoriteNightStats({ ra: 0, dec: 89 }, winter, 30).hours).toBeCloseTo(24, 8);
    const summer = context.favoriteNight(new Date(2026, 5, 21, 12), 89, 0);
    expect(summer).toHaveLength(0);
    expect(context.favoriteNightStats({ ra: 0, dec: 89 }, summer, 30)).toMatchObject({ hours: 0, dark: false, peak: null });
  });

  it("retains Discover's original default altitude curve", () => {
    const { context } = scene();
    const originalNight = context.getCachedAstroNight();
    const target = targets[0];
    expect(context.computeAltCurve(target.ra, target.dec)).toEqual(context.computeAltCurve(target.ra, target.dec, 60, originalNight));
  });

  it("uses zero valid coordinates and legacy numeric scalars without converting absent values to zero", () => {
    const { context } = scene();
    expect(context.favoriteCoordinates({ ra: 0, dec: 0 })).toEqual({ ra: 0, dec: 0 });
    expect(context.favoriteCoordinates({ ra: "56.75", dec: "-23.5" })).toEqual({ ra: 56.75, dec: -23.5 });
    for (const invalid of [{ ra: null, dec: 0 }, { ra: "", dec: 0 }, { ra: 360, dec: 0 }, { ra: 10, dec: 91 }]) expect(context.favoriteCoordinates(invalid)).toBeNull();
  });

  it("includes leap day and averages every calendar date", () => {
    const { context, rows } = scene({ lat: 89, lon: 0 });
    context.favoriteNight = vi.fn(context.favoriteNight);
    const february = context.favoriteMonthStats(rows(), 2024, 1, 30);
    expect(context.favoriteNight).toHaveBeenCalledTimes(29);
    expect(context.favoriteNight.mock.calls.at(-1)[0].getDate()).toBe(29);
    expect(february.every(stats => Number.isFinite(stats.hours) && stats.hours >= 0 && stats.hours <= 24)).toBe(true);
    expect(context.favoriteMonthStats(rows(), 2026, 5, 30).every(stats => stats.hours === 0 && !stats.dark)).toBe(true);
  });

  it("ranks by usable hours, then altitude, without changing saved order or hiding invalid records", () => {
    const { context } = scene();
    const rows = Object.freeze([
      { index: 0, stats: { hours: 2, peak: { alt: 50 } } }, { index: 1, stats: { hours: 4, peak: { alt: 30 } } },
      { index: 2, stats: { hours: 2, peak: { alt: 60 } } }, { index: 3, stats: null }, { index: 4, stats: { hours: 0, peak: null } },
    ]);
    expect(context.rankFavorites(rows, 1).map(row => row.index)).toEqual([1, 2, 0, 3]);
    expect(rows.map(row => row.index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("favourite cards, boundaries and preserved actions", () => {
  it("renders local Discover-style night graphs without an astronomy-service request", async () => {
    const { context, element } = scene();
    await context.renderFavList();
    expect(element("fav-list").children).toHaveLength(2);
    expect(element("fav-list").children.every(child => child.className === "discover-card" && child.innerHTML.includes('class="dc-curve"'))).toBe(true);
    expect(element("fav-visibility-status").textContent).toContain("times Europe/London");
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it("passes the complete original favourite to navigation after ranking and preserves delete IDs", async () => {
    const favorite = { ...targets[1], id: "saved-2", rotation: 37, fov: 8, mosaic: { cols: 2, rows: 3, overlap: 10 } };
    const { context, element } = scene({ favorites: [favorite] });
    await context.renderFavList();
    const card = element("fav-list").children[0];
    card.listeners.click({ target: { classList: { contains: () => false } } });
    expect(context.goToFavorite).toHaveBeenCalledWith(favorite);
    card.deleteButton.listeners.click({ stopPropagation() {} });
    expect(context.deleteFavorite).toHaveBeenCalledWith("saved-2");
  });

  it("renders twelve monthly bars and reuses calculation results for duration-only changes", async () => {
    const { context, element } = scene();
    element("fav-view").value = "season";
    context.favoriteMonthStats = vi.fn(context.favoriteMonthStats);
    await context.renderFavList();
    expect(context.favoriteMonthStats).toHaveBeenCalledTimes(12);
    expect(element("fav-list").children[0].innerHTML.match(/<rect /g)).toHaveLength(12);
    expect(element("fav-visibility-status").textContent).toContain("October 2026");
    element("fav-min-hours").value = "1";
    await context.renderFavList();
    expect(context.favoriteMonthStats).toHaveBeenCalledTimes(12);
    expect(context.fetch).not.toHaveBeenCalled();
  });

  it("cannot paint a cancelled seasonal calculation over a newer Night selection", async () => {
    vi.useFakeTimers();
    const { context, element } = scene();
    element("fav-view").value = "season";
    const old = context.renderFavList();
    element("fav-view").value = "night";
    await context.renderFavList();
    await vi.runAllTimersAsync(); await old;
    expect(element("fav-list").children[0].innerHTML).toContain('class="dc-curve"');
    expect(element("fav-list").children[0].innerHTML).not.toContain('class="dc-season"');
  });

  it("updates a live night at midnight while preserving a manually selected date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 29, 23, 59, 59));
    const { context, element } = scene();
    context.isTimeNow = true;
    context.favoriteDateKey = new Date().toDateString();
    context.syncQuickBar = vi.fn();
    context.renderFavList = vi.fn(context.renderFavList);
    vm.runInContext(pageFunction("clockTick"), context);
    context.clockTick();
    expect(context.renderFavList).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 30, 0, 0, 0));
    context.clockTick();
    expect(context.renderFavList).toHaveBeenCalledTimes(1);
    expect(context.favoriteDateKey).toBe(new Date().toDateString());
    expect(element("fav-visibility-status").textContent).toContain(new Date(2026, 9, 30).toLocaleDateString());
    context.isTimeNow = false;
    vi.setSystemTime(new Date(2026, 9, 31, 0, 0, 0));
    context.clockTick();
    expect(context.renderFavList).toHaveBeenCalledTimes(1);
  });

  it("invalidates seasonal results after a successfully loaded observing-location change", async () => {
    const { context, element } = scene();
    element("fav-view").value = "season";
    await context.renderFavList();
    const oldKey = context.favoriteSeasonCache.key;
    context.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lat: -41.29, lon: 174.78, alt: 0 })));
    await context.loadSharedLocation();
    await vi.waitFor(() => expect(context.favoriteSeasonCache.key).not.toBe(oldKey));
    expect(context.favoriteSeasonCache.key).toContain("174.78");
    expect(element("fav-visibility-status").textContent).toContain("monthly averages");
    expect(context.fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a required location error and retains saved navigation without substituting default coordinates", async () => {
    const { context, element } = scene();
    context.angularSizeLocation = null;
    context.angularSizeLocationError = "Observing location request failed (HTTP 503).";
    context.favoriteNight = vi.fn(context.favoriteNight);
    await context.renderFavList();
    expect(element("fav-visibility-status").textContent).toContain("HTTP 503");
    expect(context.favoriteNight).not.toHaveBeenCalled();
    expect(element("fav-list").children).toHaveLength(2);
  });

  it("shows actual favourite-load HTTP errors and recovers through the same loader", async () => {
    const { context, element } = scene();
    context.fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(targets), { headers: { "Content-Type": "application/json" } }));
    await context.loadFavoritesFromServer();
    expect(element("fav-visibility-status").textContent).toBe("Failed to load favourites: HTTP 503");
    await context.loadFavoritesFromServer();
    expect(context.favoritesLoadError).toBe("");
    expect(element("fav-list").children[0].innerHTML).toContain('class="dc-curve"');
  });

  it("recalculates after successful location loading and rejects a malformed location response", async () => {
    const { context, element } = scene();
    context.angularSizeLocation = null;
    context.fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ lat: 51.5, lon: -0.13, alt: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ lat: null, lon: 0 })));
    await context.loadSharedLocation();
    expect(context.angularSizeLocationError).toBe("");
    expect(element("fav-list").children[0].innerHTML).toContain('class="dc-curve"');
    await context.loadSharedLocation();
    expect(element("fav-visibility-status").textContent).toBe("Visibility unavailable: Invalid observing location response.");
  });
});
