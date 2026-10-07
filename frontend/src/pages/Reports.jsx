import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { inr, num, xlDate, today } from "@/lib/format";
import { downloadMultiSheet } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DispatchDialog, EditOrderDialog } from "@/components/OrderDialogs";
import { ExportDialog } from "@/components/ExportDialog";
import { toast } from "sonner";
import { FileSpreadsheet, Printer, FilterX, Pencil, Truck, ArrowUp, ArrowDown } from "lucide-react";
import { Loader } from "@/components/Loader";

const EVENT_LABEL = { exhibition: "Exhibition", door_to_door: "Door to Door" };
const eventLabel = (v) => EVENT_LABEL[v] || v || "—";

const GROUP_DIMS = [
  { key: "brand", label: "Brand" },
  { key: "customer", label: "Customer" },
  { key: "event_type", label: "Event Type" },
  { key: "exhibition", label: "Exhibition" },
  { key: "salesman", label: "Salesman" },
  { key: "line", label: "Line" },
  { key: "season", label: "Season" },
];

const uniq = (arr) => Array.from(new Set(arr.filter(Boolean))).sort();

// Detailed Lines headings. `get` is what the column sorts on, which for Event
// and Via is what is printed rather than the raw field.
const DETAIL_COLS = [
  { key: "sale_order_id", label: "Order", get: (r) => r.sale_order_id },
  { key: "customer", label: "Customer", get: (r) => r.customer },
  { key: "brand", label: "Brand", get: (r) => r.brand },
  { key: "event_type", label: "Event", get: (r) => eventLabel(r.event_type) },
  { key: "via", label: "Via", get: (r) => r.exhibition || r.salesman },
  { key: "season", label: "Season", get: (r) => r.season },
  { key: "ordered_qty", label: "Ordered", num: true, get: (r) => r.ordered_qty },
  { key: "dispatched_qty", label: "Dispatched", num: true, get: (r) => r.dispatched_qty },
  { key: "pending_qty", label: "Pending", num: true, get: (r) => r.pending_qty },
  { key: "amount", label: "Amount", num: true, get: (r) => r.amount },
  { key: "dispatched_value", label: "Dispatched ₹", num: true, get: (r) => r.dispatched_value },
];

export default function Reports() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ event_type: "all", customer: "all", brand: "all", exhibition: "all", salesman: "all", line: "all", season: "all", city: "all" });
  const [groupBy, setGroupBy] = useState("brand");
  const [masters, setMasters] = useState({ brands: [], exhibitions: [], salesmen: [], seasons: [] });
  const [dialog, setDialog] = useState(null); // { mode: "edit" | "dispatch", order, customer }
  const [busy, setBusy] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [sort, setSort] = useState(null); // { key, dir } - null keeps the server's order
  const { requireUnlock } = useAuth();

  const load = async () => {
    try {
      const data = await api.reports();
      setRows(data.rows || []);
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Master lists power the Edit dialog's dropdowns.
  useEffect(() => {
    (async () => {
      try {
        const [brands, exhibitions, salesmen, seasons] = await Promise.all([
          api.listMasters("brands"),
          api.listMasters("exhibitions"),
          api.listMasters("salesmen"),
          api.listMasters("seasons"),
        ]);
        setMasters({ brands, exhibitions, salesmen, seasons });
      } catch (e) {
        /* non-blocking - the table still works without them */
      }
    })();
  }, []);

  // A report row is one order LINE, so it doesn't carry the whole order.
  // Fetch the full order on click, then hand it to the shared dialogs.
  const openFor = async (saleOrderId, mode) => {
    setBusy(`${saleOrderId}:${mode}`);
    try {
      const { order, customer } = await api.saleOrder(saleOrderId);
      setDialog({ mode, order, customer });
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(null);
    }
  };

  const opts = useMemo(
    () => ({
      customer: uniq(rows.map((r) => r.customer)),
      brand: uniq(rows.map((r) => r.brand)),
      exhibition: uniq(rows.map((r) => r.exhibition)),
      salesman: uniq(rows.map((r) => r.salesman)),
      line: uniq(rows.map((r) => r.line)),
      season: uniq(rows.map((r) => r.season)),
      city: uniq(rows.map((r) => r.city)),
    }),
    [rows]
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (f.event_type === "all" || r.event_type === f.event_type) &&
          (f.customer === "all" || r.customer === f.customer) &&
          (f.brand === "all" || r.brand === f.brand) &&
          (f.exhibition === "all" || r.exhibition === f.exhibition) &&
          (f.salesman === "all" || r.salesman === f.salesman) &&
          (f.line === "all" || r.line === f.line) &&
          (f.season === "all" || r.season === f.season) &&
          (f.city === "all" || r.city === f.city)
      ),
    [rows, f]
  );

  const sorted = useMemo(() => {
    const col = sort && DETAIL_COLS.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      if (col.num) return ((Number(x) || 0) - (Number(y) || 0)) * factor;
      // numeric: true so order 9 comes before order 10, not after it.
      return String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true }) * factor;
    });
  }, [filtered, sort]);

  const toggleSort = (key) =>
    setSort((p) => (p?.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, r) => ({
          ordered_qty: a.ordered_qty + r.ordered_qty,
          dispatched_qty: a.dispatched_qty + r.dispatched_qty,
          pending_qty: a.pending_qty + r.pending_qty,
          amount: a.amount + r.amount,
          pending_value: a.pending_value + r.pending_value,
          dispatched_value: a.dispatched_value + (r.dispatched_value || 0),
        }),
        { ordered_qty: 0, dispatched_qty: 0, pending_qty: 0, amount: 0, pending_value: 0, dispatched_value: 0 }
      ),
    [filtered]
  );

  const pivot = useMemo(() => {
    const map = {};
    filtered.forEach((r) => {
      let key = r[groupBy];
      if (groupBy === "event_type") key = eventLabel(r.event_type);
      key = key || "—";
      const g = (map[key] = map[key] || { key, ordered_qty: 0, dispatched_qty: 0, pending_qty: 0, amount: 0, pending_value: 0, dispatched_value: 0 });
      g.ordered_qty += r.ordered_qty;
      g.dispatched_qty += r.dispatched_qty;
      g.pending_qty += r.pending_qty;
      g.amount += r.amount;
      g.pending_value += r.pending_value;
      g.dispatched_value += r.dispatched_value || 0;
    });
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  }, [filtered, groupBy]);

  const reset = () => setF({ event_type: "all", customer: "all", brand: "all", exhibition: "all", salesman: "all", line: "all", season: "all", city: "all" });
  const printReport = () => window.print();

  const groupLabel = GROUP_DIMS.find((g) => g.key === groupBy)?.label || "Group";

  const exportSheets = [
    {
      name: "Detail",
      data: sorted,
      columns: [
        { key: "Sale Order", get: (r) => r.sale_order_id },
        { key: "Customer", get: (r) => r.customer },
        { key: "City", get: (r) => r.city || "" },
        { key: "Brand", get: (r) => r.brand },
        { key: "Event Type", get: (r) => eventLabel(r.event_type) },
        { key: "Exhibition", get: (r) => r.exhibition || "" },
        { key: "Salesman", get: (r) => r.salesman || "" },
        { key: "Line", get: (r) => r.line || "" },
        { key: "Season", get: (r) => r.season || "" },
        { key: "Order Date", get: (r) => xlDate(r.order_date) },
        { key: "Dispatch Date", get: (r) => xlDate(r.dispatch_date) },
        { key: "Financial Year", get: (r) => r.financial_year || "" },
        { key: "Ordered", get: (r) => r.ordered_qty },
        { key: "Dispatched", get: (r) => r.dispatched_qty },
        { key: "Pending", get: (r) => r.pending_qty },
        { key: "Order Value", get: (r) => r.amount },
        { key: "Dispatched Value", get: (r) => r.dispatched_value || 0 },
        { key: "Pending Value", get: (r) => r.pending_value },
      ],
    },
    {
      name: `Pivot by ${groupLabel}`.slice(0, 31),
      data: pivot,
      columns: [
        { key: groupLabel, get: (p) => p.key },
        { key: "Ordered", get: (p) => p.ordered_qty },
        { key: "Dispatched", get: (p) => p.dispatched_qty },
        { key: "Pending", get: (p) => p.pending_qty },
        { key: "Order Value", get: (p) => p.amount },
        { key: "Dispatched Value", get: (p) => p.dispatched_value },
        { key: "Pending Value", get: (p) => p.pending_value },
      ],
    },
  ];

  const FilterSelect = ({ label, value, onValueChange, options, testid, formatter }) => (
    <div className="min-w-[150px]">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger data-testid={testid} className="h-9 rounded-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{formatter ? formatter(o) : o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (loading) return <Loader label="Loading reports…" />;

  return (
    <div className="space-y-6" data-testid="reports-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Reports</h1>
          <p className="text-sm text-muted-foreground">Filter order lines by any dimension and view a live pivot summary.</p>
        </div>
        <div className="flex gap-2">
          <Button data-testid="report-print-btn" variant="outline" onClick={printReport} className="gap-2 rounded-sm">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button data-testid="report-export-btn" onClick={() => setExportOpen(true)} className="gap-2 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" /> Export to Excel
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="rounded-sm border-border p-4 shadow-none" data-testid="report-filters">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect label="Event Type" testid="filter-event-type" value={f.event_type} onValueChange={(v) => setF({ ...f, event_type: v })} options={["exhibition", "door_to_door"]} formatter={eventLabel} />
          <FilterSelect label="Customer" testid="filter-report-customer" value={f.customer} onValueChange={(v) => setF({ ...f, customer: v })} options={opts.customer} />
          <FilterSelect label="Brand" testid="filter-report-brand" value={f.brand} onValueChange={(v) => setF({ ...f, brand: v })} options={opts.brand} />
          <FilterSelect label="Exhibition" testid="filter-report-exhibition" value={f.exhibition} onValueChange={(v) => setF({ ...f, exhibition: v })} options={opts.exhibition} />
          <FilterSelect label="Salesman" testid="filter-report-salesman" value={f.salesman} onValueChange={(v) => setF({ ...f, salesman: v })} options={opts.salesman} />
          <FilterSelect label="Line" testid="filter-report-line" value={f.line} onValueChange={(v) => setF({ ...f, line: v })} options={opts.line} />
          <FilterSelect label="Season" testid="filter-report-season" value={f.season} onValueChange={(v) => setF({ ...f, season: v })} options={opts.season} />
          <FilterSelect label="City" testid="filter-report-city" value={f.city} onValueChange={(v) => setF({ ...f, city: v })} options={opts.city} />
          <Button data-testid="report-reset-btn" variant="outline" size="sm" onClick={reset} className="h-9 gap-1 rounded-sm">
            <FilterX className="h-4 w-4" /> Reset
          </Button>
        </div>
      </Card>

      {/* Summary stat strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "Order Lines", v: num(filtered.length), t: "sum-lines" },
          { l: "Ordered", v: num(totals.ordered_qty), t: "sum-ordered" },
          { l: "Dispatched", v: num(totals.dispatched_qty), t: "sum-dispatched" },
          { l: "Pending", v: num(totals.pending_qty), t: "sum-pending" },
          { l: "Order Value", v: inr(totals.amount), t: "sum-amount" },
          { l: "Dispatched Value", v: inr(totals.dispatched_value), t: "sum-dispatched-value" },
        ].map((s) => (
          <Card key={s.t} data-testid={`report-${s.t}`} className="rounded-sm border-border p-4 shadow-none">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{s.l}</div>
            <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{s.v}</div>
          </Card>
        ))}
      </div>

      {/* Pivot */}
      <Card className="rounded-sm border-border shadow-none" data-testid="report-pivot">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Pivot Summary</h2>
            <p className="text-xs text-muted-foreground">Aggregated across current filters</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Group by</span>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger data-testid="pivot-groupby" className="h-9 w-40 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUP_DIMS.map((g) => <SelectItem key={g.key} value={g.key}>{g.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {pivot.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No data for the selected filters.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">{groupLabel}</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Ordered</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Dispatched</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Amount</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Dispatched ₹</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.map((p) => (
                <TableRow key={p.key} className="hover:bg-secondary/40" data-testid={`pivot-row-${p.key}`}>
                  <TableCell className="font-medium">{p.key}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(p.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{num(p.dispatched_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(p.pending_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(p.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{inr(p.dispatched_value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(p.pending_value)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="pivot-total-row">
                <TableCell>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(totals.ordered_qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{num(totals.dispatched_qty)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(totals.pending_qty)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(totals.amount)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">{inr(totals.dispatched_value)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(totals.pending_value)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Detail */}
      <Card className="rounded-sm border-border shadow-none" data-testid="report-detail">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Detailed Lines</h2>
          <p className="text-xs text-muted-foreground">{filtered.length} order line(s)</p>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No order lines match the filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/60">
                  {DETAIL_COLS.map((c) => (
                    <TableHead key={c.key} className={`text-xs uppercase tracking-widest ${c.num ? "text-right" : ""}`}>
                      <button
                        type="button"
                        data-testid={`report-sort-${c.key}`}
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-0.5 whitespace-nowrap uppercase tracking-widest hover:text-foreground ${
                          sort?.key === c.key ? "text-foreground" : ""
                        }`}
                      >
                        {c.label}
                        {sort?.key === c.key &&
                          (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="text-right text-xs uppercase tracking-widest no-print">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => (
                  <TableRow key={`${r.sale_order_id}-${r.brand}-${i}`} className="hover:bg-secondary/40">
                    <TableCell className="font-mono font-semibold">{r.sale_order_id}</TableCell>
                    <TableCell>{r.customer}{r.city ? <span className="ml-1 text-xs text-muted-foreground">· {r.city}</span> : null}</TableCell>
                    <TableCell>{r.brand}</TableCell>
                    <TableCell>{eventLabel(r.event_type)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.exhibition || r.salesman || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{r.season || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{num(r.ordered_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{num(r.dispatched_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(r.pending_qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(r.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{inr(r.dispatched_value || 0)}</TableCell>
                    <TableCell className="text-right no-print">
                      <div className="flex justify-end gap-1">
                        <Button
                          data-testid={`report-edit-${r.sale_order_id}`}
                          variant="outline"
                          size="sm"
                          disabled={busy === `${r.sale_order_id}:edit`}
                          onClick={() => requireUnlock(() => openFor(r.sale_order_id, "edit"))}
                          className="gap-1 rounded-sm"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          data-testid={`report-dispatch-${r.sale_order_id}`}
                          variant={r.pending_qty > 0 ? "default" : "outline"}
                          size="sm"
                          disabled={busy === `${r.sale_order_id}:dispatch`}
                          onClick={() => openFor(r.sale_order_id, "dispatch")}
                          className="gap-1 rounded-sm"
                        >
                          <Truck className="h-3.5 w-3.5" /> Dispatch
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="detail-total-row">
                  <TableCell colSpan={6}>Grand Total</TableCell>
                  <TableCell className="text-right tabular-nums">{num(totals.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(totals.dispatched_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{num(totals.pending_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(totals.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{inr(totals.dispatched_value)}</TableCell>
                  <TableCell className="no-print" />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="reports"
        fileName={`report-${today()}.xlsx`}
        sheets={exportSheets}
      />

      <DispatchDialog
        order={dialog?.mode === "dispatch" ? dialog.order : null}
        open={dialog?.mode === "dispatch"}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />

      <EditOrderDialog
        order={dialog?.mode === "edit" ? dialog.order : null}
        customer={dialog?.customer}
        masters={masters}
        open={dialog?.mode === "edit"}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={load}
      />
    </div>
  );
}
