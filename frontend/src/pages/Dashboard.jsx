import { useEffect, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { inr, num, fmtDate, xlDate, today } from "@/lib/format";
import { ExportDialog } from "@/components/ExportDialog";
import { StatusBadge, StateBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Loader } from "@/components/Loader";
import { useMoreRows } from "@/components/MoreRows";
import { useAuth } from "@/context/Auth";
import { toast } from "sonner";
import { MonthChart, StatusCard, TopPending } from "@/components/DashboardCharts";
import { FileSpreadsheet, ShoppingCart, Boxes, IndianRupee, AlertTriangle, FilterX, RefreshCw, Clock, SlidersHorizontal, ChevronDown } from "lucide-react";

// Shown instead of a blank crash when the API call fails - the dashboard is the
// landing page, so a failure here used to take the whole app down.
const ConnectionError = ({ message, onRetry }) => (
  <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 px-6 text-center" data-testid="dashboard-error">
    <div className="flex h-12 w-12 items-center justify-center rounded-sm border-2 border-destructive/40 bg-destructive/10 text-destructive">
      <AlertTriangle className="h-6 w-6" />
    </div>
    <div>
      <h2 className="font-display text-xl font-extrabold tracking-tight">Could not reach the backend</h2>
      <p className="mt-1 text-sm text-muted-foreground">The dashboard has no data because the request to the API failed.</p>
    </div>
    {message && (
      <p className="max-w-lg rounded-sm border-2 border-border bg-secondary/60 px-3 py-2 font-mono text-xs" data-testid="dashboard-error-detail">
        {message}
      </p>
    )}
    <ul className="max-w-lg space-y-1.5 text-left text-sm text-muted-foreground">
      <li>· Check the <span className="font-semibold text-foreground">Sale Order - Backend</span> window is still open. If it never opened, run <span className="font-mono text-foreground">start-app.bat</span> again.</li>
      <li>· If that window shows a MongoDB timeout, the database is unreachable — check <span className="font-mono text-foreground">MONGO_URL</span> in <span className="font-mono text-foreground">backend\.env</span>, and that your Atlas cluster is running and your IP is allowed under Network Access.</li>
      <li>· A free Atlas cluster pauses itself after a long idle period — open the Atlas dashboard and resume it if so.</li>
    </ul>
    <Button onClick={onRetry} className="gap-2 rounded-sm" data-testid="dashboard-retry">
      <RefreshCw className="h-4 w-4" /> Try again
    </Button>
  </div>
);

// A headline figure. `tone` colours the icon and the strip down the left edge.
const TONES = {
  green: { icon: "bg-accent text-primary", strip: "bg-primary" },
  amber: { icon: "bg-amber-100 text-amber-700", strip: "bg-amber-500" },
  red: { icon: "bg-red-100 text-red-700", strip: "bg-red-500" },
  slate: { icon: "bg-secondary text-foreground/70", strip: "bg-foreground/25" },
};
const StatCard = ({ label, value, hint, icon: Icon, testid, tone = "green", className = "" }) => (
  <Card data-testid={testid} className={`relative overflow-hidden rounded-lg border-border p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5 ${className}`}>
    <span className={`absolute inset-y-0 left-0 w-1 ${TONES[tone].strip}`} aria-hidden="true" />
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:text-[11px] sm:tracking-[0.18em]">{label}</div>
        <div className="mt-1.5 truncate font-display text-2xl font-extrabold leading-tight tracking-tight tabular-nums text-foreground sm:text-[1.7rem]">{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg sm:flex ${TONES[tone].icon}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </Card>
);

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  // On a phone the six filters filled the first screen before any figure, so
  // there they fold behind a button. A laptop always shows them.
  const [showFilters, setShowFilters] = useState(false);
  const { seesMoney } = useAuth();
  const [masters, setMasters] = useState({ customers: [], brands: [], seasons: [] });
  const [filters, setFilters] = useState({ customer_id: "all", brand_id: "all", season_id: "all", event_type: "all", city: "all", overdue_only: false });

  const load = async (f) => {
    try {
      const params = {};
      if (f.customer_id !== "all") params.customer_id = f.customer_id;
      if (f.brand_id !== "all") params.brand_id = f.brand_id;
      if (f.season_id !== "all") params.season_id = f.season_id;
      if (f.event_type !== "all") params.event_type = f.event_type;
      if (f.city !== "all") params.city = f.city;
      if (f.overdue_only) params.overdue_only = true;
      setData(await api.dashboard(params));
      setError(null);
    } catch (e) {
      setError(apiErr(e));
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    setLoading(true);
    load(filters);
  };

  useEffect(() => {
    (async () => {
      try {
        const [c, b, s] = await Promise.all([api.listMasters("customers"), api.listMasters("brands"), api.listMasters("seasons")]);
        setMasters({ customers: c, brands: b, seasons: s });
      } catch (e) {
        /* non-blocking */
      }
    })();
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters]);

  const setF = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  const resetF = () => setFilters({ customer_id: "all", brand_id: "all", season_id: "all", event_type: "all", city: "all", overdue_only: false });
  const activeCount = Object.entries(filters).filter(([k, v]) => (k === "overdue_only" ? v : v !== "all")).length;
  const cityOpts = Array.from(new Set(masters.customers.map((c) => c.city).filter(Boolean))).sort();

  const exportSheets = [
    {
      name: "Open Orders",
      data: data?.open_orders || [],
      stateOf: (o) => o.state,
      columns: [
        { key: "Sale Order", get: (o) => o.id },
        { key: "Customer", get: (o) => o.customer },
        { key: "City", get: (o) => o.city || "" },
        { key: "Order Date", get: (o) => xlDate(o.order_date) },
        { key: "Dispatch Date", get: (o) => xlDate(o.dispatch_date) },
        { key: "Ordered", get: (o) => o.ordered_qty },
        { key: "Dispatched", get: (o) => o.dispatched_qty },
        { key: "Pending", get: (o) => o.pending_qty },
        { key: "Amount", get: (o) => o.amount, money: true },
        { key: "Status", get: (o) => o.status },
        { key: "Overdue", get: (o) => (o.overdue ? "Yes" : "No") },
      ],
    },
    {
      name: "Pending by Customer",
      data: data?.by_customer || [],
      columns: [
        { key: "Customer", get: (r) => r.name },
        { key: "Pending Pcs", get: (r) => r.qty },
      ],
    },
    {
      name: "Pending by Brand",
      data: data?.by_brand || [],
      columns: [
        { key: "Brand", get: (r) => r.name },
        { key: "Pending Pcs", get: (r) => r.qty },
      ],
    },
    {
      name: "Pending by Season",
      data: data?.by_season || [],
      columns: [
        { key: "Season", get: (r) => r.name },
        { key: "Pending Pcs", get: (r) => r.qty },
      ],
    },
  ];

  const { shown: openShown, moreRow } = useMoreRows(data?.open_orders || []);

  if (loading) return <Loader label="Loading ledger…" />;
  if (!data) return <ConnectionError message={error} onRetry={retry} />;

  const openTotals = (data.open_orders || []).reduce(
    (a, o) => ({ ordered: a.ordered + o.ordered_qty, pending: a.pending + o.pending_qty, amount: a.amount + o.amount }),
    { ordered: 0, pending: 0, amount: 0 }
  );

  return (
    <div className="space-y-6" data-testid="dashboard-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Overview of pending dispatches across all sale orders.</p>
        </div>
        <Button data-testid="export-report-btn" onClick={() => setExportOpen(true)} className="w-full gap-2 rounded-lg sm:w-auto">
          <FileSpreadsheet className="h-4 w-4" /> Export Report to Excel
        </Button>
      </div>

      {/* Filters */}
      <Button
        data-testid="dash-filters-toggle"
        variant="outline"
        onClick={() => setShowFilters((v) => !v)}
        className="h-11 w-full justify-between rounded-lg sm:hidden"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" /> Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${showFilters ? "rotate-180" : ""}`} />
      </Button>
      <Card className={`rounded-lg border-border p-4 shadow-sm ${showFilters ? "block" : "hidden"} sm:block`} data-testid="dashboard-filters">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div className="col-span-2 sm:min-w-[160px]">
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Customer</Label>
            <Select value={filters.customer_id} onValueChange={(v) => setF({ customer_id: v })}>
              <SelectTrigger data-testid="dash-filter-customer" className="h-10 rounded-md sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {masters.customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:min-w-[150px]">
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Brand</Label>
            <Select value={filters.brand_id} onValueChange={(v) => setF({ brand_id: v })}>
              <SelectTrigger data-testid="dash-filter-brand" className="h-10 rounded-md sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {masters.brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:min-w-[150px]">
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Season</Label>
            <Select value={filters.season_id} onValueChange={(v) => setF({ season_id: v })}>
              <SelectTrigger data-testid="dash-filter-season" className="h-10 rounded-md sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Seasons</SelectItem>
                {masters.seasons.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:min-w-[150px]">
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Event Type</Label>
            <Select value={filters.event_type} onValueChange={(v) => setF({ event_type: v })}>
              <SelectTrigger data-testid="dash-filter-event" className="h-10 rounded-md sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Events</SelectItem>
                <SelectItem value="exhibition">Exhibition</SelectItem>
                <SelectItem value="door_to_door">Door to Door</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:min-w-[150px]">
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">City</Label>
            <Select value={filters.city} onValueChange={(v) => setF({ city: v })}>
              <SelectTrigger data-testid="dash-filter-city" className="h-10 rounded-md sm:h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cities</SelectItem>
                {cityOpts.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex h-10 items-center gap-2 rounded-md border border-border px-3 sm:h-9">
            <Switch data-testid="dash-filter-overdue" checked={filters.overdue_only} onCheckedChange={(v) => setF({ overdue_only: v })} />
            <Label className="text-xs font-medium">Overdue only</Label>
          </div>
          {activeCount > 0 && (
            <Button data-testid="dash-filter-reset" variant="outline" size="sm" onClick={resetF} className="col-span-2 h-10 gap-1 rounded-md sm:h-9">
              <FilterX className="h-4 w-4" /> Reset ({activeCount})
            </Button>
          )}
        </div>
      </Card>

      {data.overdue_count > 0 && (
        <div data-testid="overdue-alert" className="flex items-center gap-3 rounded-sm border-2 border-red-200 bg-red-50 p-4 text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <div className="text-sm">
            <span className="font-display font-bold">Needs attention:</span> {num(data.overdue_count)} order{data.overdue_count > 1 ? "s are" : " is"} past the expected dispatch date with pieces still pending.
          </div>
        </div>
      )}

      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${seesMoney ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <StatCard testid="stat-total-orders" label="Sale Orders" value={num(data.total_orders)} hint="not counting cancelled" icon={ShoppingCart} tone="green" />
        <StatCard
          testid="stat-pending-orders"
          label="Still to dispatch"
          value={num(data.orders_with_pending)}
          hint={`${num(data.pending_pieces)} pieces waiting`}
          icon={Boxes}
          tone="amber"
        />
        <StatCard
          testid="stat-overdue"
          className="col-span-2 sm:col-span-1"
          label="Overdue"
          value={num(data.overdue_count)}
          hint="past their dispatch date"
          icon={Clock}
          tone={data.overdue_count > 0 ? "red" : "slate"}
        />
        {seesMoney && <StatCard testid="stat-pending-value" label="Pending Value (est.)" value={inr(data.pending_value)} hint="at order rates" icon={IndianRupee} tone="green" className="col-span-2 sm:col-span-1" />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MonthChart rows={data.by_month} />
        <StatusCard mix={data.status_mix} ordered={data.ordered_pieces} dispatched={data.dispatched_pieces} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TopPending testid="pending-by-brand" title="Pending by Brand" subtitle="Pieces still to send - the top ten" rows={data.by_brand} />
        <TopPending testid="pending-by-customer" title="Pending by Customer" subtitle="Pieces still to send - the top ten" rows={data.by_customer} />
        <TopPending testid="pending-by-season" title="Pending by Season" subtitle="Pieces still to send" rows={data.by_season || []} />
      </div>

      <Card className="rounded-lg border-border shadow-sm" data-testid="open-orders-card">
        <div className="border-b border-border p-4">
          <h3 className="font-display text-base font-bold tracking-tight">Orders With Pending Dispatch</h3>
          <p className="text-xs text-muted-foreground">Sorted by expected dispatch date</p>
        </div>
        {data.open_orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No open orders right now.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">Order</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Customer</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Dispatch By</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Ordered</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending</TableHead>
                {seesMoney && <TableHead className="text-right text-xs uppercase tracking-widest">Amount</TableHead>}
                <TableHead className="text-xs uppercase tracking-widest">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openShown.map((o) => (
                <TableRow key={o.id} className={`hover:bg-secondary/40 ${o.overdue ? "bg-red-50 hover:bg-red-100" : ""}`} data-testid={`open-order-${o.id}`}>
                  <TableCell className="font-mono font-semibold">{o.id}</TableCell>
                  <TableCell>{o.customer}{o.city ? <span className="ml-1 text-xs text-muted-foreground">· {o.city}</span> : null}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-2">
                      {fmtDate(o.dispatch_date)}
                      {o.overdue && (
                        <span data-testid={`overdue-badge-${o.id}`} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Overdue
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{num(o.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(o.pending_qty)}</TableCell>
                  {seesMoney && <TableCell className="text-right tabular-nums">{inr(o.amount)}</TableCell>}
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={o.status} />
                      <StateBadge state={o.state} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {moreRow(seesMoney ? 7 : 6)}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="open-orders-total-row">
                <TableCell colSpan={3}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(openTotals.ordered)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(openTotals.pending)}</TableCell>
                {seesMoney && <TableCell className="text-right tabular-nums">{inr(openTotals.amount)}</TableCell>}
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="dashboard"
        fileName={`order-ledger-report-${today()}.xlsx`}
        sheets={exportSheets}
      />
    </div>
  );
}
