// Builds src/data/mp-map.json - the Madhya Pradesh map the Map page draws and
// matches customer cities against. Run it only to refresh the map data:
//
//   node scripts/build-mp-map.mjs <folder with the three source files>
//
// Sources (public, open data):
//   districts.topo.json  district outlines, 52 districts
//     https://cdn.jsdelivr.net/gh/udit-001/india-maps-data@main/topojson/states/madhya-pradesh.json
//   subdist_hq.geojson   every sub-district (tehsil) headquarters, Census 2011
//     https://cdn.jsdelivr.net/gh/datta07/INDIAN-SHAPEFILES@master/STATES/MADHYA%20PRADESH/MADHYA%20PRADESH%20Sub%20District%20Hq.geojson
//   dist_hq.geojson      every district headquarters, Census 2011
//     https://cdn.jsdelivr.net/gh/datta07/INDIAN-SHAPEFILES@master/STATES/MADHYA%20PRADESH/MADHYA%20PRADESH%20District%20Hq.geojson
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { geoContains, geoDistance, geoCentroid } from "d3-geo";
import { feature } from "topojson-client";

const src = process.argv[2];
if (!src) {
  console.error("Give the folder holding districts.topo.json, subdist_hq.geojson and dist_hq.geojson");
  process.exit(1);
}
const read = (f) => JSON.parse(readFileSync(join(src, f), "utf8"));
const topo = read("districts.topo.json");
const tehsilHq = read("subdist_hq.geojson").features;
const districtHq = read("dist_hq.geojson").features;

const districts = feature(topo, topo.objects.districts).features;
const names = districts.map((d) => d.properties.district);

// Which outline a point falls in. The Census lists tehsils under the 2011
// districts, so going by position is what puts Agar Malwa's and Niwari's
// tehsils (both districts formed later) under the right district.
const nearestDistrict = (pt) => {
  const inside = districts.find((d) => geoContains(d, pt));
  if (inside) return { name: inside.properties.district, exact: true };
  // a few headquarters sit a hair outside a simplified border
  let best = null;
  for (const d of districts) {
    const dist = geoDistance(pt, geoCentroid(d));
    if (!best || dist < best.dist) best = { name: d.properties.district, dist };
  }
  return { name: best.name, exact: false };
};

const places = [];
const moved = [];
const outside = [];
for (const f of tehsilHq) {
  const p = f.properties;
  const pt = f.geometry.coordinates;
  const where = nearestDistrict(pt);
  if (!where.exact) outside.push(`${p.LOC_NAME} -> ${where.name}`);
  if (where.name !== p.dtname) moved.push(`${p.LOC_NAME}: ${p.dtname} -> ${where.name}`);
  places.push({ c: p.SDTCODE11, n: p.LOC_NAME.trim(), d: where.name, x: +pt[0].toFixed(4), y: +pt[1].toFixed(4) });
}
places.sort((a, b) => a.d.localeCompare(b.d) || a.n.localeCompare(b.n));

// The tehsil each district's headquarters town sits in - the town is called
// after the district, but its tehsil often is not (Katni is in Murwara,
// Bhopal in Huzur). Nearest tehsil headquarters within the same district.
const hq = {};
for (const f of districtHq) {
  const pt = f.geometry.coordinates;
  const d = nearestDistrict(pt).name;
  let best = null;
  for (const t of places.filter((t) => t.d === d)) {
    const dist = geoDistance(pt, [t.x, t.y]);
    if (!best || dist < best.dist) best = { c: t.c, dist };
  }
  if (best) hq[d] = best.c;
}
// Districts formed after 2011 have no Census headquarters: use the tehsil of
// the same name (Agar for Agar Malwa, Niwari for Niwari).
for (const d of names) {
  if (hq[d]) continue;
  const own = places.find((t) => t.d === d && d.toLowerCase().startsWith(t.n.toLowerCase()));
  if (own) hq[d] = own.c;
}

// Keep only the district name on each outline - the rest is never read.
for (const g of topo.objects.districts.geometries) g.properties = { district: g.properties.district };

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "mp-map.json");
writeFileSync(out, JSON.stringify({ topology: topo, places, hq }));

console.log(`${places.length} tehsils, ${names.length} districts -> ${out}`);
console.log(`districts without a headquarters tehsil: ${names.filter((d) => !hq[d]).join(", ") || "none"}`);
console.log(`tehsils with no district they sit in (nearest used): ${outside.length}\n  ${outside.join("\n  ")}`);
console.log(`tehsils moved from their 2011 district: ${moved.length}\n  ${moved.join("\n  ")}`);
