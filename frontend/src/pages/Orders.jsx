import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErr } from "@/lib/api";
import { inr, num, fmtDate, today, xlDate } from "@/lib/format";
import { stateLabel, stateRowClass } from "@/lib/orderState";
import { ExportDialog } from "@/components/ExportDialog";
import { StatusBadge, StateBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Loader } from "@/components/Loader";
import { toast } from "sonner";
import { Table as TableIcon, FileSpreadsheet, FilterX, Filter, ArrowUp, ArrowDown, Columns3 } from "lucide-react";

const EVENT_LABEL = { exhibition: "Exhibition", door_to_door: "Door to Door" };
const STATUS_LABEL = { pending: "Pending", partial: "Partial", done: "Done" };

/** How much of an order has gone out. The one place this is worked out, so the
 *  bar and the number beside it can never disagree. */
const pctOf = (ordered, dispatched) => (ordered > 0 ? Math.min(100, Math.round((dispatched / ordered) * 100)) : 0);

const Meter = ({ pct, bar = "w-16" }) => (
  <div className="flex items-center gap-1.5">
    <div className={`h-1.5 ${bar} overflow-hidden rounded-full bg-secondary`}>
      <div
        className={`h-full rounded-full transition-all ${pct >= 100 ? "bg-emerald-600" : "bg-primary"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
    <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
  </div>
);

// Every column is described once here, and the heading, its filter, each body
// cell, the column picker and the grand total all read from it. Adding a column
// in one place and forgetting another is what silently shifts every figure one
// column across.
//
//   filter  "list" tick the values you want, like Excel's column filter
//           "text" contains, case-insensitive
//           "num"  smallest / largest
//           "date" from / to, inclusive - dates are stored as YYYY-MM-DD so
//                  plain string comparison is already chronological
//           null   not filterable
//   total   gets a figure in the grand total row. `totalCell` overrides how it
//           is worked out - a percentage cannot simply be added up.
const COLUMNS = [
  { key: "id", label: "Order ID", filter: "text", cell: (r) => <span className="font-mono font-semibold">{r.id}</span> },
  { key: "order_date", label: "Order Date", filter: "date", date: true, cell: (r) => fmtDate(r.order_date) },
  {
    key: "dispatch_date",
    label: "Dispatch By",
    filter: "date",
    date: true,
    // Overdue is the same rule the dashboard uses: the date has passed and
    // pieces are still owed.
    cell: (r) => <span className={r.overdue ? "font-semibold text-amber-700" : ""}>{fmtDate(r.dispatch_date)}</span>,
  },
  { key: "customer", label: "Customer", filter: "list" },
  { key: "city", label: "City", filter: "list" },
  { key: "event", label: "Event", filter: "list" },
  { key: "source", label: "Exhibition / Salesman", filter: "list" },
  { key: "line", label: "Line", filter: "list" },
  { key: "season", label: "Season", filter: "list" },
  {
    key: "brands",
    label: "Brands",
    filter: "text",
    cell: (r) => (
      <span className="block max-w-[190px] truncate text-muted-foreground" title={r.brands}>
        {r.brands || "—"}
      </span>
    ),
  },
  { key: "ordered", label: "Ordered", filter: "num", align: "right", total: true, cell: (r) => num(r.ordered) },
  { key: "dispatched", label: "Dispatched", filter: "num", align: "right", total: true, cell: (r) => <span className="text-muted-foreground">{num(r.dispatched)}</span> },
  { key: "pending", label: "Pending", filter: "num", align: "right", total: true, cell: (r) => <span className="font-semibold text-amber-700">{num(r.pending)}</span> },
  {
    key: "pct",
    label: "Dispatched %",
    filter: "num",
    total: true,
    cell: (r) => <Meter pct={r.pct} />,
    // Percentages don't add up - the total is the whole grid's own ratio.
    totalCell: (t) => <Meter pct={pctOf(t.ordered || 0, t.dispatched || 0)} />,
  },
  { key: "amount", label: "Order Value", filter: "num", align: "right", total: true, money: true, cell: (r) => inr(r.amount) },
  { key: "pending_value", label: "Pending Value", filter: "num", align: "right", total: true, money: true, cell: (r) => inr(r.pending_value) },
  { key: "status", label: "Status", filter: "list", cell: (r) => <StatusBadge status={r.status_key} /> },
  {
    key: "state",
    label: "State",
    filter: "list",
    // An open order carries no badge, but the filter still lists "Open" so the
    // ones nobody has marked can be picked out.
    cell: (r) =>
      r.state_key === "open" ? <span className="text-muted-foreground">—</span> : <StateBadge state={r.state_key} />,
  },
];

const EMPTY = { list: [], text: "", num: { min: "", max: "" }, date: { from: "", to: "" } };

const blankFilters = () => Object.fromEntries(COLUMNS.filter((c) => c.filter).map((c) => [c.key, EMPTY[c.filter]]));

// Like the export dialog, what gets remembered is what you turned OFF. If it
// stored your selection instead, a column added to the app later would be
// missing from your grid forever and you would never know it existed.
const COLS_KEY = "orders_hidden_columns";

const loadHidden = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((k) => COLUMNS.some((c) => c.key === k)) : [];
  } catch {
    return [];
  }
};

const isSet = (col, v) => {
  switch (col.filter) {
    case "list":
      return Array.isArray(v) && v.length > 0;
    case "text":
      return String(v ?? "") !== "";
    case "num":
      return (v?.min ?? "") !== "" || (v?.max ?? "") !== "";
    case "date":
      return !!(v?.from || v?.to);
    default:
      return false;
  }
};

const matches = (col, row, v) => {
  if (!isSet(col, v)) return true;
  const cell = row[col.key];
  switch (col.filter) {
    case "list":
      return v.includes(String(cell ?? ""));
    case "text":
      return String(cell ?? "").toLowerCase().includes(String(v).toLowerCase());
    case "num": {
      const n = Number(cell) || 0;
      if (v.min !== "" && n < Number(v.min)) return false;
      if (v.max !== "" && n > Number(v.max)) return false;
      return true;
    }
    case "date": {
      if (!cell) return false;
      if (v.from && cell < v.from) return false;
      if (v.to && cell > v.to) return false;
      return true;
    }
    default:
      return true;
  }
};

/** The funnel on a column heading. Filled in once that column is filtering. */
function ColumnFilter({ col, value, options, onChange, testid }) {
  const [open, setOpen] = useState(false);
  const active = isSet(col, value);
  const clear = () => onChange(EMPTY[col.filter]);
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter((x) => x !== opt) : [...value, opt]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testid}
          title={active ? "Filtered — click to change" : "Filter this column"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            active
              ? "border-primary bg-primary text-primary-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-background"
          }`}
        >
          <Filter className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 rounded-sm border-2 p-0" data-testid={`${testid}-panel`}>
        <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-2 py-1.5">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{col.label}</span>
          <button
            type="button"
            data-testid={`${testid}-clear`}
            onClick={clear}
            disabled={!active}
            className="text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {col.filter === "list" && (
          <Command>
            <CommandInput placeholder="Search…" className="h-8 text-xs" data-testid={`${testid}-search`} />
            <CommandList className="max-h-56">
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">Nothing found.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o} value={o} onSelect={() => toggle(o)} className="gap-2 rounded-sm py-1 text-xs">
                    <Checkbox checked={value.includes(o)} className="pointer-events-none" />
                    <span className="truncate">{o}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}

        {col.filter === "text" && (
          <div className="p-2">
            <Input
              autoFocus
              data-testid={`${testid}-text`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Contains…"
              className="h-8 rounded-sm text-xs"
            />
          </div>
        )}

        {col.filter === "num" && (
          <div className="flex items-center gap-1.5 p-2">
            <Input
              autoFocus
              data-testid={`${testid}-min`}
              type="number"
              value={value.min}
              onChange={(e) => onChange({ ...value, min: e.target.value })}
              placeholder="Smallest"
              className="h-8 rounded-sm text-right text-xs"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              data-testid={`${testid}-max`}
              type="number"
              value={value.max}
              onChange={(e) => onChange({ ...value, max: e.target.value })}
              placeholder="Largest"
              className="h-8 rounded-sm text-right text-xs"
            />
          </div>
        )}

        {col.filter === "date" && (
          <div className="space-y-1.5 p-2">
            <Input
              data-testid={`${testid}-from`}
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="h-8 rounded-sm text-xs"
            />
            <Input
              data-testid={`${testid}-to`}
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="h-8 rounded-sm text-xs"
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function Orders() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(blankFilters);
  const [hidden, setHidden] = useState(loadHidden);
  const [sort, setSort] = useState({ key: "order_date", dir: "desc" });
  const [exportOpen, setExportOpen] = useState(false);
  const navigate = useNavigate();

  const tableRef = useRef(null);
  const topScrollRef = useRef(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // The order list carries ids, not names, so the master lists are needed
        // to make it readable. One round of requests, then everything below is
        // in-memory - this page never goes back to the server to filter.
        const [orders, customers, brands, exhibitions, salesmen, seasons, lineList] = await Promise.all([
          api.listSaleOrders(),
          api.listMasters("customers"),
          api.listMasters("brands"),
          api.listMasters("exhibitions"),
          api.listMasters("salesmen"),
          api.listMasters("seasons"),
          api.listMasters("lines"),
        ]);
        const nameOf = (list) => Object.fromEntries(list.map((m) => [m.id, m.name]));
        const cust = Object.fromEntries(customers.map((c) => [c.id, c]));
        const brandName = nameOf(brands);
        const exhName = nameOf(exhibitions);
        const smName = nameOf(salesmen);
        const seasonName = nameOf(seasons);
        const lineName = nameOf(lineList);
        const todayStr = today();

        setRows(
          orders.map((o) => {
            const t = o.totals || {};
            const c = cust[o.customer_id];
            const doorToDoor = (o.event_type || "exhibition") === "door_to_door";
            return {
              id: o.id,
              customer_id: o.customer_id,
              order_date: o.order_date || "",
              dispatch_date: o.dispatch_date || "",
              customer: c?.name || "Unassigned",
              city: c?.city || "",
              event: EVENT_LABEL[o.event_type] || EVENT_LABEL.exhibition,
              source: (doorToDoor ? smName[o.salesman_id] : exhName[o.exhibition_id]) || "",
              line: (doorToDoor ? lineName[o.line_id] : "") || "",
              season: seasonName[o.season_id] || "",
              brands: Array.from(new Set((o.items || []).map((it) => brandName[it.brand_id] || "Unknown"))).join(", "),
              ordered: t.ordered_qty || 0,
              dispatched: t.dispatched_qty || 0,
              pending: t.pending_qty || 0,
              pct: pctOf(t.ordered_qty || 0, t.dispatched_qty || 0),
              amount: t.amount || 0,
              pending_value: t.pending_value || 0,
              status_key: t.status || "pending",
              status: STATUS_LABEL[t.status] || STATUS_LABEL.pending,
              state_key: o.state || "open",
              state: stateLabel(o.state),
              overdue: !!(o.dispatch_date && o.dispatch_date < todayStr && (t.pending_qty || 0) > 0),
            };
          })
        );
      } catch (e) {
        toast.error(apiErr(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(hidden));
    } catch {
      /* private browsing or a full quota - the grid still works, it just won't be remembered */
    }
  }, [hidden]);

  const visible = useMemo(() => COLUMNS.filter((c) => !hidden.includes(c.key)), [hidden]);

  const filtered = useMemo(
    () => rows.filter((r) => COLUMNS.every((c) => !c.filter || matches(c, r, filters[c.key]))),
    [rows, filters]
  );

  // A column's own choices are built from the rows the OTHER filters leave
  // behind, so ticking one can never land you on an empty table.
  const options = useMemo(() => {
    const out = {};
    visible
      .filter((c) => c.filter === "list")
      .forEach((col) => {
        const others = rows.filter((r) => COLUMNS.every((c) => c.key === col.key || !c.filter || matches(c, r, filters[c.key])));
        const seen = new Set(others.map((r) => r[col.key]).filter(Boolean));
        // Keep anything already ticked on the list, or it would vanish mid-use.
        (filters[col.key] || []).forEach((v) => seen.add(v));
        out[col.key] = Array.from(seen).sort();
      });
    return out;
  }, [rows, filters, visible]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const numeric = col.filter === "num";
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (numeric) return ((Number(x) || 0) - (Number(y) || 0)) * factor;
      return String(x ?? "").localeCompare(String(y ?? ""), "en") * factor;
    });
  }, [filtered, sort]);

  const totals = useMemo(
    () =>
      sorted.reduce((a, r) => {
        COLUMNS.filter((c) => c.total).forEach((c) => (a[c.key] = (a[c.key] || 0) + (Number(r[c.key]) || 0)));
        return a;
      }, {}),
    [sorted]
  );

  // The scrollbar above the grid. The Table component wraps its <table> in the
  // element that actually scrolls, so that wrapper is reached through the table
  // rather than held directly, and the two are kept in step both ways.
  useEffect(() => {
    const table = tableRef.current;
    const pane = table?.parentElement;
    if (!table || !pane) return;
    const measure = () => {
      setScrollWidth(table.scrollWidth);
      setOverflowing(table.scrollWidth > pane.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    ro.observe(pane);
    const sync = () => {
      if (topScrollRef.current) topScrollRef.current.scrollLeft = pane.scrollLeft;
    };
    pane.addEventListener("scroll", sync);
    return () => {
      ro.disconnect();
      pane.removeEventListener("scroll", sync);
    };
  }, [visible, sorted.length, rows.length]);

  const onTopScroll = (e) => {
    const pane = tableRef.current?.parentElement;
    if (pane) pane.scrollLeft = e.currentTarget.scrollLeft;
  };

  const activeCount = COLUMNS.filter((c) => c.filter && isSet(c, filters[c.key])).length;
  const setFilter = (key, value) => setFilters((p) => ({ ...p, [key]: value }));
  const clearAll = () => setFilters(blankFilters());

  // Hiding a column drops its filter too. A filter you cannot see, still
  // quietly removing rows, is how a total ends up looking wrong for no reason.
  const toggleColumn = (key) => {
    const hiding = !hidden.includes(key);
    setHidden((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
    const col = COLUMNS.find((c) => c.key === key);
    if (hiding && col?.filter) setFilter(key, EMPTY[col.filter]);
  };

  const toggleSort = (key) =>
    setSort((p) => (p.key === key ? { key, dir: p.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  const exportSheets = [
    {
      name: "Orders",
      data: sorted,
      // Every column is offered, including any hidden on screen - the export
      // dialog has its own tick list and remembers it separately.
      columns: COLUMNS.map((c) => ({
        key: c.label,
        // Real dates and raw numbers, so the spreadsheet can sort, filter and
        // total them rather than treating the column as text.
        get: (r) => (c.date ? xlDate(r[c.key]) : r[c.key] ?? ""),
      })),
    },
  ];

  if (loading) return <Loader label="Loading orders…" />;

  // The grand total must span exactly as many cells as the heading row, whatever
  // is hidden - so it is measured off the visible columns, never typed in.
  const firstTotal = visible.findIndex((c) => c.total);
  const labelSpan = firstTotal === -1 ? visible.length : firstTotal;
  const overallPct = pctOf(totals.ordered || 0, totals.dispatched || 0);

  return (
    <div className="space-y-4" data-testid="orders-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">
            Every order on one grid. Use the funnel on any heading to filter it, or click the heading to sort.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button data-testid="orders-columns-btn" variant="outline" size="sm" className="h-9 gap-2 rounded-sm">
                <Columns3 className="h-4 w-4" /> Columns
                <span className="tabular-nums text-muted-foreground">
                  {visible.length}/{COLUMNS.length}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 rounded-sm border-2 p-0" data-testid="orders-columns-panel">
              <div className="flex items-center justify-between border-b border-border bg-secondary/60 px-2 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Show columns</span>
                <button
                  type="button"
                  data-testid="orders-columns-reset"
                  onClick={() => setHidden([])}
                  disabled={hidden.length === 0}
                  className="text-[10px] font-semibold uppercase tracking-widest text-primary disabled:opacity-40"
                >
                  Show all
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto p-1">
                {COLUMNS.map((c) => {
                  const on = !hidden.includes(c.key);
                  return (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-secondary"
                    >
                      <Checkbox
                        data-testid={`orders-col-${c.key}`}
                        checked={on}
                        // Never let the last one go - an empty grid looks broken.
                        disabled={on && visible.length === 1}
                        onCheckedChange={() => toggleColumn(c.key)}
                      />
                      <span className="truncate">{c.label}</span>
                    </label>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Button
            data-testid="orders-clear-filters"
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={activeCount === 0}
            className="h-9 gap-2 rounded-sm"
          >
            <FilterX className="h-4 w-4" /> Clear {activeCount > 0 ? `${activeCount} filter${activeCount === 1 ? "" : "s"}` : "filters"}
          </Button>
          <Button data-testid="orders-export-btn" size="sm" onClick={() => setExportOpen(true)} className="h-9 gap-2 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" /> Export to Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "Orders Shown", v: num(sorted.length), t: "count" },
          { l: "Ordered", v: num(totals.ordered || 0), t: "ordered" },
          { l: "Dispatched", v: num(totals.dispatched || 0), t: "dispatched" },
          { l: "Pending", v: num(totals.pending || 0), t: "pending" },
          { l: "Order Value", v: inr(totals.amount || 0), t: "amount" },
        ].map((s) => (
          <Card key={s.t} data-testid={`orders-sum-${s.t}`} className="rounded-sm border-border px-3 py-2 shadow-none">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{s.l}</div>
            <div className="font-display text-lg font-extrabold tabular-nums">{s.v}</div>
          </Card>
        ))}
        <Card data-testid="orders-sum-pct" className="rounded-sm border-border px-3 py-2 shadow-none">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Dispatched %</div>
          <div className="font-display text-lg font-extrabold tabular-nums">{overallPct}%</div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full ${overallPct >= 100 ? "bg-emerald-600" : "bg-primary"}`}
              style={{ width: `${overallPct}%` }}
            />
          </div>
        </Card>
      </div>

      <Card className="rounded-sm border-border shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <TableIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-display text-base font-bold tracking-tight">Order Grid</h2>
          </div>
          <span className="text-xs text-muted-foreground" data-testid="orders-row-count">
            {sorted.length} of {rows.length} order{rows.length === 1 ? "" : "s"}
            {activeCount > 0 ? " · filtered" : ""}
            {hidden.length > 0 ? ` · ${hidden.length} column${hidden.length === 1 ? "" : "s"} hidden` : ""}
          </span>
        </div>

        {/* Sideways scrollbar, kept at the top so it is reachable without
            first scrolling to the bottom of a long grid. */}
        {overflowing && (
          <div
            ref={topScrollRef}
            onScroll={onTopScroll}
            data-testid="orders-top-scroll"
            className="h-4 overflow-x-auto overflow-y-hidden border-b border-border bg-secondary/30"
          >
            <div style={{ width: scrollWidth, height: 1 }} />
          </div>
        )}

        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No sale orders yet.</div>
        ) : (
          <Table ref={tableRef} className="text-xs">
            <TableHeader>
              <TableRow className="bg-secondary/60">
                {visible.map((c) => (
                  <TableHead key={c.key} className="h-8 px-2 text-[10px] uppercase tracking-widest">
                    <div className={`flex items-center gap-1 ${c.align === "right" ? "justify-end" : ""}`}>
                      <button
                        type="button"
                        data-testid={`orders-sort-${c.key}`}
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-0.5 whitespace-nowrap hover:text-foreground ${
                          sort.key === c.key ? "text-foreground" : ""
                        }`}
                      >
                        {c.label}
                        {sort.key === c.key &&
                          (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                      {c.filter && (
                        <ColumnFilter
                          col={c}
                          value={filters[c.key]}
                          options={options[c.key] || []}
                          onChange={(v) => setFilter(c.key, v)}
                          testid={`orders-filter-${c.key}`}
                        />
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visible.length} className="p-8 text-center text-sm text-muted-foreground">
                    No orders match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((r) => (
                  <TableRow
                    key={r.id}
                    className={stateRowClass(r.state_key) || "hover:bg-secondary/40"}
                    data-testid={`orders-row-${r.id}`}
                  >
                    {visible.map((c) => (
                      <TableCell
                        key={c.key}
                        className={`whitespace-nowrap px-2 py-1 ${c.align === "right" ? "text-right tabular-nums" : ""} ${
                          c.key === "customer" ? "p-0" : ""
                        }`}
                      >
                        {c.key === "customer" ? (
                          <button
                            type="button"
                            data-testid={`orders-customer-${r.id}`}
                            onClick={() => r.customer_id && navigate(`/customers/${r.customer_id}`)}
                            className="w-full px-2 py-1 text-left hover:text-primary hover:underline"
                          >
                            {r.customer}
                          </button>
                        ) : c.cell ? (
                          c.cell(r)
                        ) : (
                          r[c.key] || "—"
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}

              {sorted.length > 0 && (
                <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="orders-total-row">
                  {/* colSpan={0} is not "span nothing" in HTML, so the label cell
                      is dropped entirely when every leading column is hidden. */}
                  {labelSpan > 0 && (
                    <TableCell colSpan={labelSpan} className="px-2 py-1">
                      Grand Total
                    </TableCell>
                  )}
                  {visible.slice(labelSpan).map((c) =>
                    c.total ? (
                      <TableCell
                        key={c.key}
                        className={`whitespace-nowrap px-2 py-1 ${c.align === "right" ? "text-right tabular-nums" : ""}`}
                      >
                        {c.totalCell ? c.totalCell(totals) : c.money ? inr(totals[c.key] || 0) : num(totals[c.key] || 0)}
                      </TableCell>
                    ) : (
                      <TableCell key={c.key} />
                    )
                  )}
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="orders-grid"
        fileName={`orders-${today()}.xlsx`}
        sheets={exportSheets}
        title="Export the order grid"
        description="Exports the rows you can see now, in the order you have sorted them."
      />
    </div>
  );
}
