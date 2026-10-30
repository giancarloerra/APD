import fs from "node:fs";

export const SKY_SURVEYS = JSON.parse(fs.readFileSync(new URL("../../public/data/sky-surveys.json", import.meta.url), "utf8"));
const RESOLVERS = [
  { url: "https://cds.unistra.fr/cgi-bin/nph-sesame/-o/SVNI?", format: "sesame" },
  { url: "https://vizier.cfa.harvard.edu/viz-bin/nph-sesame/-o/SVNI?", format: "sesame" },
  { url: "https://simbad.cfa.harvard.edu/simbad/sim-id?output.format=ASCII&NbIdent=1&Ident=", format: "simbad" },
  { url: "https://mastresolver.stsci.edu/Santa-war/query?outputFormat=JSON&useCache=false&resolver=Coordinates&resolver=TIC&resolver=KEPLER&resolver=K2&resolver=DADS&resolver=EXO&resolver=SimbadCFA&resolver=NED&name=", format: "santa" },
  { url: "https://heasarc.gsfc.nasa.gov/cgi-bin/Tools/convcoord/convcoord.pl?CoordType=J2000&Output=Batch&CoordVal=", format: "heasarc" },
];
const RESOURCE_PATH = /^(?:properties|Moc\.fits|Norder\d+\/(?:Allsky|Dir\d+\/Npix\d+(?:_\d+)?)\.(?:jpg|png|webp|fits))$/;

export class SkyServiceError extends Error {
  constructor(message, code, attempts = [], status = 503) {
    super(message);
    this.name = "SkyServiceError";
    this.code = code;
    this.attempts = attempts;
    this.status = status;
  }
}

export function parseSkyProperties(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith("#")).map(line => {
    const index = line.indexOf("=");
    return index < 0 ? [] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }).filter(pair => pair.length === 2));
}

function validateResource(body, resource, survey) {
  if (resource === "properties") {
    const properties = parseSkyProperties(body.toString("utf8"));
    const order = Number(properties.hips_order), width = Number(properties.hips_tile_width || 512);
    if (properties.creator_did !== survey.creatorId || !["equatorial", "galactic", "ecliptic"].includes(properties.hips_frame)
      || !Number.isInteger(order) || order < 0 || order > 29 || !Number.isInteger(width) || width < 1 || !properties.hips_tile_format) {
      throw new SkyServiceError("Invalid or mismatched survey metadata", "invalid_metadata");
    }
    return "text/plain; charset=utf-8";
  }
  const extension = resource.split(".").at(-1);
  const valid = extension === "jpg" ? body[0] === 255 && body[1] === 216 && body[2] === 255
    : extension === "png" ? body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : extension === "webp" ? body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP"
        : body.toString("ascii", 0, 9) === "SIMPLE  =";
  if (!valid) throw new SkyServiceError("Invalid survey image response", "invalid_resource");
  return extension === "fits" ? "application/fits" : `image/${extension === "jpg" ? "jpeg" : extension}`;
}

function parseNamePosition(body, format) {
  const text = body.toString("utf8");
  if (format === "santa") {
    let result;
    try { result = JSON.parse(text); }
    catch { throw new SkyServiceError("Invalid name resolver JSON response", "invalid_response"); }
    if (!Array.isArray(result?.resolvedCoordinate)) throw new SkyServiceError("Invalid name resolver response", "invalid_response");
    if (!result.resolvedCoordinate.length) {
      throw new SkyServiceError(result.status ? "Name resolver reported an upstream failure" : "No position returned for this name",
        result.status ? "resolver_error" : "name_not_found", [], result.status ? 503 : 404);
    }
    if (result.resolvedCoordinate.length !== 1) throw new SkyServiceError("Name resolver returned multiple positions", "ambiguous_name", [], 404);
    const item = result.resolvedCoordinate[0];
    return [item?.ra, item?.decl];
  }
  if (format === "simbad") {
    const match = text.match(/^Coordinates\(ICRS,ep=J2000,eq=2000\):\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([+-])(\d+)\s+(\d+)\s+([\d.]+)/m);
    if (match) {
      const [, h, m, s, sign, d, dm, ds] = match;
      if (+h >= 24 || +m >= 60 || +s >= 60 || +dm >= 60 || +ds >= 60) {
        throw new SkyServiceError("Invalid name resolver coordinates", "invalid_response");
      }
      return [(+h + +m / 60 + +s / 3600) * 15, (sign === "-" ? -1 : 1) * (+d + +dm / 60 + +ds / 3600)];
    }
    if (!/Identifier not found|No known catalog could be found/i.test(text)) throw new SkyServiceError("Invalid SIMBAD coordinate response", "invalid_response");
  } else if (format === "heasarc") {
    const fields = text.split(/\r?\n/).map(line => line.trim().split("|").map(value => value.trim()))
      .find(values => values.length === 8 && values.every(value => /^[+-]?\d+(?:\.\d*)?$/.test(value)));
    if (fields) return fields.slice(0, 2).map(Number);
    if (text.trim()) throw new SkyServiceError("Invalid HEASARC coordinate response", "invalid_response");
  } else {
    const match = text.match(/^%J\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)/m);
    if (match) return match.slice(1, 3).map(Number);
  }
  throw new SkyServiceError("No position returned for this name", "name_not_found", [], 404);
}

// The same fixed registry is used for metadata and tiles. No caller supplies an
// upstream URL, and a mirror always serves the selected dataset's creator ID.
export function createSkySurveyService({ surveys = SKY_SURVEYS, fetchImpl = fetch, timeoutMs = 6000, resolverTimeoutMs = 25000 } = {}) {
  const states = new Map();
  const generations = new Map();
  const findSurvey = key => {
    const survey = surveys.find(item => item.key === key);
    if (!survey) throw new SkyServiceError("Unknown sky survey", "unknown_survey", [], 404);
    return survey;
  };
  const stateFor = key => {
    if (!states.has(key)) states.set(key, { state: "loading", mirror: null, attempts: [], resource: null });
    return states.get(key);
  };
  const request = async (url, signal, deadlineMs = timeoutMs) => {
    const timeout = AbortSignal.timeout(deadlineMs);
    const response = await fetchImpl(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      redirect: "error",
      headers: { "User-Agent": "APD (+https://github.com/giancarloerra/apd)" },
    });
    if (!response.ok) throw new SkyServiceError(`HTTP ${response.status}`, "http_error", [], response.status);
    return Buffer.from(await response.arrayBuffer());
  };
  const failure = (url, error, deadlineMs = timeoutMs) => ({
    host: new URL(url).host,
    code: error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : error.code || error.cause?.code || "connection_error",
    message: error.name === "TimeoutError" || error.name === "AbortError" ? `Timed out after ${deadlineMs / 1000}s`
      : error instanceof SkyServiceError ? error.message
        : typeof error.cause?.code === "string" && /^[A-Z_]+$/.test(error.cause.code) ? `Connection failed (${error.cause.code})` : "Connection failed",
    ...(error instanceof SkyServiceError && error.code === "http_error" ? { status: error.status } : {}),
  });

  return {
    status(key) {
      findSurvey(key);
      return { ...stateFor(key) };
    },
    async resource(key, resource, signal) {
      const survey = findSurvey(key);
      if (!RESOURCE_PATH.test(resource)) throw new SkyServiceError("Unsupported survey resource", "invalid_resource_path", [], 400);
      const state = stateFor(key);
      if (resource !== "properties" && state.state === "unavailable") {
        throw new SkyServiceError("All survey mirrors are unavailable", "mirrors_unavailable", state.attempts);
      }
      const generation = (generations.get(key) || 0) + (resource === "properties" ? 1 : 0);
      generations.set(key, generation);
      const roots = state.mirror ? [state.mirror, ...survey.mirrors.filter(root => root !== state.mirror)] : survey.mirrors;
      const attempts = [];
      for (const root of roots) {
        signal?.throwIfAborted();
        try {
          if (resource !== "properties" && root !== state.mirror) {
            const metadata = await request(`${root.replace(/\/$/, "")}/properties`, signal);
            validateResource(metadata, "properties", survey);
          }
          const body = await request(`${root.replace(/\/$/, "")}/${resource}`, signal);
          const contentType = validateResource(body, resource, survey);
          if (resource !== "Moc.fits" && generations.get(key) === generation) Object.assign(state, {
            state: resource === "properties" ? "loading" : "ready", mirror: root,
            attempts: attempts.length || state.mirror !== root ? attempts : state.attempts, resource,
          });
          return { body, contentType, mirror: root, attempts };
        } catch (error) {
          signal?.throwIfAborted();
          attempts.push(failure(root, error));
        }
      }
      // HiPS footprints and partial surveys can legitimately have no image for
      // a sky cell. Preserve that 404 instead of declaring the service down.
      const missing = resource === "properties" ? attempts.every(attempt => attempt.status === 404)
        : attempts.some(attempt => attempt.status === 404);
      if (missing && resource !== "properties" && resource !== "Moc.fits" && generations.get(key) === generation && state.state !== "ready") {
        Object.assign(state, { state: "no_coverage", attempts, resource });
      }
      if (resource !== "Moc.fits" && generations.get(key) === generation && (resource === "properties" || !missing)) {
        Object.assign(state, { state: "unavailable", mirror: null, attempts, resource });
      }
      throw new SkyServiceError(missing ? resource === "properties" ? "Survey metadata was not found on any registered mirror"
        : "No survey image returned for this sky position" : "All survey mirrors are unavailable",
        missing ? "resource_not_found" : "mirrors_unavailable", attempts, missing ? 404 : 503);
    },
    async resolve(name, signal) {
      if (typeof name !== "string" || !name.trim() || name.length > 160 || /[\x00-\x1f]/.test(name)) {
        throw new SkyServiceError("Enter an astronomical object name", "invalid_name", [], 400);
      }
      const attempts = [];
      for (const resolver of RESOLVERS) {
        signal?.throwIfAborted();
        const deadlineMs = resolver.format === "sesame" ? timeoutMs : resolverTimeoutMs;
        try {
          const body = await request(resolver.url + encodeURIComponent(name.trim()), signal, deadlineMs);
          const [ra, dec] = parseNamePosition(body, resolver.format);
          if (typeof ra !== "number" || typeof dec !== "number" || !Number.isFinite(ra) || !Number.isFinite(dec)
            || ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
            throw new SkyServiceError("Invalid name resolver coordinates", "invalid_response");
          }
          return { ra, dec, source: new URL(resolver.url).host, attempts };
        } catch (error) {
          signal?.throwIfAborted();
          attempts.push(failure(resolver.url, error, deadlineMs));
        }
      }
      const missing = attempts.every(attempt => attempt.code === "name_not_found");
      throw new SkyServiceError(missing ? "Object name was not found" : "Online name resolvers are unavailable",
        missing ? "name_not_found" : "resolvers_unavailable", attempts, missing ? 404 : 503);
    },
  };
}
