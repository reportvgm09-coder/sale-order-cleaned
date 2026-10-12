// Madhya Pradesh map data, and matching a customer's typed city to a place on
// it. The data file is built by scripts/build-mp-map.mjs; it is loaded only by
// the Map page, so nobody else downloads it.
//
// A customer lands on one Census 2011 sub-district (tehsil), and through it on
// a district. Matching goes, in order:
//   1. a place picked by hand for that customer (map_place) - always wins
//   2. the city is a district's name -> the tehsil its headquarters sits in
//      (Katni -> Murwara, Bhopal -> Huzur)
//   3. the city is a tehsil's name, and only one tehsil has it
//   4. a known renaming (Narmadapuram was Hoshangabad)
//   5. a near spelling, or a name two tehsils share -> "check": suggested,
//      never counted until somebody confirms it
// Anything else is "none" and waits for a pick. Only 1-4 and hand-picked
// places count on the map, so a guess can never colour a district.

export const loadMpMap = () => import("@/data/mp-map.json").then((m) => m.default || m);

// Words people add that are not part of the place: "Jabalpur Cantt", "Indore (M.P.)"
const NOISE = /\b(city|cantt|cantonment|town|tehsil|tahsil|district|dist|zila|mp|m\s*p)\b/g;

/** Folds the spellings that differ only in transliteration: Seoni/Sivni, Mhow/Mhou. */
export const norm = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\./g, " ")
    .replace(NOISE, " ")
    .replace(/[^a-z]/g, "")
    // Khargone / Khargaon, Khategaon / Khategone
    .replace(/(gaon|gone)$/, "gon")
    .replace(/ee|ii/g, "i")
    .replace(/oo|uu/g, "u")
    .replace(/aa/g, "a")
    .replace(/w/g, "v")
    .replace(/ph/g, "f")
    .replace(/sh/g, "s")
    .replace(/z/g, "j")
    .replace(/([a-z])\1+/g, "$1");

// Renamed places the 2011 data still has under the old name. Keys are norm()ed.
const RENAMED = {
  narmadapuram: { district: "Hoshangabad" },
  drambedkarnagar: { tehsil: "Mhow" },
  ambedkarnagar: { tehsil: "Mhow" },
  narsimhapur: { district: "Narsinghpur" },
  westnimar: { district: "Khargone" },
  eastnimar: { district: "Khandwa" },
};

const levenshtein = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
};
const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);
const CLOSE = 0.75;

/** Lookups built once from the map file. */
export function buildIndex(map) {
  const byCode = new Map(map.places.map((p) => [p.c, p]));
  const byName = new Map();
  map.places.forEach((p) => {
    const k = norm(p.n);
    byName.set(k, [...(byName.get(k) || []), p]);
  });
  const districts = map.topology.objects.districts.geometries.map((g) => g.properties.district);
  const districtByName = new Map(districts.map((d) => [norm(d), d]));
  return { byCode, byName, districts, districtByName, hq: map.hq, places: map.places };
}

/**
 * Where a customer goes on the map.
 * kind: "set" | "exact" | "alias" | "check" | "none" | "outside"
 * place: the tehsil, for set / exact / alias; options: suggestions, for check
 */
export function matchCustomer(customer, idx) {
  const picked = customer.map_place;
  if (picked === "outside") return { kind: "outside" };
  if (picked && idx.byCode.has(picked)) return { kind: "set", place: idx.byCode.get(picked) };

  const n = norm(customer.city);
  if (!n) return { kind: "none" };

  const district = idx.districtByName.get(n);
  if (district) {
    const place = idx.byCode.get(idx.hq[district]);
    if (place) {
      return norm(place.n) === n
        ? { kind: "exact", place }
        : { kind: "alias", place, why: `${district} town is in ${place.n} tehsil` };
    }
  }

  const named = idx.byName.get(n) || [];
  if (named.length === 1) return { kind: "exact", place: named[0] };
  if (named.length > 1) {
    return { kind: "check", options: named, why: `${named.length} tehsils are called ${named[0].n}` };
  }

  const renamed = RENAMED[n];
  if (renamed) {
    const place = renamed.district
      ? idx.byCode.get(idx.hq[renamed.district])
      : (idx.byName.get(norm(renamed.tehsil)) || [])[0];
    if (place) return { kind: "alias", place, why: `renamed - the map says ${renamed.district || renamed.tehsil}` };
  }

  // Near spellings, best first. Districts count through their headquarters tehsil.
  const scored = [];
  for (const [k, list] of idx.byName) {
    const s = similarity(n, k);
    if (s >= CLOSE) list.forEach((p) => scored.push({ p, s }));
  }
  for (const [k, d] of idx.districtByName) {
    const s = similarity(n, k);
    const p = idx.byCode.get(idx.hq[d]);
    if (s >= CLOSE && p && !scored.some((x) => x.p.c === p.c)) scored.push({ p, s });
  }
  if (scored.length) {
    const options = scored.sort((a, b) => b.s - a.s).slice(0, 3).map((x) => x.p);
    return { kind: "check", options, why: `looks like ${options[0].n}` };
  }
  return { kind: "none" };
}

/** Whether a match is solid enough to put the customer's orders on the map. */
export const counts = (m) => m.kind === "set" || m.kind === "exact" || m.kind === "alias";
