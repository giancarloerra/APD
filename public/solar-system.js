// Angular-size framing geometry. Positions are in the sky survey's J2000 frame.
(function () {
    'use strict';

    // Equatorial radii: https://ssd.jpl.nasa.gov/planets/phys_par.html
    // Polar radii: https://nssdc.gsfc.nasa.gov/planetary/factsheet/
    // The lunar disk follows Horizons' 1737.4 km reference radius.
    const RADII = {
        Moon: [1737.4, 1737.4], Mercury: [2440.53, 2438.3], Venus: [6051.8, 6051.8],
        Mars: [3396.19, 3376.2], Jupiter: [71492, 66854], Saturn: [60268, 54364],
        Uranus: [25559, 24973], Neptune: [24764, 24341]
    };
    // Outer A-ring edge: https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html
    const SATURN_RING_RADIUS_KM = 136780;
    const RAD = Math.PI / 180;

    function dot(a, b) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }

    function ellipse(body, major, minor) {
        const ra = body.ra * RAD, dec = body.dec * RAD, angle = body.poleAngle * RAD;
        const center = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
        const east = [-Math.sin(ra), Math.cos(ra), 0];
        const north = [-Math.sin(dec) * Math.cos(ra), -Math.sin(dec) * Math.sin(ra), Math.cos(dec)];
        const points = [];
        for (let i = 0; i <= 128; i++) {
            const phase = i * 2 * Math.PI / 128;
            const x = major * Math.cos(phase), y = minor * Math.sin(phase);
            const e = x * Math.cos(angle) + y * Math.sin(angle);
            const n = -x * Math.sin(angle) + y * Math.cos(angle);
            const distance = Math.hypot(e, n);
            const rho = distance * RAD;
            const vector = center.map((value, axis) => value * Math.cos(rho) +
                (distance === 0 ? 0 : (east[axis] * e + north[axis] * n) / distance * Math.sin(rho)));
            points.push([(Math.atan2(vector[1], vector[0]) / RAD + 360) % 360,
                Math.asin(Math.max(-1, Math.min(1, vector[2]))) / RAD]);
        }
        return points;
    }

    function calculate(name, date, location) {
        const engine = globalThis.Astronomy;
        if (!engine) throw new Error('Astronomy calculation library did not load. Reload the sky chart.');
        if (!Object.prototype.hasOwnProperty.call(RADII, name)) throw new Error('Unsupported solar-system body.');
        const time = new Date(date);
        if (!Number.isFinite(time.getTime())) throw new Error('Invalid observing time.');
        if (!location || !Number.isFinite(location.lat) || Math.abs(location.lat) > 90 ||
            !Number.isFinite(location.lon) || Math.abs(location.lon) > 180 || !Number.isFinite(location.alt)) {
            throw new Error('A valid observing latitude, longitude and elevation are required.');
        }
        const observer = new engine.Observer(location.lat, location.lon, location.alt);
        // J2000 astrometric coordinates match the background surveys. Equator includes
        // light travel time and observer parallax; of-date coordinates would drift off the map.
        const position = engine.Equator(name, time, observer, false, false);
        const distance = position.dist * engine.KM_PER_AU;
        const [equatorial, polar] = RADII[name];
        if (!Number.isFinite(distance) || distance <= equatorial) throw new Error('Invalid observer-to-body distance.');
        const axis = engine.RotationAxis(name, time).north;
        const ra = position.ra * 15, dec = position.dec;
        const r = ra * RAD, d = dec * RAD;
        const center = [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
        const east = [-Math.sin(r), Math.cos(r), 0];
        const north = [-Math.sin(d) * Math.cos(r), -Math.sin(d) * Math.sin(r), Math.cos(d)];
        const pole = [axis.x, axis.y, axis.z];
        const sineOpening = Math.max(-1, Math.min(1, -dot(pole, center)));
        const projectedPolar = equatorial * Math.sqrt(sineOpening ** 2 +
            (polar / equatorial) ** 2 * (1 - sineOpening ** 2));
        const body = {
            name, ra, dec, distanceAU: position.dist,
            diameter: 2 * Math.asin(equatorial / distance) / RAD,
            minorDiameter: 2 * Math.asin(projectedPolar / distance) / RAD,
            poleAngle: (Math.atan2(dot(pole, east), dot(pole, north)) / RAD + 360) % 360,
            ringOpening: Math.asin(sineOpening) / RAD,
            outlines: []
        };
        body.outlines.push(ellipse(body, body.diameter / 2, body.minorDiameter / 2));
        if (name === 'Saturn') {
            body.ringDiameter = 2 * Math.asin(SATURN_RING_RADIUS_KM / distance) / RAD;
            const minor = 2 * Math.asin(SATURN_RING_RADIUS_KM * Math.abs(sineOpening) / distance) / RAD;
            body.outlines.push(ellipse(body, body.ringDiameter / 2, minor / 2));
        }
        return body;
    }

    function formatDiameter(degrees) {
        const arcseconds = degrees * 3600;
        if (arcseconds < 60) return arcseconds.toFixed(1) + '″';
        if (arcseconds < 3600) return (arcseconds / 60).toFixed(1) + '′';
        return degrees.toFixed(2) + '°';
    }

    globalThis.APDSolarSystem = { calculate, formatDiameter };
})();
