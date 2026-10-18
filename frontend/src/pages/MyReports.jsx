import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { num, inr, fmtDate, today } from "@/lib/format";
import { downloadSheet } from "@/lib/excel";
import { Loader } from "@/components/Loader";
import { StatusBadge, StateBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CalendarDays, Route, Tag, ChevronLeft, ChevronRight, ChevronDown, Download, Inbox, Store, Boxes, ScrollText, Wallet } from "lucide-react";

/* A salesman's reports: his day, his trips, his brands. Built in the browser
   from /sale-orders and /expenses, which the server already narrows to his own
   entries - so nothing here reaches anything he could not see before.
   Pieces everywhere; the only money is his own expense vouchers, which he
   typed in himself (SALESMAN_OWN_MONEY on the server).
   Cancelled orders are left out of every count: nothing more will go out on
   them. Per-brand sent and still-to-send come from each order's brand_qty. */

const TABS = [
  { key: "day", label: "Today's Work", icon: CalendarDays },
  { key: "line", label: "Line Ledger", icon: Route },
  { key: "brand", label: "Brand Ledger", icon: Tag },
];

const NONE = "__all__";

// Calendar days, by the local clock - see the date rules in CLAUDE.md.
const shiftDay = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const weekday = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short" });
};
const voucherTotal = (e) => (e.items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
const live = (o) => o.state !== "cancelled";

const Tile = ({ label, value, icon: Icon, testid }) => (
  <Card className="rounded-lg border-border p-3 shadow-sm" data-testid={testid}>
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5" />} {label}
    </div>
    <div className="mt-1 truncate font-display text-xl font-extrabold tabular-nums">{value}</div>
  </Card>
);

const Progress = ({ sent, ordered }) => {
  const pct = ordered > 0 ? Math.min(100, Math.round((sent / ordered) * 100)) : 0;
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>
          {num(sent)} of {num(ordered)} sent
        </span>
        <span className="font-semibold text-amber-700">{num(Math.max(0, ordered - sent))} to send</span>
      </div>
    </div>
  );
};

const Empty = ({ children }) => (
  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
    <Inbox className="h-6 w-6 opacity-50" />
    {children}
  </div>
);

const Section = ({ title, children, action }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{title}</h3>
      {action}
    </div>
    {children}
  </div>
);

export default function MyReports() {
  const [orders, setOrders] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [masters, setMasters] = useState({ customers: [], brands: [], exhibitions: [], seasons: [], lines: [], expense_heads: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("day");

  useEffect(() => {
    (async () => {
      try {
        const [o, x, c, b, e, se, ln, eh] = await Promise.all([
          api.listSaleOrders(),
          api.listExpenses(),
          api.listMasters("customers"),
          api.listMasters("brands"),
          api.listMasters("exhibitions"),
          api.listMasters("seasons"),
          api.listMasters("lines"),
          api.listMasters("expense_heads"),
        ]);
        setOrders(o);
        setExpenses(x);
        setMasters({ customers: c, brands: b, exhibitions: e, seasons: se, lines: ln, expense_heads: eh });
      } catch (err) {
        toast.error(apiErr(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const maps = useMemo(() => {
    const m = {};
    Object.entries(masters).forEach(([k, list]) => (m[k] = new Map(list.map((x) => [x.id, x]))));
    return m;
  }, [masters]);
  const nameOf = (list, id, fallback = "—") => maps[list]?.get(id)?.name || fallback;
  const shopOf = (id) => {
    const c = maps.customers?.get(id);
    return c ? { name: c.name, city: c.city || "" } : { name: "Unknown shop", city: "" };
  };

  if (loading) return <Loader label="Loading your reports…" />;

  const ctx = { orders, expenses, nameOf, shopOf, masters };
  return (
    <div className="space-y-5" data-testid="my-reports">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Your own orders, in pieces. Cancelled orders are left out.</p>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-secondary/60 p-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`my-report-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-xs font-semibold transition-colors sm:flex-row sm:justify-center sm:gap-2 sm:text-sm ${
              tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "day" && <DayWork {...ctx} />}
      {tab === "line" && <LineLedger {...ctx} />}
      {tab === "brand" && <BrandLedger {...ctx} />}
    </div>
  );
}

/* ---------------------------------------------------------- Today's Work -- */

function DayWork({ orders, expenses, nameOf, shopOf }) {
  const [day, setDay] = useState(today());

  const piecesOn = (d) => orders.filter((o) => o.order_date === d && live(o)).reduce((s, o) => s + (o.totals?.ordered_qty || 0), 0);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(day, i - 6)).map((d) => ({ d, pcs: piecesOn(d) }));
  const top = Math.max(1, ...week.map((w) => w.pcs));

  const taken = orders.filter((o) => o.order_date === day);
  const counted = taken.filter(live);
  const shops = new Set(counted.map((o) => o.customer_id));
  const pieces = counted.reduce((s, o) => s + (o.totals?.ordered_qty || 0), 0);
  const vouchers = expenses.filter((e) => e.expense_date === day);
  const spent = vouchers.reduce((s, e) => s + voucherTotal(e), 0);

  const brands = {};
  counted.forEach((o) => (o.items || []).forEach((it) => (brands[it.brand_id] = (brands[it.brand_id] || 0) + (Number(it.qty) || 0))));
  const brandList = Object.entries(brands).sort((a, b) => b[1] - a[1]);

  const where = (o) =>
    o.event_type === "exhibition" ? nameOf("exhibitions", o.exhibition_id, "Exhibition") : nameOf("lines", o.line_id, "Door to door");

  const exportDay = () =>
    downloadSheet(
      counted.flatMap((o) =>
        (o.items || []).map((it) => ({
          Date: fmtDate(o.order_date),
          Order: o.id,
          Shop: shopOf(o.customer_id).name,
          City: shopOf(o.customer_id).city,
          Where: where(o),
          Brand: nameOf("brands", it.brand_id),
          Pieces: Number(it.qty) || 0,
        }))
      ),
      "Day's work",
      `my-work-${day}.xlsx`
    );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-lg" onClick={() => setDay(shiftDay(day, -1))} aria-label="Day before" data-testid="day-prev">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="relative flex-1">
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-11 rounded-lg text-center font-semibold" data-testid="day-pick" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-lg" onClick={() => setDay(shiftDay(day, 1))} aria-label="Day after" data-testid="day-next">
          <ChevronRight className="h-5 w-5" />
        </Button>
        {day !== today() && (
          <Button variant="secondary" className="h-11 shrink-0 rounded-lg" onClick={() => setDay(today())} data-testid="day-today">
            Today
          </Button>
        )}
      </div>

      {/* The last seven days, ending on the one picked - tap a day to open it. */}
      <div className="grid grid-cols-7 gap-1.5" data-testid="day-week">
        {week.map((w) => (
          <button
            key={w.d}
            type="button"
            onClick={() => setDay(w.d)}
            className={`flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors ${
              w.d === day ? "border-primary bg-accent" : "border-border bg-card hover:bg-secondary"
            }`}
            title={`${fmtDate(w.d)}: ${num(w.pcs)} pcs`}
          >
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">{weekday(w.d)}</span>
            <span className="flex h-10 w-full items-end justify-center">
              <span className="w-3 rounded-t bg-primary/80" style={{ height: `${w.pcs ? Math.max(8, (w.pcs / top) * 100) : 0}%` }} />
            </span>
            <span className="text-[10px] tabular-nums text-foreground">{w.pcs ? num(w.pcs) : "–"}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile testid="day-orders" label="Orders" value={num(counted.length)} icon={ScrollText} />
        <Tile testid="day-shops" label="Shops" value={num(shops.size)} icon={Store} />
        <Tile testid="day-pieces" label="Pieces" value={num(pieces)} icon={Boxes} />
        <Tile testid="day-spent" label="Expenses" value={inr(spent)} icon={Wallet} />
      </div>

      {taken.length === 0 && vouchers.length === 0 ? (
        <Empty>Nothing on {fmtDate(day)}. Pick another day above.</Empty>
      ) : (
        <>
          {brandList.length > 0 && (
            <Section title="Brands taken">
              <div className="flex flex-wrap gap-1.5">
                {brandList.map(([bid, q]) => (
                  <span key={bid} className="rounded-full border border-border bg-card px-3 py-1 text-sm">
                    {nameOf("brands", bid)} <span className="font-semibold tabular-nums">· {num(q)}</span>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {taken.length > 0 && (
            <Section
              title={`Orders (${taken.length})`}
              action={
                <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={exportDay} data-testid="day-export">
                  <Download className="h-3.5 w-3.5" /> Excel
                </Button>
              }
            >
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {taken.map((o) => {
                  const shop = shopOf(o.customer_id);
                  return (
                    <li key={o.id} className="p-3" data-testid={`day-order-${o.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 font-medium">
                            {shop.name}
                            <StateBadge state={o.state} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {shop.city ? `${shop.city} · ` : ""}
                            {where(o)} · {o.id}
                          </div>
                        </div>
                        <div className="shrink-0 text-right font-semibold tabular-nums">{num(o.totals?.ordered_qty)} pcs</div>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {(o.items || []).map((it) => `${nameOf("brands", it.brand_id)} × ${num(it.qty)}`).join(", ")}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}

          {vouchers.length > 0 && (
            <Section title={`Expenses (${vouchers.length})`}>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {vouchers.map((e) => (
                  <li key={e.id} className="p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {e.event_type === "exhibition" ? nameOf("exhibitions", e.exhibition_id, "Exhibition") : nameOf("lines", e.line_id, "Door to door")}
                      </span>
                      <span className="font-semibold tabular-nums">{inr(voucherTotal(e))}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {(e.items || []).map((it) => `${nameOf("expense_heads", it.head_id)} ${inr(it.amount)}`).join(" · ")}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Line Ledger -- */

function LineLedger({ orders, expenses, nameOf, shopOf, masters }) {
  const [open, setOpen] = useState(null);

  // A door-to-door order belongs to its line; an exhibition order to its
  // exhibition, so every order he took has a place here.
  const keyOf = (x) => (x.event_type === "exhibition" ? `exh:${x.exhibition_id || ""}` : `line:${x.line_id || ""}`);

  const groups = (() => {
    const g = {};
    const get = (k, x) =>
      (g[k] ||= {
        key: k,
        kind: x.event_type === "exhibition" ? "Exhibition" : "Line",
        name: x.event_type === "exhibition" ? nameOf("exhibitions", x.exhibition_id, "Exhibition") : nameOf("lines", x.line_id, "No line set"),
        line: x.event_type === "exhibition" ? null : masters.lines.find((l) => l.id === x.line_id),
        orders: [],
        shops: new Set(),
        days: new Set(),
        ordered: 0,
        sent: 0,
        spent: 0,
        last: "",
        brands: {},
      });
    orders.filter(live).forEach((o) => {
      const r = get(keyOf(o), o);
      r.orders.push(o);
      r.shops.add(o.customer_id);
      if (o.order_date) r.days.add(o.order_date);
      r.ordered += o.totals?.ordered_qty || 0;
      r.sent += o.totals?.dispatched_qty || 0;
      if ((o.order_date || "") > r.last) r.last = o.order_date;
      (o.brand_qty || []).forEach((b) => {
        const x = (r.brands[b.brand_id] ||= { ordered: 0, sent: 0 });
        x.ordered += b.ordered_qty;
        x.sent += b.dispatched_qty;
      });
    });
    expenses.forEach((e) => {
      const r = get(keyOf(e), e);
      r.spent += voucherTotal(e);
      if ((e.expense_date || "") > r.last) r.last = e.expense_date;
    });
    return Object.values(g).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
  })();

  const exportLines = () =>
    downloadSheet(
      groups.map((r) => ({
        Type: r.kind,
        Name: r.name,
        "From": r.line?.start_date ? fmtDate(r.line.start_date) : "",
        "To": r.line?.end_date ? fmtDate(r.line.end_date) : "",
        "Days worked": r.days.size,
        Orders: r.orders.length,
        Shops: r.shops.size,
        "Pieces ordered": r.ordered,
        "Pieces sent": r.sent,
        "Still to send": r.ordered - r.sent,
        Expenses: r.spent,
      })),
      "Line ledger",
      `my-lines-${today()}.xlsx`
    );

  if (groups.length === 0) return <Empty>No orders or expenses yet.</Empty>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Every trip and exhibition, newest first. Tap one to see its orders.</p>
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-1 text-xs" onClick={exportLines} data-testid="line-export">
          <Download className="h-3.5 w-3.5" /> Excel
        </Button>
      </div>
      {groups.map((r) => {
        const isOpen = open === r.key;
        const dates = r.line && (r.line.start_date || r.line.end_date) ? `${fmtDate(r.line.start_date)} – ${fmtDate(r.line.end_date)}` : null;
        return (
          <Card key={r.key} className="overflow-hidden rounded-lg border-border shadow-sm" data-testid={`line-card-${r.key}`}>
            <button type="button" className="w-full p-4 text-left" onClick={() => setOpen(isOpen ? null : r.key)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{r.kind}</div>
                  <div className="truncate font-display text-lg font-bold leading-tight">{r.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {dates || (r.last ? `Last: ${fmtDate(r.last)}` : "")}
                    {r.days.size > 0 && ` · ${r.days.size} day${r.days.size === 1 ? "" : "s"} worked`}
                  </div>
                </div>
                <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-secondary/70 py-1.5">
                  <div className="font-display text-base font-extrabold tabular-nums">{num(r.orders.length)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Orders</div>
                </div>
                <div className="rounded-md bg-secondary/70 py-1.5">
                  <div className="font-display text-base font-extrabold tabular-nums">{num(r.shops.size)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Shops</div>
                </div>
                <div className="rounded-md bg-secondary/70 py-1.5">
                  <div className="font-display text-base font-extrabold tabular-nums">{num(r.ordered)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pieces</div>
                </div>
              </div>
              <div className="mt-3">
                <Progress sent={r.sent} ordered={r.ordered} />
              </div>
              {r.spent > 0 && (
                <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm">
                  <span className="text-muted-foreground">Trip expenses</span>
                  <span className="font-semibold tabular-nums">
                    {inr(r.spent)}
                    {r.ordered > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">({inr(r.spent / r.ordered)}/pc)</span>}
                  </span>
                </div>
              )}
            </button>

            {isOpen && (
              <div className="space-y-3 border-t border-border bg-secondary/30 p-4" data-testid={`line-detail-${r.key}`}>
                {Object.keys(r.brands).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(r.brands)
                      .sort((a, b) => b[1].ordered - a[1].ordered)
                      .map(([bid, b]) => (
                        <span key={bid} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs">
                          {nameOf("brands", bid)} <span className="font-semibold tabular-nums">{num(b.sent)}/{num(b.ordered)}</span>
                        </span>
                      ))}
                  </div>
                )}
                {r.orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Only expenses so far - no orders on this one.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border bg-card">
                    {[...r.orders]
                      .sort((a, b) => (b.order_date || "").localeCompare(a.order_date || ""))
                      .map((o) => (
                        <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{shopOf(o.customer_id).name}</div>
                            <div className="text-xs text-muted-foreground">
                              {fmtDate(o.order_date)} · {o.id}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-semibold tabular-nums">{num(o.totals?.ordered_qty)} pcs</div>
                            <StatusBadge status={o.totals?.status} />
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- Brand Ledger -- */

function BrandLedger({ orders, nameOf, shopOf, masters }) {
  const [open, setOpen] = useState(null);
  const [season, setSeason] = useState(NONE);

  const brands = useMemo(() => {
    const g = {};
    orders
      .filter(live)
      .filter((o) => season === NONE || o.season_id === season)
      .forEach((o) =>
        (o.brand_qty || []).forEach((b) => {
          const r = (g[b.brand_id] ||= { id: b.brand_id, orders: new Set(), shops: {}, ordered: 0, sent: 0 });
          r.orders.add(o.id);
          r.ordered += b.ordered_qty;
          r.sent += b.dispatched_qty;
          const s = (r.shops[o.customer_id] ||= { ordered: 0, sent: 0 });
          s.ordered += b.ordered_qty;
          s.sent += b.dispatched_qty;
        })
      );
    return Object.values(g).sort((a, b) => b.ordered - a.ordered);
  }, [orders, season]);

  const totals = brands.reduce((t, b) => ({ ordered: t.ordered + b.ordered, sent: t.sent + b.sent }), { ordered: 0, sent: 0 });

  const exportBrands = () =>
    downloadSheet(
      brands.flatMap((b) =>
        Object.entries(b.shops).map(([cid, s]) => ({
          Brand: nameOf("brands", b.id),
          Shop: shopOf(cid).name,
          City: shopOf(cid).city,
          "Pieces ordered": s.ordered,
          "Pieces sent": s.sent,
          "Still to send": s.ordered - s.sent,
        }))
      ),
      "Brand ledger",
      `my-brands-${today()}.xlsx`
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select value={season} onValueChange={setSeason}>
          <SelectTrigger className="h-10 flex-1 rounded-lg" data-testid="brand-season">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>All seasons</SelectItem>
            {masters.seasons.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-10 shrink-0 gap-1 text-xs" onClick={exportBrands} data-testid="brand-export">
          <Download className="h-3.5 w-3.5" /> Excel
        </Button>
      </div>

      {brands.length === 0 ? (
        <Empty>No orders for these brands yet.</Empty>
      ) : (
        <>
          <Card className="rounded-lg border-border p-4 shadow-sm">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">All brands</span>
              <span className="font-display text-lg font-extrabold tabular-nums">{num(totals.ordered)} pcs</span>
            </div>
            <Progress sent={totals.sent} ordered={totals.ordered} />
          </Card>

          {brands.map((b) => {
            const isOpen = open === b.id;
            return (
              <Card key={b.id} className="overflow-hidden rounded-lg border-border shadow-sm" data-testid={`brand-card-${b.id}`}>
                <button type="button" className="w-full p-4 text-left" onClick={() => setOpen(isOpen ? null : b.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-base font-bold">{nameOf("brands", b.id)}</div>
                      <div className="text-xs text-muted-foreground">
                        {num(b.orders.size)} order{b.orders.size === 1 ? "" : "s"} · {num(Object.keys(b.shops).length)} shop
                        {Object.keys(b.shops).length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-display text-lg font-extrabold tabular-nums">{num(b.ordered)}</span>
                      <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </div>
                  </div>
                  <div className="mt-2">
                    <Progress sent={b.sent} ordered={b.ordered} />
                  </div>
                </button>
                {isOpen && (
                  <ul className="divide-y divide-border border-t border-border bg-secondary/30" data-testid={`brand-detail-${b.id}`}>
                    {Object.entries(b.shops)
                      .sort((x, y) => y[1].ordered - x[1].ordered)
                      .map(([cid, s]) => (
                        <li key={cid} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{shopOf(cid).name}</div>
                            <div className="text-xs text-muted-foreground">{shopOf(cid).city}</div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <div className="font-semibold">{num(s.ordered)} pcs</div>
                            <div className="text-xs text-muted-foreground">
                              {num(s.sent)} sent · <span className="text-amber-700">{num(s.ordered - s.sent)} to send</span>
                            </div>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
