import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { num, fmtMonth } from "@/lib/format";
import { downloadSheet } from "@/lib/excel";
import { Loader } from "@/components/Loader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Download, Grid3x3, Building2, Tag, CalendarDays, Truck } from "lucide-react";

// A salesman's reports, built in the browser from /sale-orders - which the
// server already narrows to his own entries - so they add nothing he could
// reach that he could not before. Quantities only: a salesman sees no money,
// and the server strips every rate and value before the list reaches him.

const NO_COLS = "__none__";

// What a row or column can be grouped by. `item` marks a brand-level split:
// an order with two brands lands in two rows.
const DIMS = {
  customer: { label: "Customer" },
  brand: { label: "Brand", item: true },
  month: { label: "Month", chrono: true },
  where: { label: "Where taken" },
  season: { label: "Season" },
  status: { label: "Status" },
};

// `order` measures only exist per whole order - the list carries no per-brand
// dispatch figures - so they cannot be split by brand.
const MEASURES = {
  orders: { label: "Orders", fmt: num },
  pieces: { label: "Pieces ordered", fmt: num },
  sent: { label: "Pieces sent", fmt: num, order: true },
  to_send: { label: "Pieces still to send", fmt: num, order: true },
};

const REPORTS = [
  { key: "pivot", label: "Pivot summary", icon: Grid3x3, help: "Pick what goes down the side, what goes across, and what to count." },
  { key: "customer", label: "By customer", icon: Building2, dim: "customer", measures: ["orders", "pieces", "sent", "to_send"] },
  { key: "brand", label: "By brand", icon: Tag, dim: "brand", measures: ["orders", "pieces"] },
  { key: "month", label: "By month", icon: CalendarDays, dim: "month", measures: ["orders", "pieces", "sent", "to_send"] },
  { key: "pending", label: "Still to send", icon: Truck, dim: "customer", measures: ["orders", "to_send"], pendingOnly: true },
];

const STATUS_LABEL = { pending: "Pending", partial: "Partial", done: "Done" };

/** Adds up `measure` into a cell, keeping a set of order ids for the order count
 *  so that an order split over two brands is still one order in the totals. */
const blank = () => ({ sum: 0, ids: new Set() });
const add = (cell, id, amount) => {
  cell.sum += amount;
  cell.ids.add(id);
};
const read = (cell, measure) => (cell ? (measure === "orders" ? cell.ids.size : cell.sum) : 0);

export default function MyReports() {
  const [orders, setOrders] = useState([]);
  const [masters, setMasters] = useState({ customers: [], brands: [], exhibitions: [], seasons: [], lines: [] });
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState("pivot");
  const [pivot, setPivot] = useState({ rows: "customer", cols: "month", measure: "pieces" });
  const [range, setRange] = useState({ start: "", end: "", skipCancelled: true });

  useEffect(() => {
    (async () => {
      try {
        const [o, c, b, e, se, ln] = await Promise.all([
          api.listSaleOrders(),
          api.listMasters("customers"),
          api.listMasters("brands"),
          api.listMasters("exhibitions"),
          api.listMasters("seasons"),
          api.listMasters("lines"),
        ]);
        setOrders(o);
        setMasters({ customers: c, brands: b, exhibitions: e, seasons: se, lines: ln });
      } catch (err) {
        toast.error(apiErr(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const nameOf = (list, id) => masters[list].find((m) => m.id === id)?.name;

  // Each dimension answers with [sort key, label] for an order and, for brand, an item.
  const keyOf = (dim, o, it) => {
    switch (dim) {
      case "customer": {
        const c = masters.customers.find((m) => m.id === o.customer_id);
        const label = c ? `${c.name}${c.city ? ` — ${c.city}` : ""}` : "Unknown customer";
        return [label, label];
      }
      case "brand": {
        const label = nameOf("brands", it?.brand_id) || "Unknown brand";
        return [label, label];
      }
      case "month": {
        const m = (o.order_date || "").slice(0, 7);
        return m ? [m, fmtMonth(m)] : ["9999", "No date"];
      }
      case "where": {
        const label =
          o.event_type === "exhibition"
            ? nameOf("exhibitions", o.exhibition_id) || "Exhibition"
            : nameOf("lines", o.line_id) || "Door to door (no line)";
        return [label, label];
      }
      case "season": {
        const label = nameOf("seasons", o.season_id) || "No season";
        return [label, label];
      }
      case "status": {
        const s = o.totals?.status || "pending";
        return [String(["pending", "partial", "done"].indexOf(s)), STATUS_LABEL[s] || s];
      }
      default:
        return ["", ""];
    }
  };

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        const d = o.order_date || "";
        if (range.start && d < range.start) return false;
        if (range.end && d > range.end) return false;
        if (range.skipCancelled && o.state === "cancelled") return false;
        return true;
      }),
    [orders, range]
  );

  /**
   * Groups the orders by `rowDim` (and `colDim`, if any) and adds up every
   * measure asked for. Walks order lines when anything is brand-level, whole
   * orders otherwise - so order-only measures never meet a brand split.
   */
  const build = (rowDim, colDim, measures, { pendingOnly = false } = {}) => {
    const byItem = DIMS[rowDim]?.item || DIMS[colDim]?.item || measures.includes("pieces");
    const rows = new Map(); // rowKey -> { label, cells: Map(colKey -> {measure: cell}), total: {measure: cell} }
    const cols = new Map(); // colKey -> label
    const colTotals = new Map();
    const grand = Object.fromEntries(measures.map((m) => [m, blank()]));

    const put = (o, it, amounts) => {
      const [rk, rl] = keyOf(rowDim, o, it);
      const [ck, cl] = colDim ? keyOf(colDim, o, it) : ["", ""];
      if (!rows.has(rk)) rows.set(rk, { key: rk, label: rl, cells: new Map(), total: Object.fromEntries(measures.map((m) => [m, blank()])) });
      const row = rows.get(rk);
      if (colDim) {
        cols.set(ck, cl);
        if (!row.cells.has(ck)) row.cells.set(ck, Object.fromEntries(measures.map((m) => [m, blank()])));
        if (!colTotals.has(ck)) colTotals.set(ck, Object.fromEntries(measures.map((m) => [m, blank()])));
      }
      for (const m of measures) {
        const amount = amounts[m] || 0;
        add(row.total[m], o.id, amount);
        add(grand[m], o.id, amount);
        if (colDim) {
          add(row.cells.get(ck)[m], o.id, amount);
          add(colTotals.get(ck)[m], o.id, amount);
        }
      }
    };

    for (const o of filtered) {
      const t = o.totals || {};
      if (pendingOnly && !(t.pending_qty > 0)) continue;
      // order-level figures, once per order
      const orderAmounts = { sent: t.dispatched_qty || 0, to_send: t.pending_qty || 0 };
      if (byItem) {
        (o.items || []).forEach((it, i) => {
          const qty = Number(it.qty) || 0;
          // order-level measures ride on the first line only, so they are not
          // counted once per brand when nothing is split by brand
          put(o, it, { pieces: qty, ...(i === 0 ? orderAmounts : {}) });
        });
      } else {
        put(o, null, orderAmounts);
      }
    }

    const sortKeys = (dim, entries, totalOf) =>
      DIMS[dim]?.chrono || dim === "status"
        ? entries.sort((a, b) => a.key.localeCompare(b.key))
        : entries.sort((a, b) => totalOf(b) - totalOf(a) || a.label.localeCompare(b.label));

    const lead = measures[0];
    const rowList = sortKeys(rowDim, [...rows.values()], (r) => read(r.total[lead], lead));
    const colList = colDim
      ? sortKeys(colDim, [...cols.entries()].map(([key, label]) => ({ key, label })), (c) => read(colTotals.get(c.key)[lead], lead))
      : [];
    return { rows: rowList, cols: colList, colTotals, grand };
  };

  if (loading) return <Loader label="Loading reports…" />;

  const current = REPORTS.find((r) => r.key === report);
  // order-only measures make no sense against a brand split
  const brandSplit = pivot.rows === "brand" || pivot.cols === "brand";
  const measureOk = (m) => !(brandSplit && MEASURES[m].order);
  const pivotMeasure = measureOk(pivot.measure) ? pivot.measure : "pieces";

  const download = async (rowsOut, name) => {
    if (rowsOut.length === 0) return toast.error("Nothing to download for these dates");
    try {
      await downloadSheet(rowsOut, name.slice(0, 31), `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  let body;
  if (report === "pivot") {
    const colDim = pivot.cols === NO_COLS ? null : pivot.cols;
    const { rows, cols, colTotals, grand } = build(pivot.rows, colDim, [pivotMeasure]);
    const fmt = MEASURES[pivotMeasure].fmt;
    const rowLabel = DIMS[pivot.rows].label;
    const sheet = [
      ...rows.map((r) => ({
        [rowLabel]: r.label,
        ...Object.fromEntries(cols.map((c) => [c.label, read(r.cells.get(c.key)?.[pivotMeasure], pivotMeasure)])),
        Total: read(r.total[pivotMeasure], pivotMeasure),
      })),
      {
        [rowLabel]: "Grand Total",
        ...Object.fromEntries(cols.map((c) => [c.label, read(colTotals.get(c.key)[pivotMeasure], pivotMeasure)])),
        Total: read(grand[pivotMeasure], pivotMeasure),
      },
    ];
    body = (
      <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-xs uppercase tracking-widest">Down the side</Label>
            <Select value={pivot.rows} onValueChange={(v) => setPivot((p) => ({ ...p, rows: v, cols: p.cols === v ? NO_COLS : p.cols }))}>
              <SelectTrigger data-testid="pivot-rows" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DIMS).map(([k, d]) => <SelectItem key={k} value={k}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Across the top</Label>
            <Select value={pivot.cols} onValueChange={(v) => setPivot((p) => ({ ...p, cols: v }))}>
              <SelectTrigger data-testid="pivot-cols" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COLS}>Nothing - just totals</SelectItem>
                {Object.entries(DIMS)
                  .filter(([k]) => k !== pivot.rows)
                  .map(([k, d]) => <SelectItem key={k} value={k}>{d.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Count</Label>
            <Select value={pivotMeasure} onValueChange={(v) => setPivot((p) => ({ ...p, measure: v }))}>
              <SelectTrigger data-testid="pivot-measure" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(MEASURES).map(([k, m]) => (
                  <SelectItem key={k} value={k} disabled={!measureOk(k)}>
                    {m.label}{measureOk(k) ? "" : " (not by brand)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ReportTable
          empty={rows.length === 0}
          download={() => download(sheet, `Pivot ${MEASURES[pivotMeasure].label}`)}
          head={
            <TableRow className="bg-secondary/60">
              <TableHead className="sticky left-0 z-10 bg-secondary text-xs uppercase tracking-widest">{rowLabel}</TableHead>
              {cols.map((c) => <TableHead key={c.key} className="whitespace-nowrap text-right text-xs uppercase tracking-widest">{c.label}</TableHead>)}
              <TableHead className="text-right text-xs uppercase tracking-widest">Total</TableHead>
            </TableRow>
          }
          rows={rows.map((r) => (
            <TableRow key={r.key} data-testid={`pivot-row-${r.key}`}>
              <TableCell className="sticky left-0 z-10 bg-background font-medium">{r.label}</TableCell>
              {cols.map((c) => {
                const v = read(r.cells.get(c.key)?.[pivotMeasure], pivotMeasure);
                return <TableCell key={c.key} className="text-right tabular-nums">{v ? fmt(v) : <span className="text-muted-foreground">—</span>}</TableCell>;
              })}
              <TableCell className="text-right font-semibold tabular-nums">{fmt(read(r.total[pivotMeasure], pivotMeasure))}</TableCell>
            </TableRow>
          ))}
          total={
            <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="pivot-total">
              <TableCell className="sticky left-0 z-10 bg-secondary">Grand Total</TableCell>
              {cols.map((c) => <TableCell key={c.key} className="text-right tabular-nums">{fmt(read(colTotals.get(c.key)[pivotMeasure], pivotMeasure))}</TableCell>)}
              <TableCell className="text-right tabular-nums">{fmt(read(grand[pivotMeasure], pivotMeasure))}</TableCell>
            </TableRow>
          }
        />
        {pivotMeasure === "orders" && colDim && (
          <p className="text-xs text-muted-foreground">An order that spans two columns is counted in each, but only once in the totals.</p>
        )}
      </>
    );
  } else {
    const { rows, grand } = build(current.dim, null, current.measures, { pendingOnly: current.pendingOnly });
    const rowLabel = DIMS[current.dim].label;
    const sheet = [
      ...rows.map((r) => ({ [rowLabel]: r.label, ...Object.fromEntries(current.measures.map((m) => [MEASURES[m].label, read(r.total[m], m)])) })),
      { [rowLabel]: "Grand Total", ...Object.fromEntries(current.measures.map((m) => [MEASURES[m].label, read(grand[m], m)])) },
    ];
    body = (
      <ReportTable
        empty={rows.length === 0}
        download={() => download(sheet, current.label)}
        head={
          <TableRow className="bg-secondary/60">
            <TableHead className="sticky left-0 z-10 bg-secondary text-xs uppercase tracking-widest">{rowLabel}</TableHead>
            {current.measures.map((m) => <TableHead key={m} className="whitespace-nowrap text-right text-xs uppercase tracking-widest">{MEASURES[m].label}</TableHead>)}
          </TableRow>
        }
        rows={rows.map((r) => (
          <TableRow key={r.key} data-testid={`report-row-${r.key}`}>
            <TableCell className="sticky left-0 z-10 bg-background font-medium">{r.label}</TableCell>
            {current.measures.map((m) => <TableCell key={m} className="text-right tabular-nums">{MEASURES[m].fmt(read(r.total[m], m))}</TableCell>)}
          </TableRow>
        ))}
        total={
          <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="report-total">
            <TableCell className="sticky left-0 z-10 bg-secondary">Grand Total</TableCell>
            {current.measures.map((m) => <TableCell key={m} className="text-right tabular-nums">{MEASURES[m].fmt(read(grand[m], m))}</TableCell>)}
          </TableRow>
        }
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="my-reports-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Summaries of your orders, including any the office entered under your name.</p>
      </div>

      {/* The menu */}
      <div className="flex flex-wrap gap-2" data-testid="report-menu">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const on = r.key === report;
          return (
            <button
              key={r.key}
              type="button"
              data-testid={`report-${r.key}`}
              onClick={() => setReport(r.key)}
              className={`flex items-center gap-1.5 rounded-sm border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-secondary"
              }`}
            >
              <Icon className="h-4 w-4" /> {r.label}
            </button>
          );
        })}
      </div>

      <Card className="space-y-4 rounded-sm border-2 border-border p-4 shadow-none sm:p-5">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{current.label}</h2>
          {current.help && <p className="text-xs text-muted-foreground">{current.help}</p>}
          {current.pendingOnly && <p className="text-xs text-muted-foreground">Only orders with something still to go out.</p>}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">From</Label>
            <Input data-testid="report-start" type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className="mt-1 h-9 w-40 rounded-sm" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">To</Label>
            <Input data-testid="report-end" type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className="mt-1 h-9 w-40 rounded-sm" />
          </div>
          <label className="flex h-9 items-center gap-2 text-sm">
            <Checkbox
              data-testid="report-skip-cancelled"
              checked={range.skipCancelled}
              onCheckedChange={(v) => setRange({ ...range, skipCancelled: !!v })}
            />
            Leave out cancelled orders
          </label>
        </div>

        {body}
      </Card>
    </div>
  );
}

function ReportTable({ head, rows, total, empty, download }) {
  if (empty) return <div className="p-8 text-center text-sm text-muted-foreground">No orders in this period.</div>;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button data-testid="report-download" variant="outline" size="sm" onClick={download} className="gap-1 rounded-sm">
          <Download className="h-4 w-4" /> Excel
        </Button>
      </div>
      <Table>
        <TableHeader>{head}</TableHeader>
        <TableBody>
          {rows}
          {total}
        </TableBody>
      </Table>
    </div>
  );
}
