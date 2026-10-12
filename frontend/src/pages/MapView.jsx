import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { api, apiErr } from "@/lib/api";
import { num } from "@/lib/format";
import { loadMpMap, buildIndex, matchCustomer, counts } from "@/lib/mpMap";
import { useAuth } from "@/context/Auth";
import { MasterPicker } from "@/components/FastOrderEntry";
import { Loader } from "@/components/Loader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CircleCheck, ArrowRightLeft, CircleAlert, CircleHelp, MapPinOff, ArrowRight, RotateCcw, MapPin } from "lucide-react";

// Districts coloured by pieces ordered: the top third of districts that have
// any orders green, the middle yellow, the bottom red, none at all grey.
// Pieces, never money, so the same map serves every login. A salesman's
// /sale-orders is already only his own, so his map is too.
const FILL = { g: "#639922", y: "#EF9F27", r: "#E24B4A", none: "#D3D1C7" };
const BAND_LABEL = { g: "Strong · top third", y: "Middle third", r: "Weak · bottom third", none: "No orders" };
const W = 600;
const H = 520;

// Same interpolation as d3.quantile, so the cut-offs match the mockup.
const quantile = (sorted, q) => {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

const KIND = {
  set: { label: "Picked", icon: MapPin, cls: "text-primary" },
  exact: { label: "Exact", icon: CircleCheck, cls: "text-emerald-700" },
  alias: { label: "Known name", icon: ArrowRightLeft, cls: "text-blue-700" },
  check: { label: "Check", icon: CircleAlert, cls: "text-amber-700" },
  none: { label: "Not found", icon: CircleHelp, cls: "text-destructive" },
  outside: { label: "Outside MP", icon: MapPinOff, cls: "text-muted-foreground" },
};
// Problems first - they are the reason anybody opens this list.
const KIND_ORDER = { check: 0, none: 1, outside: 2, set: 3, alias: 4, exact: 5 };

export default function MapView() {
  const { canEdit, isSalesman } = useAuth();
  const [mapData, setMapData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ season: "all", event: "all", start: "", end: "", skipCancelled: true });
  const [pinned, setPinned] = useState(null);
  const [hover, setHover] = useState(null); // { name, x, y }
  const [showMatched, setShowMatched] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [m, o, c, s] = await Promise.all([
          loadMpMap(),
          api.listSaleOrders(),
          api.listMasters("customers"),
          api.listMasters("seasons"),
        ]);
        setMapData(m);
        setOrders(o);
        setCustomers(c);
        setSeasons(s);
      } catch (e) {
        toast.error(apiErr(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const idx = useMemo(() => (mapData ? buildIndex(mapData) : null), [mapData]);

  const shapes = useMemo(() => {
    if (!mapData) return [];
    const fc = feature(mapData.topology, mapData.topology.objects.districts);
    const path = geoPath(geoMercator().fitSize([W, H], fc));
    return fc.features.map((ft) => ({ name: ft.properties.district, d: path(ft), at: path.centroid(ft) }));
  }, [mapData]);

  const matchOf = useMemo(() => {
    const out = new Map();
    if (idx) customers.forEach((c) => out.set(c.id, matchCustomer(c, idx)));
    return out;
  }, [customers, idx]);

  const shown = useMemo(
    () =>
      orders.filter((o) => {
        const d = o.order_date || "";
        if (f.start && d < f.start) return false;
        if (f.end && d > f.end) return false;
        if (f.season !== "all" && o.season_id !== f.season) return false;
        if (f.event !== "all" && o.event_type !== f.event) return false;
        if (f.skipCancelled && o.state === "cancelled") return false;
        return true;
      }),
    [orders, f]
  );

  // district -> { pcs, orders:Set, subs: { tehsil: pcs } }, plus what could not be placed
  const agg = useMemo(() => {
    const byDistrict = {};
    const unplaced = { pcs: 0, customers: new Set() };
    for (const o of shown) {
      const pcs = Number(o.totals?.ordered_qty) || 0;
      const m = matchOf.get(o.customer_id);
      if (!m || !counts(m)) {
        if (m?.kind !== "outside") {
          unplaced.pcs += pcs;
          unplaced.customers.add(o.customer_id);
        }
        continue;
      }
      const g = (byDistrict[m.place.d] ||= { pcs: 0, orders: new Set(), subs: {} });
      g.pcs += pcs;
      g.orders.add(o.id);
      g.subs[m.place.n] = (g.subs[m.place.n] || 0) + pcs;
    }
    return { byDistrict, unplaced };
  }, [shown, matchOf]);

  const cut = useMemo(() => {
    const vals = Object.values(agg.byDistrict).map((g) => g.pcs).filter((v) => v > 0).sort((a, b) => a - b);
    return { t1: quantile(vals, 1 / 3), t2: quantile(vals, 2 / 3) };
  }, [agg]);
  const band = (pcs) => (!pcs ? "none" : pcs >= cut.t2 ? "g" : pcs >= cut.t1 ? "y" : "r");

  const bandCounts = useMemo(() => {
    const c = { g: 0, y: 0, r: 0, none: 0 };
    shapes.forEach((s) => c[band(agg.byDistrict[s.name]?.pcs)]++);
    return c;
  }, [shapes, agg, cut]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open on the strongest district, so the side panel is never empty.
  const strongest = useMemo(
    () => Object.entries(agg.byDistrict).sort((a, b) => b[1].pcs - a[1].pcs)[0]?.[0] || null,
    [agg]
  );
  const focus = pinned || strongest;

  // customers with any order at all, so the list does not jump with the filters
  const toMatch = useMemo(() => {
    const ids = new Set(orders.map((o) => o.customer_id));
    return customers
      .filter((c) => ids.has(c.id))
      .map((c) => ({ c, m: matchOf.get(c.id) || { kind: "none" } }))
      .sort((a, b) => KIND_ORDER[a.m.kind] - KIND_ORDER[b.m.kind] || (a.c.city || "").localeCompare(b.c.city || ""));
  }, [orders, customers, matchOf]);
  const problems = toMatch.filter((x) => x.m.kind === "check" || x.m.kind === "none");
  const settled = toMatch.filter((x) => !(x.m.kind === "check" || x.m.kind === "none"));

  const placeItems = useMemo(
    () => (idx ? idx.places.map((p) => ({ id: p.c, name: p.n, district: p.d })) : []),
    [idx]
  );

  const setPlace = async (customer, place) => {
    try {
      await api.setCustomerMapPlace(customer.id, place);
      setCustomers((list) => list.map((c) => (c.id === customer.id ? { ...c, map_place: place } : c)));
      toast.success(
        place === null
          ? `${customer.name} will be matched by city again`
          : place === "outside"
            ? `${customer.name} left off the map`
            : `${customer.name} placed`
      );
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  if (loading) return <Loader label="Loading map…" />;
  if (!mapData) return <div className="p-8 text-center text-sm text-muted-foreground">The map could not load. Refresh to try again.</div>;

  const SubList = ({ name, max }) => {
    const g = agg.byDistrict[name];
    if (!g) return <p className="mt-2 text-sm text-muted-foreground">No orders from here yet.</p>;
    const rows = Object.entries(g.subs).sort((a, b) => b[1] - a[1]);
    const top = rows[0][1] || 1;
    const list = max ? rows.slice(0, max) : rows;
    return (
      <div className="mt-2 space-y-1.5 border-l-2 border-border pl-3">
        {list.map(([sub, pcs]) => (
          <div key={sub} data-testid={`map-sub-${sub}`}>
            <div className="flex justify-between gap-2 text-sm">
              <span>{sub}</span>
              <span className="whitespace-nowrap tabular-nums text-muted-foreground">{num(pcs)} pcs</span>
            </div>
            <div className="mt-0.5 h-1 rounded-full bg-secondary">
              <div className="h-1 rounded-full" style={{ width: `${Math.round((pcs / top) * 100)}%`, background: FILL[band(g.pcs)] }} />
            </div>
          </div>
        ))}
        {max && rows.length > max && <p className="text-xs text-muted-foreground">+{rows.length - max} more</p>}
      </div>
    );
  };

  const Head = ({ name }) => {
    const g = agg.byDistrict[name];
    return (
      <>
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-base font-bold">{name}</span>
          {g && <span className="font-semibold tabular-nums">{num(g.pcs)} pcs</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          District · {BAND_LABEL[band(g?.pcs)]}
          {g ? ` · ${num(g.orders.size)} order${g.orders.size === 1 ? "" : "s"} · ${Object.keys(g.subs).length} sub-district${Object.keys(g.subs).length === 1 ? "" : "s"}` : ""}
        </p>
      </>
    );
  };

  const onMove = (e, name) => {
    // A touch is a tap - the panel beside the map shows it instead.
    if (e.pointerType && e.pointerType !== "mouse") return;
    const box = boxRef.current.getBoundingClientRect();
    let x = e.clientX - box.left + 14;
    let y = e.clientY - box.top + 14;
    if (x > box.width - 240) x -= 254;
    if (y > box.height - 170) y -= 180;
    setHover({ name, x, y });
  };

  return (
    <div className="space-y-5" data-testid="map-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Map</h1>
        <p className="text-sm text-muted-foreground">
          {isSalesman ? "Your orders" : "Orders"} by district of Madhya Pradesh, in pieces. Hover over a district, or tap it, to see its sub-districts.
        </p>
      </div>

      <Card className="rounded-sm border-border p-4 shadow-none">
        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 md:grid-cols-4">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Season</Label>
            <Select value={f.season} onValueChange={(v) => setF({ ...f, season: v })}>
              <SelectTrigger data-testid="map-season" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All seasons</SelectItem>
                {seasons.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Taken</Label>
            <Select value={f.event} onValueChange={(v) => setF({ ...f, event: v })}>
              <SelectTrigger data-testid="map-event" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Anywhere</SelectItem>
                <SelectItem value="exhibition">At exhibitions</SelectItem>
                <SelectItem value="door_to_door">Door to door</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">From</Label>
            <Input data-testid="map-start" type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className="mt-1 h-9 rounded-sm" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">To</Label>
            <Input data-testid="map-end" type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className="mt-1 h-9 rounded-sm" />
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Checkbox data-testid="map-skip-cancelled" checked={f.skipCancelled} onCheckedChange={(v) => setF({ ...f, skipCancelled: !!v })} />
          Leave out cancelled orders
        </label>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["g", "Strong districts"], ["y", "Middle"], ["r", "Weak"], ["none", "No orders"]].map(([k, l]) => (
          <Card key={k} data-testid={`map-count-${k}`} className="rounded-sm border-border px-3 py-2 shadow-none">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FILL[k] }} /> {l}
            </div>
            <div className="font-display text-xl font-extrabold tabular-nums">{bandCounts[k]}</div>
          </Card>
        ))}
      </div>

      {agg.unplaced.customers.size > 0 && (
        <p className="rounded-sm border-2 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="map-unplaced">
          {num(agg.unplaced.pcs)} pcs from {agg.unplaced.customers.size} customer{agg.unplaced.customers.size === 1 ? "" : "s"} are not on the map yet - {agg.unplaced.customers.size === 1 ? "their city needs" : "their cities need"} matching below.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="rounded-sm border-border p-2 shadow-none sm:p-4">
          <div ref={boxRef} className="relative" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Madhya Pradesh districts coloured by pieces ordered" data-testid="map-svg">
              {shapes.map((s) => {
                const g = agg.byDistrict[s.name];
                const on = s.name === focus || s.name === hover?.name;
                return (
                  <path
                    key={s.name}
                    d={s.d}
                    data-testid={`map-district-${s.name}`}
                    fill={FILL[band(g?.pcs)]}
                    stroke={on ? "#0b0b0b" : "#ffffff"}
                    strokeWidth={on ? 2 : 1}
                    className="cursor-pointer"
                    onPointerMove={(e) => onMove(e, s.name)}
                    onClick={() => setPinned(s.name)}
                  />
                );
              })}
              {/* the outline being looked at goes last, so its border is not hidden under a neighbour's */}
              {shapes.filter((s) => s.name === (hover?.name || focus)).map((s) => (
                <path key="top" d={s.d} fill="none" stroke="#0b0b0b" strokeWidth={2} pointerEvents="none" />
              ))}
              {shapes
                .filter((s) => band(agg.byDistrict[s.name]?.pcs) === "g")
                .map((s) => (
                  <text key={s.name} x={s.at[0]} y={s.at[1]} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#173404" pointerEvents="none">
                    {s.name}
                  </text>
                ))}
            </svg>
            {hover && (
              <div
                className="pointer-events-none absolute z-10 w-60 rounded-sm border-2 border-border bg-white p-3 shadow-sm"
                style={{ left: hover.x, top: hover.y }}
                data-testid="map-tooltip"
              >
                <Head name={hover.name} />
                <SubList name={hover.name} max={5} />
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
            {Object.entries(BAND_LABEL).map(([k, l]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: FILL[k] }} /> {l}
              </span>
            ))}
          </div>
        </Card>

        <Card className="rounded-sm border-2 border-border p-4 shadow-none" data-testid="map-detail">
          {focus ? (
            <>
              <Head name={focus} />
              <SubList name={focus} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No orders on the map for these filters yet.</p>
          )}
        </Card>
      </div>

      <Card className="rounded-sm border-border shadow-none" data-testid="map-matching">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Customer cities on the map</h2>
          <p className="text-xs text-muted-foreground">
            Each city is matched to a Madhya Pradesh sub-district by name. Only exact and known names count -
            {canEdit ? " confirm or pick the rest once, and it is remembered for that customer." : " the office confirms the rest."}
          </p>
        </div>
        {problems.length === 0 && (
          <p className="p-4 text-sm text-emerald-700" data-testid="map-all-matched">
            <CircleCheck className="mr-1 inline h-4 w-4" /> Every customer city is on the map.
          </p>
        )}
        <ul className="divide-y divide-border">
          {problems.map((x) => (
            <MatchRow key={x.c.id} {...x} canEdit={canEdit} placeItems={placeItems} setPlace={setPlace} />
          ))}
        </ul>
        {settled.length > 0 && (
          <div className="border-t border-border p-3">
            <Button data-testid="map-toggle-matched" variant="ghost" size="sm" onClick={() => setShowMatched((v) => !v)} className="rounded-sm">
              {showMatched ? "Hide" : "Show"} {settled.length} matched customer{settled.length === 1 ? "" : "s"}
            </Button>
          </div>
        )}
        {showMatched && (
          <ul className="divide-y divide-border border-t border-border">
            {settled.map((x) => (
              <MatchRow key={x.c.id} {...x} canEdit={canEdit} placeItems={placeItems} setPlace={setPlace} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function MatchRow({ c, m, canEdit, placeItems, setPlace }) {
  const k = KIND[m.kind];
  const Icon = k.icon;
  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center" data-testid={`map-match-${c.id}`}>
      <div className="min-w-0">
        <div className="font-medium">{c.city || "No city"}</div>
        <div className="truncate text-xs text-muted-foreground">{c.name}</div>
      </div>
      <div className="min-w-0 text-sm">
        {m.place ? (
          <>
            <ArrowRight className="mr-1 inline h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{m.place.n}</span>
            <span className="text-muted-foreground"> ({m.place.d})</span>
            {m.why && <div className="text-xs text-muted-foreground">{m.why}</div>}
          </>
        ) : m.kind === "outside" ? (
          <span className="text-muted-foreground">Left off the map</span>
        ) : (
          <>
            {m.why && <div className="text-xs text-muted-foreground">{m.why}</div>}
            {canEdit && m.options && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {m.options.map((p) => (
                  <Button key={p.c} data-testid={`map-confirm-${c.id}-${p.c}`} variant="outline" size="sm" className="h-7 rounded-sm text-xs" onClick={() => setPlace(c, p.c)}>
                    {p.n} ({p.d})
                  </Button>
                ))}
              </div>
            )}
            {!canEdit && m.options && <div className="text-xs text-muted-foreground">Maybe {m.options.map((p) => `${p.n} (${p.d})`).join(" or ")}</div>}
          </>
        )}
        {canEdit && (m.kind === "check" || m.kind === "none") && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <div className="w-56 max-w-full">
              <MasterPicker
                testid={`map-pick-${c.id}`}
                items={placeItems}
                value=""
                onChange={(p) => setPlace(c, p.id)}
                search={(p) => `${p.name} ${p.district}`}
                suffix={(p) => p.district}
                placeholder="Pick sub-district…"
                addLabel="sub-district"
                triggerClass="h-8 text-xs"
              />
            </div>
            <Button data-testid={`map-outside-${c.id}`} variant="ghost" size="sm" className="h-8 rounded-sm text-xs" onClick={() => setPlace(c, "outside")}>
              <MapPinOff className="mr-1 h-3.5 w-3.5" /> Outside MP
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <span className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold ${k.cls}`}>
          <Icon className="h-3.5 w-3.5" /> {k.label}
        </span>
        {canEdit && (m.kind === "set" || m.kind === "outside") && (
          <Button data-testid={`map-reset-${c.id}`} variant="ghost" size="icon" className="h-7 w-7" title="Match by city name again" onClick={() => setPlace(c, null)}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </li>
  );
}
