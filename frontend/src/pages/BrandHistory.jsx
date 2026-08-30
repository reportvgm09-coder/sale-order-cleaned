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
import { ArrowLeft, IndianRupee, Truck, Package, Printer, FileSpreadsheet, FilterX, Pencil } from "lucide-react";
import { Loader } from "@/components/Loader";

const EVENT_LABEL = { exhibition: "Exhibition", door_to_door: "Door to Door" };
const BLANK = { status: "all", season: "all", event: "all", customer: "all" };

const Stat = ({ label, value, testid }) => (
  <Card data-testid={testid} className="rounded-sm border-2 border-border p-4 shadow-none">
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
    <div className="mt-1 font-display text-2xl font-extrabold tabular-nums">{value}</div>
  </Card>
);

export default function BrandHistory() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(BLANK);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const [masters, setMasters] = useState({ brands: [], exhibitions: [], salesmen: [], seasons: [] });
  const [exportOpen, setExportOpen] = useState(false);
  const { requireUnlock } = useAuth();

  const load = async () => {
    try {
      setData(await api.brandHistory(id));
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [id]); // eslint-disable-line

  // Master lists power the Edit dialog's dropdowns; they don't change per brand.
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

  // A brand row is one order LINE, so it doesn't carry the whole order. Fetch
  // the full order on click, then hand it to the shared dialogs.
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

  const orders = useMemo(() => data?.orders || [], [data]);

  const seasonOpts = useMemo(() => Array.from(new Set(orders.map((o) => o.season || "No Season"))).sort(), [orders]);
  const eventOpts = useMemo(() => Array.from(new Set(orders.map((o) => o.event_type))).filter(Boolean), [orders]);
  const customerOpts = useMemo(() => Array.from(new Set(orders.map((o) => o.customer || "Unassigned"))).sort(), [orders]);

  const filtered = useMemo(
    () =>
      orders.filter(
        (o) =>
          (filters.status === "all" || o.status === filters.status) &&
          (filters.season === "all" || (o.season || "No Season") === filters.season) &&
          (filters.event === "all" || o.event_type === filters.event) &&
          (filters.customer === "all" || (o.customer || "Unassigned") === filters.customer)
      ),
    [orders, filters]
  );

  const fTotals = useMemo(
    () =>
      filtered.reduce(
        (a, o) => ({
          ordered: a.ordered + o.ordered,
          dispatched: a.dispatched + o.dispatched,
          pending: a.pending + o.pending,
          amount: a.amount + o.amount,
          dispatched_value: a.dispatched_value + (o.dispatched_value || 0),
        }),
        { ordered: 0, dispatched: 0, pending: 0, amount: 0, dispatched_value: 0 }
      ),
    [filtered]
  );

  const setF = (patch) => setFilters((p) => ({ ...p, ...patch }));
  const activeFilters = Object.values(filters).filter((v) => v !== "all").length;

  if (loading) return <Loader label="Loading brand ledger…" />;
  if (!data) return <div className="text-sm text-muted-foreground">Brand not found.</div>;

  const { brand, timeline, summary } = data;

  const exportSheets = [
    {
      name: "Summary",
      data: [
        { Field: "Brand", Value: brand.name },
        { Field: "Rate", Value: brand.rate || 0 },
        { Field: "Orders", Value: summary.order_count },
        { Field: "Customers", Value: summary.customer_count },
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
      name: "Orders",
      data: filtered,
      columns: [
        { key: "Sale Order", get: (o) => o.id },
        { key: "Order Date", get: (o) => xlDate(o.order_date) },
        { key: "Dispatch Date", get: (o) => xlDate(o.dispatch_date) },
        { key: "Customer", get: (o) => o.customer || "" },
        { key: "City", get: (o) => o.city || "" },
        { key: "Event", get: (o) => EVENT_LABEL[o.event_type] || o.event_type || "" },
        { key: "Via", get: (o) => o.exhibition || o.salesman || "" },
        { key: "Line", get: (o) => o.line || "" },
        { key: "Season", get: (o) => o.season || "" },
        { key: "Rate", get: (o) => o.rate },
        { key: "Ordered", get: (o) => o.ordered },
        { key: "Dispatched", get: (o) => o.dispatched },
        { key: "Pending", get: (o) => o.pending },
        { key: "Order Value (INR)", get: (o) => o.amount },
        { key: "Dispatched Value (INR)", get: (o) => o.dispatched_value || 0 },
        { key: "Order Pcs (All Brands)", get: (o) => o.order_qty },
        { key: "Order Status", get: (o) => o.status },
        { key: "Order State", get: (o) => o.state },
      ],
    },
    {
      name: "Dispatch Timeline",
      data: timeline,
      columns: [
        { key: "Dispatch", get: (d) => d.id },
        { key: "Sale Order", get: (d) => d.sale_order_id },
        { key: "Customer", get: (d) => d.customer || "" },
        { key: "Date", get: (d) => xlDate(d.dispatch_date) },
        { key: "Qty", get: (d) => d.qty },
        { key: "Actual Amount (INR)", get: (d) => (d.value == null ? "" : d.value) },
      ],
    },
  ];

  return (
    <div className="space-y-6" data-testid="brand-history-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button data-testid="brand-history-back-btn" variant="ghost" size="sm" onClick={() => navigate("/brands")} className="mb-2 gap-1 no-print">
            <ArrowLeft className="h-4 w-4" /> All Brands
          </Button>
          <h1 className="font-display text-3xl font-extrabold tracking-tight" data-testid="brand-history-name">{brand.name}</h1>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <IndianRupee className="h-3.5 w-3.5" /> General rate {inr(brand.rate)}
          </p>
        </div>
        <div className="flex gap-2 no-print">
          <Button data-testid="brand-export-btn" variant="outline" onClick={() => setExportOpen(true)} className="gap-2 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" /> Export Statement
          </Button>
          <Button data-testid="brand-print-btn" variant="outline" onClick={() => window.print()} className="gap-2 rounded-sm">
            <Printer className="h-4 w-4" /> Print / PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat testid="brand-stat-orders" label="Orders" value={num(summary.order_count)} />
        <Stat testid="brand-stat-customers" label="Customers" value={num(summary.customer_count)} />
        <Stat testid="brand-stat-ordered" label="Pieces Ordered" value={num(summary.ordered)} />
        <Stat testid="brand-stat-pending" label="Pending Pieces" value={num(summary.pending)} />
        <Stat testid="brand-stat-amount" label="Order Value" value={inr(summary.amount)} />
        <Stat testid="brand-stat-dispatched-value" label="Dispatched Value" value={inr(summary.dispatched_value || 0)} />
      </div>

      {/* Orders carrying this brand */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="brand-orders">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Order History</h2>
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {orders.length} orders — figures are this brand&rsquo;s share only
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print" data-testid="brand-ledger-filters">
            <Select value={filters.customer} onValueChange={(v) => setF({ customer: v })}>
              <SelectTrigger data-testid="brand-filter-customer" className="h-9 w-40 rounded-sm border-2"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customerOpts.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setF({ status: v })}>
              <SelectTrigger data-testid="brand-filter-order-status" className="h-9 w-32 rounded-sm border-2"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.season} onValueChange={(v) => setF({ season: v })}>
              <SelectTrigger data-testid="brand-filter-season" className="h-9 w-36 rounded-sm border-2"><SelectValue placeholder="Season" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Seasons</SelectItem>
                {seasonOpts.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filters.event} onValueChange={(v) => setF({ event: v })}>
              <SelectTrigger data-testid="brand-filter-event" className="h-9 w-36 rounded-sm border-2"><SelectValue placeholder="Event" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                {eventOpts.map((e) => <SelectItem key={e} value={e}>{EVENT_LABEL[e] || e}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeFilters > 0 && (
              <Button data-testid="brand-filter-clear" variant="outline" size="sm" onClick={() => setFilters(BLANK)} className="h-9 gap-1 rounded-sm">
                <FilterX className="h-4 w-4" /> Reset
              </Button>
            )}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {orders.length === 0 ? "This brand is not on any order yet." : "No orders match these filters."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/60">
                  <TableHead className="text-xs uppercase tracking-widest">Order</TableHead>
                  <TableHead className="text-xs uppercase tracking-widest">Order Date</TableHead>
                  <TableHead className="text-xs uppercase tracking-widest">Customer</TableHead>
                  <TableHead className="text-xs uppercase tracking-widest">Event / Season</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Rate</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Ordered</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Dispatched</TableHead>
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
                    data-testid={`brand-order-${o.id}`}
                  >
                    <TableCell className="font-mono font-semibold">{o.id}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(o.order_date)}</TableCell>
                    <TableCell className="text-sm">
                      {o.customer_id ? (
                        <button
                          type="button"
                          data-testid={`brand-order-customer-${o.id}`}
                          onClick={() => navigate(`/customers/${o.customer_id}`)}
                          className="text-left font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {o.customer || "Unassigned"}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">Unassigned</span>
                      )}
                      <div className="text-xs text-muted-foreground">{o.city || "—"}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div>{EVENT_LABEL[o.event_type] || o.event_type}</div>
                      <div className="text-xs text-muted-foreground">{(o.line || o.exhibition || o.salesman || "—")}{o.season ? ` · ${o.season}` : ""}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{inr(o.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {num(o.ordered)}
                      <div className="text-xs text-muted-foreground">of {num(o.order_qty)} pcs</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num(o.dispatched)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(o.pending)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(o.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{inr(o.dispatched_value || 0)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={o.status} />
                        <StateBadge state={o.state} />
                      </div>
                    </TableCell>
                    <TableCell className="text-right no-print">
                      <div className="flex justify-end gap-1">
                        <Button
                          data-testid={`brand-edit-btn-${o.id}`}
                          variant="outline"
                          size="sm"
                          disabled={busy === `${o.id}:edit`}
                          onClick={() => requireUnlock(() => openFor(o.id, "edit"))}
                          className="gap-1 rounded-sm"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          data-testid={`brand-dispatch-btn-${o.id}`}
                          variant={o.pending > 0 ? "default" : "outline"}
                          size="sm"
                          disabled={o.pending <= 0 || busy === `${o.id}:dispatch`}
                          onClick={() => openFor(o.id, "dispatch")}
                          className="gap-1 rounded-sm"
                        >
                          <Truck className="h-3.5 w-3.5" /> Dispatch
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="brand-orders-total-row">
                  <TableCell colSpan={5}>Grand Total ({filtered.length})</TableCell>
                  <TableCell className="text-right tabular-nums">{num(fTotals.ordered)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(fTotals.dispatched)}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{num(fTotals.pending)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(fTotals.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{inr(fTotals.dispatched_value)}</TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Dispatch timeline */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="brand-timeline">
        <div className="flex items-center gap-2 border-b border-border p-4">
          <Truck className="h-4 w-4 text-primary" />
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Dispatch Timeline</h2>
            <p className="text-xs text-muted-foreground">Every dispatch that carried this brand, whatever else went with it</p>
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
                <li key={d.id} className="mb-5 ml-6" data-testid={`brand-timeline-item-${d.id}`}>
                  <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full border-2 border-primary bg-white" />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold">{fmtDate(d.dispatch_date)}</span>
                    <span className="rounded-sm border border-border px-2 py-0.5 font-mono text-xs">{d.sale_order_id}</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">{num(d.qty)} pcs dispatched</span>
                    {d.value != null && (
                      <span className="rounded-sm border border-border px-2 py-0.5 text-xs font-semibold tabular-nums">{inr(d.value)}</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{d.customer || "Unassigned"}</div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="brand-statement"
        title="Export statement"
        fileName={`brand-${brand.name.replace(/[^a-z0-9]+/gi, "-")}-${today()}.xlsx`}
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
