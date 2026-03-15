#!/usr/bin/env python3
"""
Fetch astronomical catalogs from VizieR (CDS Strasbourg) and convert
to the GeoJSON format used by APD skychart (d3-celestial compatible).

Catalogs:
  SH2  - Sharpless HII regions          (VII/20)
  LBN  - Lynds Bright Nebulae           (VII/9)
  B    - Barnard dark nebulae            (VII/220A)
  LDN  - Lynds Dark Nebulae             (VII/7A)
  vdB  - van den Bergh reflection neb.  (VII/21)
  HCG  - Hickson Compact Groups         (VII/213)
  Abell PNe - Abell Planetary Nebulae   (V/84)

All positions: VizieR computed J2000 (_RAJ2000, _DEJ2000) in degrees.
Output: public/data/celestial/catalogs_extra.json
"""

import json, os, time, re
from urllib.request import urlopen, Request
from urllib.parse import urlencode

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       '..', 'public', 'data', 'celestial')


def vizier_fetch(catalog, columns, max_rows=5000):
    params = {
        '-source': catalog,
        '-out': ','.join(columns),
        '-out.add': '_RAJ,_DEJ',
        '-out.max': str(max_rows),
    }
    url = ('https://vizier.cds.unistra.fr/viz-bin/asu-tsv?'
           + urlencode(params, doseq=True))
    print(f"  Fetching {catalog} ...")
    req = Request(url, headers={'User-Agent': 'APD-Skychart/1.0'})
    with urlopen(req, timeout=90) as resp:
        return resp.read().decode('utf-8', errors='replace')


def parse_vizier_tsv(raw):
    header = None
    rows = []
    past_dashes = False
    for line in raw.splitlines():
        if line.startswith('#') or not line.strip():
            continue
        if line.startswith('---'):
            past_dashes = True
            continue
        parts = line.split('\t')
        if header is None:
            header = [p.strip() for p in parts]
            continue
        if not past_dashes:
            continue
        if len(parts) >= len(header):
            rows.append({header[i]: parts[i].strip()
                         for i in range(len(header))})
    return rows


def ra_to_lon(ra):
    return ra - 360.0 if ra > 180 else ra


def sf(s):
    try:
        return float(s)
    except (ValueError, TypeError):
        return None


def feat(fid, desig, otype, mag, dim, ra, dec):
    return {
        "type": "Feature",
        "id": fid,
        "properties": {
            "desig": desig,
            "type": otype,
            "morph": "",
            "mag": "" if mag is None else str(round(mag, 1)),
            "dim": dim or "",
            "bv": ""
        },
        "geometry": {
            "type": "Point",
            "coordinates": [round(ra_to_lon(ra), 4), round(dec, 4)]
        }
    }


def fetch_sharpless():
    print("SH2 (Sharpless):")
    rows = parse_vizier_tsv(vizier_fetch('VII/20', ['Sh2', 'Diam']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('Sh2', '').strip()
        if not n:
            continue
        out.append(feat(f"SH2-{n}", f"SH2-{n}", 'en', None,
                        r.get('Diam', '').strip(), ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_lbn():
    print("LBN (Lynds Bright Nebulae):")
    rows = parse_vizier_tsv(vizier_fetch('VII/9', ['Seq', 'Area', 'Bright']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('Seq', '').strip()
        if not n:
            continue
        desig = f"LBN {n}"
        area = r.get('Area', '').strip()
        out.append(feat(desig, desig, 'bn', None, area, ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_barnard():
    print("B (Barnard dark nebulae):")
    rows = parse_vizier_tsv(vizier_fetch('VII/220A', ['Barn', 'Diam', 'Opa']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('Barn', '').strip()
        if not n:
            continue
        out.append(feat(f"B {n}", f"B {n}", 'dn', None,
                        r.get('Diam', '').strip(), ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_ldn():
    print("LDN (Lynds Dark Nebulae):")
    rows = parse_vizier_tsv(vizier_fetch('VII/7A', ['LDN', 'Area', 'Opa']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('LDN', '').strip()
        if not n:
            continue
        out.append(feat(f"LDN {n}", f"LDN {n}", 'dn', None,
                        r.get('Area', '').strip(), ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_vdb():
    print("vdB (van den Bergh):")
    rows = parse_vizier_tsv(vizier_fetch('VII/21', ['VdB', 'Vmag', 'Type']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('VdB', '').strip()
        if not n:
            continue
        out.append(feat(f"vdB {n}", f"vdB {n}", 'rn', None, '', ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_hcg():
    print("HCG (Hickson Compact Groups):")
    rows = parse_vizier_tsv(vizier_fetch('VII/213', ['HCG', 'MagT', 'AngSize']))
    out = []
    for r in rows:
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        n = r.get('HCG', '').strip()
        if not n:
            continue
        out.append(feat(f"HCG {n}", f"HCG {n}", 'gg', sf(r.get('MagT', '')),
                        r.get('AngSize', '').strip(), ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def fetch_abell_pn():
    print("Abell PNe (Abell Planetary Nebulae):")
    rows = parse_vizier_tsv(
        vizier_fetch('V/84', ['PNG', 'Name', 'Diam', 'Fmag'], max_rows=10000))
    out = []
    seen = set()
    for r in rows:
        name = r.get('Name', '').strip()
        m = re.search(r'\bA(?:bell)?\s*(\d+)', name)
        if not m:
            continue
        ra, dec = sf(r.get('_RAJ2000')), sf(r.get('_DEJ2000'))
        if ra is None or dec is None:
            continue
        desig = f"Abell {m.group(1)}"
        if desig in seen:
            continue
        seen.add(desig)
        out.append(feat(desig, desig, 'pn', sf(r.get('Fmag', '')),
                        r.get('Diam', '').strip(), ra, dec))
    print(f"  -> {len(out)} objects")
    return out


def main():
    all_features = []
    for fn in [fetch_sharpless, fetch_lbn, fetch_barnard, fetch_ldn,
               fetch_vdb, fetch_hcg, fetch_abell_pn]:
        try:
            all_features.extend(fn())
        except Exception as e:
            print(f"  ERROR: {e}")
            import traceback
            traceback.print_exc()
        time.sleep(1)

    geojson = {"type": "FeatureCollection", "features": all_features}
    os.makedirs(OUT_DIR, exist_ok=True)
    outpath = os.path.join(OUT_DIR, 'catalogs_extra.json')
    with open(outpath, 'w') as f:
        json.dump(geojson, f, separators=(',', ':'))

    print(f"\nWrote {len(all_features)} objects -> {outpath}")
    print(f"File size: {os.path.getsize(outpath) / 1024:.1f} KB")


if __name__ == '__main__':
    main()
