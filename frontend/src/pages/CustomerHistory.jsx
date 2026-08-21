import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { inr, num, fmtDate, xlDate, today } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, StateBadge } from "@/components/StatusBadge";
import { stateRowClass } from "@/lib/orderState";
import { DispatchDialog, EditOrderDialog } from "@/components/OrderDialogs";
import { ExportDialog } from "@/components/ExportDialog";
import { toast } from "sonner";
import { ArrowLeft, MapPin, Truck, Package, Printer, FileSpreadsheet, FilterX, Pencil } from "lucide-react";
import { Loader } from "@/components/Loader";

const EVENT_LABEL = { exhibition: "Exhibition", door_to_door: "Door to Door" };

const Stat = ({ label, value, testid }) => (
  <Card data-testid={testid} className="rounded-sm border-2 border-border p-4 shadow-none">
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
    <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</div>
  </Card>
);

export default function CustomerHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: "all", season: "all", event: "all" });
  const [dispatchOrder, setDispatchOrder] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [masters, setMasters] = useState({ brands: [], exhibitions: [], salesmen: [], seasons: [] });
  const [exportOpen, setExportOpen] = useState(false);
  const { requireUnlock } = useAuth();

  const load = async () => {
    try {
      setData(await api.customerHistory(id));
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line

  // Master lists power the Edit dialog's dropdowns; they don't change per customer.
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
        toast.error(apiErr(e));
      }
    })();
  }, []);

  const orders = useMemo(() => data?.orders || [], [data]);

  const seasonOpts = useMemo(() => Array.from(new Set(orders.map((o) => o.season || "No Season"))).sort(), [orders]);
  const eventOpts = useMemo(() => Array.from(new Set(orders.map((o) => o.event_type))).filter(Boolean), [orders]);

  const filtered = useMemo(
    () =>
      orders.filter(
        (o) =>
          (filters.status === "all" || o.totals.status === filters.status) &&
          (filters.season === "all" || (o.season || "No Season") === filters.season) &&
          (filters.event === "all" || o.event_type === filters.event)
      ),
    [orders, filters]
  );

  const fTotals = useMemo(
    () =>
      filtered.reduce(
        (a, o) => ({
          ordered: a.ordered + o.totals.ordered_qty,
          pending: a.pending + o.totals.pending_qty,
          amount: a.amount + o.totals.amount,
          dispatched_value: a.dispatched_value + (o.totals.dispatched_value || 0),
        }),
        { ordered: 0, pending: 0, amount: 0, dispatched_value: 0 }
      ),
    [filtered]
  );

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  const activeFilters = Object.values(filters).filter((v) => v !== "all").length;

  if (loading) return <Loader label="Loading history…" />;
  if (!data) return <div className="text-sm text-muted-foreground">Customer not found.</div>;

  const { customer, timeline, summary } = data;

  const exportSheets = [
    {
      name: "Summary",
      data: [
        { Field: "Customer", Value: customer.name },
        { Field: "City", Value: customer.city || "" },
        { Field: "Total Orders", Value: summary.order_count },
        { Field: "Pieces Ordered", Value: summary.ordered },
        { Field: "Pieces Dispatched", Value: summary.dispatched },
        { Field: "Pieces Pending", Value: summary.pending },
        { Field: "Order Value (INR)", Value: summary.amount },
        { Field: "Dispatched Value (INR)", Value: summary.dispatched_value || 0 },
        { Field: "Statement Date", Value: new Date().toLocaleDateString("en-IN") },
      ],
      columns: [
        { key: "Field", get: (r) => r.Field },
        { key: "Value", get: (r) => r.Value },
      ],
    },
    {
      name: "Order Totals",
      data: filtered,
      columns: [
        { key: "Sale Order", get: (o) => o.id },
        { key: "Order Date", get: (o) => xlDate(o.order_date) },
        { key: "Dispatch Date", get: (o) => xlDate(o.dispatch_date) },
        { key: "Event", get: (o) => EVENT_LABEL[o.event_type] || o.event_type || "" },
        { key: "Via", get: (o) => o.exhibition || o.salesman || "" },
        { key: "Season", get: (o) => o.season || "" },
        { key: "Ordered", get: (o) => o.totals.ordered_qty },
        { key: "Dispatched", get: (o) => o.totals.dispatched_qty },
        { key: "Pending", get: (o) => o.totals.pending_qty },
        { key: "Order Value (INR)", get: (o) => o.totals.amount },
        { key: "Dispatched Value (INR)", get: (o) => o.totals.dispatched_value || 0 },
        { key: "Status", get: (o) => o.totals.status },
      ],
    },
    {
      name: "Order Lines",
      data: filtered.flatMap((o) => (o.items || []).map((it) => ({ o, it }))),
      columns: [
        { key: "Sale Order", get: (x) => x.o.id },
        { key: "Order Date", get: (x) => xlDate(x.o.order_date) },
        { key: "Dispatch Date", get: (x) => xlDate(x.o.dispatch_date) },
        { key: "Event", get: (x) => EVENT_LABEL[x.o.event_type] || x.o.event_type || "" },
        { key: "Via", get: (x) => x.o.exhibition || x.o.salesman || "" },
        { key: "Season", get: (x) => x.o.season || "" },
        { key: "Brand", get: (x) => x.it.brand },
        { key: "Rate", get: (x) => x.it.rate },
        { key: "Qty", get: (x) => x.it.qty },
        { key: "Amount", get: (x) => (Number(x.it.rate) || 0) * (Number(x.it.qty) || 0) },
        { key: "Order Status", get: (x) => x.o.totals.status },
      ],
    },
    {
      name: "Dispatch Timeline",
      data: timeline.flatMap((d) => (d.items || []).map((it) => ({ d, it }))),
      columns: [
        { key: "Dispatch", get: (x) => x.d.id },
        { key: "Sale Order", get: (x) => x.d.sale_order_id },
        { key: "Date", get: (x) => xlDate(x.d.dispatch_date) },
        { key: "Brand", get: (x) => x.it.brand },
        { key: "Qty", get: (x) => x.it.qty },
        { key: "Actual Amount (INR)", get: (x) => (x.it.amount == null ? "" : x.it.amount) },
      ],
    },
  ];

  return (
    <div className="space-y-6" data-testid="customer-history-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button data-testid="history-back-btn" variant="ghost" size="sm" onClick={() => navigate("/customers")} className="mb-2 gap-1 no-print">
            <ArrowLeft className="h-4 w-4" /> All Customers
          </Button>
          <h1 className="font-display text-3xl font-extrabold tracking-tight" data-testid="history-customer-name">{customer.name}</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {customer.city || "No city on file"}
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Button data-testid="statement-export-btn" variant="outline" onClick={() => setExportOpen(true)} className="gap-2 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" /> Export Statement
          </Button>
          <Button data-testid="history-print-btn" variant="outline" onClick={() => window.print()} className="gap-2 rounded-sm">
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Stat testid="history-stat-orders" label="Total Orders" value={num(summary.order_count)} />
        <Stat testid="history-stat-ordered" label="Pieces Ordered" value={num(summary.ordered)} />
        <Stat testid="history-stat-pending" label="Pending Pieces" value={num(summary.pending)} />
        <Stat testid="history-stat-amount" label="Order Value" value={inr(summary.amount)} />
        <Stat testid="history-stat-dispatched-value" label="Dispatched Value" value={inr(summary.dispatched_value || 0)} />
      </div>

      {/* Orders */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="history-orders">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Order History</h2>
            <p className="text-xs text-muted-foreground">Showing {filtered.length} of {orders.length} orders</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print" data-testid="ledger-filters">
            <Select value={filters.status} onValueChange={(v) => setF({ status: v })}>
              <SelectTrigger data-testid="ledger-filter-status" className="h-9 w-32 rounded-sm border-2"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.season} onValueChange={(v) => setF({ season: v })}>
              <SelectTrigger data-testid="ledger-filter-season" className="h-9 w-36 rounded-sm border-2"><SelectValue placeholder="Season" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Seasons</SelectItem>
                {seasonOpts.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.event} onValueChange={(v) => setF({ event: v })}>
              <SelectTrigger data-testid="ledger-filter-event" className="h-9 w-36 rounded-sm border-2"><SelectValue placeholder="Event" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                {eventOpts.map((e) => <SelectItem key={e} value={e}>{EVENT_LABEL[e] || e}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeFilters > 0 && (
              <Button data-testid="ledger-filter-reset" variant="outline" size="sm" onClick={() => setFilters({ status: "all", season: "all", event: "all" })} className="h-9 gap-1 rounded-sm">
                <FilterX className="h-4 w-4" /> Reset
              </Button>
            )}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">{orders.length === 0 ? "No orders yet for this customer." : "No orders match these filters."}</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">Order</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Order Date</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Event / Season</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Items</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Ordered</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Order Value</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Dispatched ₹</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Status</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest no-print">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow
                  key={o.id}
                  className={`align-top ${stateRowClass(o.state) || "hover:bg-secondary/40"}`}
                  data-testid={`history-order-${o.id}`}
                >
                  <TableCell className="font-mono font-semibold">{o.id}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(o.order_date)}</TableCell>
                  <TableCell className="text-sm">
                    <div>{EVENT_LABEL[o.event_type] || o.event_type}</div>
                    <div className="text-xs text-muted-foreground">{(o.exhibition || o.salesman || "—")}{o.season ? ` · ${o.season}` : ""}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {o.items.map((it, i) => <div key={i}>{it.brand} × {num(it.qty)} @ {inr(it.rate)}</div>)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(o.totals.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(o.totals.pending_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(o.totals.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{inr(o.totals.dispatched_value || 0)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={o.totals.status} />
                      <StateBadge state={o.state} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right no-print">
                    <div className="flex justify-end gap-1">
                      <Button
                        data-testid={`ledger-edit-btn-${o.id}`}
                        variant="outline"
                        size="sm"
                        onClick={() => requireUnlock(() => setEditOrder(o))}
                        className="gap-1 rounded-sm"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        data-testid={`ledger-dispatch-btn-${o.id}`}
                        variant={o.totals.pending_qty > 0 ? "default" : "outline"}
                        size="sm"
                        disabled={o.totals.pending_qty <= 0}
                        onClick={() => setDispatchOrder(o)}
                        className="gap-1 rounded-sm"
                      >
                        <Truck className="h-3.5 w-3.5" /> Dispatch
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="history-orders-total-row">
                <TableCell colSpan={4}>Grand Total ({filtered.length})</TableCell>
                <TableCell className="text-right tabular-nums">{num(fTotals.ordered)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(fTotals.pending)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(fTotals.amount)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">{inr(fTotals.dispatched_value)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Dispatch timeline */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="history-timeline">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <Truck className="h-4 w-4 text-primary" />
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Dispatch Timeline</h2>
            <p className="text-xs text-muted-foreground">Every dispatch made against this customer's orders</p>
          </div>
        </div>
        <div className="p-4">
          {timeline.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <Package className="h-6 w-6 opacity-50" />
              No dispatches recorded yet.
            </div>
          ) : (
            <ol className="relative ml-3 border-l-2 border-border">
              {timeline.map((d) => (
                <li key={d.id} className="mb-5 ml-6" data-testid={`timeline-item-${d.id}`}>
                  <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-white" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold">{fmtDate(d.dispatch_date)}</span>
                    <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-xs">{d.sale_order_id}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{num(d.total)} pcs dispatched</span>
                    {d.value != null && (
                      <span className="rounded-sm border border-border px-2 py-0.5 text-xs font-semibold tabular-nums">{inr(d.value)}</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {d.items.map((it, i) => <span key={i} className="mr-3">{it.brand} × {num(it.qty)}</span>)}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="customer-statement"
        title="Export statement"
        fileName={`statement-${customer.name.replace(/[^a-z0-9]+/gi, "-")}-${today()}.xlsx`}
        sheets={exportSheets}
      />

      <DispatchDialog order={dispatchOrder} open={!!dispatchOrder} onOpenChange={(v) => !v && setDispatchOrder(null)} onDone={load} />

      <EditOrderDialog
        order={editOrder}
        customer={customer}
        masters={masters}
        open={!!editOrder}
        onOpenChange={(v) => !v && setEditOrder(null)}
        onDone={load}
      />
    </div>
  );
}
