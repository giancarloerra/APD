import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const html = fs.readFileSync(new URL("../../public/skychart.html", import.meta.url), "utf8");
function implementation(name) {
  const start = html.indexOf(`    function ${name}(`);
  const end = html.indexOf("\n    function ", start + 1);
  if (start < 0 || end < 0) throw new Error(`Missing sky-chart implementation: ${name}`);
  return html.slice(start, end);
}
function load(names, context) {
  return vm.runInNewContext(names.map(implementation).join("\n") + `\n({${names.join(",")}})`, context);
}

describe("sky-chart HTML security boundaries", () => {
  it("escapes markup, both quote types and entity encodings without losing ordinary names", () => {
    const { escapeHtml } = load(["escapeHtml"], {});
    expect(escapeHtml('Camera <svg onload="x"> & O\'Brien')).toBe("Camera &lt;svg onload=&quot;x&quot;&gt; &amp; O&#39;Brien");
    expect(escapeHtml("&#34; onload=alert(1)")).toBe("&amp;#34; onload=alert(1)");
    expect(escapeHtml("M31 – Wide 2.13°")).toBe("M31 – Wide 2.13°");
  });

  it("protects persisted FOV/favourite names and sibling fields at the HTML sink", () => {
    const elements = { "fov-list": [], "fav-list": [] };
    const context = {
      document: {
        getElementById: id => ({ set innerHTML(_value) {}, appendChild: node => elements[id].push(node.innerHTML) }),
        createElement: () => ({ innerHTML: "", addEventListener() {}, querySelector: () => ({ addEventListener() {} }) }),
      },
      activeFovId: 1,
      fovList: [{ id: '" onmouseover="x', name: '<svg onload="x">', width: '<img src=x>', height: 1.2 }],
      favList: [{ id: '" onclick="x', name: '<img src=x onerror="x">', ra: 10, dec: 20, rotation: '<svg>', mosaic: { cols: '<img>', rows: 2 } }],
    };
    const functions = load(["escapeHtml", "renderFovList", "paintFavoriteCards", "formatRA", "formatDec"], context);
    functions.renderFovList();
    functions.paintFavoriteCards(context.favList.map((favorite, index) => ({ favorite, index, coordinates: { ra: favorite.ra, dec: favorite.dec }, stats: null })), "night", 30, null);
    const rendered = [...elements["fov-list"], ...elements["fav-list"]].join("");
    expect(rendered).not.toMatch(/<(?:svg|img)\b/);
    expect(rendered).not.toMatch(/" on(?:mouseover|click)="x/);
    expect(rendered).toContain('class="fov-dims"');
    expect(rendered).toContain('class="dc-name"');
    expect(rendered).toContain('class="dc-meta"');
    expect(rendered).toContain("&lt;svg");
  });

  it("protects Discover names, attributes and image URLs while retaining the original card structure", () => {
    const { renderDiscoverCard } = load(["escapeHtml", "renderDiscoverCard"], { getVisibilityFilter: () => ({ minAlt: 0 }), renderAltCurveSvg: () => "" });
    const rendered = renderDiscoverCard({ name: 'M31" onmouseover="x', thumbnail: 'https://images.example.invalid/a.jpg" onload="x', notes: '<svg onload="x">', ra: 10, dec: 20 });
    expect(rendered).toContain('class="discover-card"');
    expect(rendered).toContain('data-name="M31&quot; onmouseover=&quot;x"');
    expect(rendered).not.toContain('" onmouseover="x');
    expect(rendered).not.toContain('" onload="x');
    expect(rendered).not.toContain('<svg onload=');
  });

  it("treats upstream solar-time values as text, retaining legitimate HH:MM output", () => {
    const { renderSolarTimes } = load(["escapeHtml", "fmtTime", "renderSolarTimes"], {});
    const container = { innerHTML: "" };
    renderSolarTimes({ sun: { set: '<img src=x onerror="x">', rise: "06:30" }, moon: { rise: "02:00" } }, container);
    expect(container.innerHTML).not.toContain('<img');
    expect(container.innerHTML).toContain('&lt;img');
    expect(container.innerHTML).toContain('class="st-val">06:30</span>');
    expect(container.innerHTML).toContain('class="st-val">02:00</span>');
  });
});
