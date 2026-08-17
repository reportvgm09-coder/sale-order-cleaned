import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { inr, num } from "@/lib/format";
import { downloadSheet } from "@/lib/excel";
import { Loader } from "@/components/Loader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { FileSpreadsheet, TrendingUp, TrendingDown, Minus, BarChart3, LineChart as LineIcon, PieChart as PieIcon, Layers, Activity, GitCompareArrows } from "lucide-react";

const EVENT_LABEL = { exhibition: "Exhibition", door_to_door: "Door to Door" };

const DIMS = [
  { key: "customer", label: "Customer" },
  { key: "brand", label: "Brand" },
  { key: "season", label: "Season" },
  { key: "financial_year", label: "Financial Year" },
  { key: "exhibition", label: "Exhibition" },
  { key: "salesman", label: "Salesman" },
  { key: "event_type", label: "Event Type" },
];

const METRICS = [
  { key: "ordered_qty", label: "Ordered Pieces", money: false },
  { key: "dispatched_qty", label: "Dispatched Pieces", money: false },
  { key: "pending_qty", label: "Pending Pieces", money: false },
  { key: "amount", label: "Order Value", money: true },
  { key: "pending_value", label: "Pending Value", money: true },
];

const CHART_TYPES = [
  { key: "grouped", label: "Grouped Bars", icon: BarChart3 },
  { key: "stacked", label: "Stacked Bars", icon: Layers },
  { key: "line", label: "Line", icon: LineIcon },
  { key: "area", label: "Area", icon: Activity },
  { key: "radar", label: "Radar", icon: GitCompareArrows },
  { key: "pie", label: "Pie (totals)", icon: PieIcon },
];

const PALETTE = ["#002FA7", "#E8A33D", "#2E9E6B", "#C0392B", "#7D3C98", "#16A0A0", "#D35400", "#5D6D7E"];

const dimValue = (r, key) => {
  if (key === "event_type") return EVENT_LABEL[r.event_type] || r.event_type || "—";
  if (key === "season") return r.season || "No Season";
  return r[key] || "—";
};

const uniqVals = (rows, key) => Array.from(new Set(rows.map((r) => dimValue(r, key)))).sort();

export default function Compare() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.reports();
        setRows(data.rows || []);
      } catch (e) {
        toast.error(apiErr(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loader label="Analysing data…" />;

  return (
    <div className="space-y-6" data-testid="compare-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Compare & Analyse</h1>
        <p className="text-sm text-muted-foreground">Compare multiple datasets across any dimension, or find your biggest movers between two periods.</p>
      </div>

      <Tabs defaultValue="compare">
        <TabsList className="rounded-sm border-2 border-border bg-secondary/50">
          <TabsTrigger value="compare" data-testid="tab-compare" className="rounded-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Compare Datasets</TabsTrigger>
          <TabsTrigger value="movers" data-testid="tab-movers" className="rounded-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Top Movers</TabsTrigger>
        </TabsList>
        <TabsContent value="compare" className="mt-4">
          <CompareDatasets rows={rows} />
        </TabsContent>
        <TabsContent value="movers" className="mt-4">
          <TopMovers rows={rows} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const DeltaChip = ({ value, money }) => {
  if (value === 0) return <span className="inline-flex items-center gap-1 text-muted-foreground"><Minus className="h-3 w-3" /> 0</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${up ? "text-emerald-700" : "text-red-600"}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? "+" : "−"}{money ? inr(Math.abs(value)) : num(Math.abs(value))}
    </span>
  );
};

/* ------------------------- Compare Datasets (multi-series) ------------------------- */
function CompareDatasets({ rows }) {
  const [primary, setPrimary] = useState("customer");
  const [selected, setSelected] = useState([]);
  const [breakdown, setBreakdown] = useState("season");
  const [metric, setMetric] = useState("pending_qty");
  const [chartType, setChartType] = useState("grouped");

  const primaryValues = useMemo(() => uniqVals(rows, primary), [rows, primary]);

  useEffect(() => {
    setSelected(primaryValues.slice(0, Math.min(3, primaryValues.length)));
  }, [primaryValues]);

  useEffect(() => {
    if (breakdown === primary) setBreakdown(DIMS.find((d) => d.key !== primary).key);
  }, [primary]); // eslint-disable-line

  const metricDef = METRICS.find((m) => m.key === metric);
  const fmt = (v) => (metricDef.money ? inr(v) : num(v));
  const primaryLabel = DIMS.find((d) => d.key === primary)?.label;
  const breakdownLabel = DIMS.find((d) => d.key === breakdown)?.label;

  const toggle = (v) =>
    setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

  // build breakdown categories & per-series values
  const { chartData, categories, totals } = useMemo(() => {
    const cats = uniqVals(rows, breakdown);
    const table = {};
    cats.forEach((c) => (table[c] = { name: c }));
    const tot = {};
    selected.forEach((s) => (tot[s] = 0));
    rows.forEach((r) => {
      const pv = dimValue(r, primary);
      if (!selected.includes(pv)) return;
      const bv = dimValue(r, breakdown);
      const val = Number(r[metric]) || 0;
      table[bv][pv] = (table[bv][pv] || 0) + val;
      tot[pv] += val;
    });
    // ensure each category has all selected keys
    cats.forEach((c) => selected.forEach((s) => { if (table[c][s] === undefined) table[c][s] = 0; }));
    return { chartData: cats.map((c) => table[c]), categories: cats, totals: tot };
  }, [rows, primary, breakdown, metric, selected]);

  const pieData = selected.map((s) => ({ name: s, value: totals[s] || 0 }));

  const exportCompare = () => {
    downloadSheet(
      categories.map((c) => {
        const row = { [breakdownLabel]: c };
        selected.forEach((s) => (row[s] = chartData.find((d) => d.name === c)?.[s] || 0));
        return row;
      }),
      "Comparison",
      `comparison-${primary}-${metric}-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    toast.success("Comparison exported");
  };

  const tickFmt = (v) => (metricDef.money ? `₹${Number(v) >= 1000 ? (v / 1000).toFixed(0) + "k" : v}` : num(v));

  const renderChart = () => {
    if (selected.length === 0 || categories.length === 0)
      return <div className="py-16 text-center text-sm text-muted-foreground">Select at least one dataset to plot.</div>;

    if (chartType === "pie") {
      return (
        <ResponsiveContainer width="100%" height={340}>
          <PieChart>
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={120} innerRadius={60} paddingAngle={2} label={(e) => e.name}>
              {pieData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === "radar") {
      return (
        <ResponsiveContainer width="100%" height={360}>
          <RadarChart data={chartData} outerRadius={130}>
            <PolarGrid />
            <PolarAngleAxis dataKey="name" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis tick={{ fontSize: 10 }} />
            {selected.map((s, i) => (
              <Radar key={s} name={s} dataKey={s} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.25} />
            ))}
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
          </RadarChart>
        </ResponsiveContainer>
      );
    }

    if (chartType === "line" || chartType === "area") {
      const Chart = chartType === "line" ? LineChart : AreaChart;
      return (
        <ResponsiveContainer width="100%" height={340}>
          <Chart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={tickFmt} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            {selected.map((s, i) =>
              chartType === "line" ? (
                <Line key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} />
              ) : (
                <Area key={s} type="monotone" dataKey={s} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.2} />
              )
            )}
          </Chart>
        </ResponsiveContainer>
      );
    }

    // grouped / stacked bars
    return (
      <ResponsiveContainer width="100%" height={340}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={tickFmt} />
          <Tooltip formatter={(v) => fmt(v)} />
          <Legend />
          {selected.map((s, i) => (
            <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} radius={[2, 2, 0, 0]} stackId={chartType === "stacked" ? "a" : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-sm border-2 border-border p-4 shadow-none" data-testid="compare-controls">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Compare by</Label>
            <Select value={primary} onValueChange={setPrimary}>
              <SelectTrigger data-testid="compare-primary" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{DIMS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Break down by</Label>
            <Select value={breakdown} onValueChange={setBreakdown}>
              <SelectTrigger data-testid="compare-breakdown" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{DIMS.filter((d) => d.key !== primary).map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger data-testid="compare-metric" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{METRICS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {/* dataset multi-select */}
        <div className="mt-4">
          <Label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Datasets to compare ({selected.length} selected · pick 2 or more)</Label>
          <div className="flex flex-wrap gap-2" data-testid="compare-dataset-chips">
            {primaryValues.map((v) => {
              const active = selected.includes(v);
              const idx = selected.indexOf(v);
              return (
                <button
                  key={v}
                  data-testid={`compare-chip-${v}`}
                  onClick={() => toggle(v)}
                  className={`rounded-full border-2 px-3 py-1 text-xs font-medium transition-colors ${active ? "border-transparent text-white" : "border-border bg-white text-foreground hover:bg-secondary"}`}
                  style={active ? { background: PALETTE[idx % PALETTE.length] } : {}}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>

        {/* chart type */}
        <div className="mt-4">
          <Label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Chart type</Label>
          <div className="flex flex-wrap gap-2" data-testid="compare-chart-types">
            {CHART_TYPES.map((c) => {
              const Icon = c.icon;
              const active = chartType === c.key;
              return (
                <button
                  key={c.key}
                  data-testid={`chart-type-${c.key}`}
                  onClick={() => setChartType(c.key)}
                  className={`inline-flex items-center gap-1.5 rounded-sm border-2 px-3 py-1.5 text-xs font-medium transition-colors ${active ? "border-primary bg-accent text-primary" : "border-border bg-white text-muted-foreground hover:text-foreground"}`}
                >
                  <Icon className="h-3.5 w-3.5" /> {c.label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6" data-testid="compare-totals">
        {selected.map((s, i) => (
          <Card key={s} className="rounded-sm border-2 p-3 shadow-none" style={{ borderColor: PALETTE[i % PALETTE.length] }} data-testid={`compare-total-${s}`}>
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.15em]" style={{ color: PALETTE[i % PALETTE.length] }}>{s}</div>
            <div className="mt-1 font-display text-xl font-extrabold tabular-nums">{fmt(totals[s] || 0)}</div>
          </Card>
        ))}
      </div>

      {/* chart */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="compare-chart">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">{metricDef.label} by {breakdownLabel}</h2>
          <Button data-testid="compare-export-btn" onClick={exportCompare} variant="outline" size="sm" className="gap-2 rounded-sm" disabled={selected.length < 1 || categories.length === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Export
          </Button>
        </div>
        <div className="p-4">{renderChart()}</div>
      </Card>

      {/* table */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="compare-table">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Detailed Comparison</h2>
          <p className="text-xs text-muted-foreground">{primaryLabel} datasets by {breakdownLabel}</p>
        </div>
        {selected.length === 0 || categories.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Select datasets to compare.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/60">
                  <TableHead className="text-xs uppercase tracking-widest">{breakdownLabel}</TableHead>
                  {selected.map((s, i) => (
                    <TableHead key={s} className="text-right text-xs uppercase tracking-widest" style={{ color: PALETTE[i % PALETTE.length] }}>{s}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {chartData.map((d) => (
                  <TableRow key={d.name} className="hover:bg-secondary/40" data-testid={`compare-row-${d.name}`}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    {selected.map((s) => <TableCell key={s} className="text-right tabular-nums">{fmt(d[s] || 0)}</TableCell>)}
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="compare-total-row">
                  <TableCell>Grand Total</TableCell>
                  {selected.map((s) => <TableCell key={s} className="text-right tabular-nums">{fmt(totals[s] || 0)}</TableCell>)}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------- Top Movers ------------------------- */
function TopMovers({ rows }) {
  const [entity, setEntity] = useState("brand");
  const [period, setPeriod] = useState("financial_year");
  const [periodA, setPeriodA] = useState("");
  const [periodB, setPeriodB] = useState("");
  const [metric, setMetric] = useState("ordered_qty");

  const periodValues = useMemo(() => uniqVals(rows, period), [rows, period]);

  useEffect(() => {
    if (periodValues.length) {
      setPeriodA(periodValues[0]);
      setPeriodB(periodValues[1] || periodValues[0]);
    }
  }, [periodValues]);

  useEffect(() => {
    if (entity === period) setPeriod(DIMS.find((d) => d.key !== entity).key);
  }, [entity]); // eslint-disable-line

  const metricDef = METRICS.find((m) => m.key === metric);
  const fmt = (v) => (metricDef.money ? inr(v) : num(v));
  const entityLabel = DIMS.find((d) => d.key === entity)?.label;

  const movers = useMemo(() => {
    const a = {};
    const b = {};
    rows.forEach((r) => {
      const ev = dimValue(r, entity);
      const pv = dimValue(r, period);
      const val = Number(r[metric]) || 0;
      if (pv === periodA) a[ev] = (a[ev] || 0) + val;
      if (pv === periodB) b[ev] = (b[ev] || 0) + val;
    });
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    return keys
      .map((k) => {
        const va = a[k] || 0;
        const vb = b[k] || 0;
        const change = vb - va;
        const pct = va > 0 ? (change / va) * 100 : vb > 0 ? 100 : 0;
        return { name: k, a: va, b: vb, change, pct };
      })
      .sort((x, y) => y.change - x.change);
  }, [rows, entity, period, periodA, periodB, metric]);

  const gainers = movers.filter((m) => m.change > 0).slice(0, 5);
  const droppers = movers.filter((m) => m.change < 0).slice(-5).reverse();
  const sameAB = periodA === periodB;

  const chartData = movers.slice(0, 12).map((m) => ({ name: m.name, change: m.change }));

  const exportMovers = () => {
    downloadSheet(
      movers.map((m) => ({ [entityLabel]: m.name, [`${periodA}`]: m.a, [`${periodB}`]: m.b, Change: m.change, "% Change": Number(m.pct.toFixed(1)) })),
      "Top Movers",
      `top-movers-${entity}-${metric}-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    toast.success("Movers exported");
  };

  const MoverList = ({ title, items, positive, testid }) => (
    <Card className="rounded-sm border-2 border-border shadow-none" data-testid={testid}>
      <div className="border-b border-border p-4">
        <h3 className={`font-display text-base font-bold tracking-tight ${positive ? "text-emerald-700" : "text-red-600"}`}>{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Nothing here.</div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((m) => (
            <li key={m.name} className="flex items-center justify-between px-4 py-2.5 text-sm" data-testid={`mover-${m.name}`}>
              <span className="font-medium">{m.name}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-muted-foreground">{fmt(m.a)} → {fmt(m.b)}</span>
                <DeltaChip value={m.change} money={metricDef.money} />
                <span className={`w-14 text-right tabular-nums text-xs font-semibold ${positive ? "text-emerald-700" : "text-red-600"}`}>{m.pct >= 0 ? "+" : ""}{m.pct.toFixed(0)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );

  return (
    <div className="space-y-6">
      <Card className="rounded-sm border-2 border-border p-4 shadow-none" data-testid="movers-controls">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Track</Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger data-testid="movers-entity" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{DIMS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Period type</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger data-testid="movers-period" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{DIMS.filter((d) => d.key !== entity).map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">From period</Label>
            <Select value={periodA} onValueChange={setPeriodA}>
              <SelectTrigger data-testid="movers-period-a" className="h-9 rounded-sm border-2"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{periodValues.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">To period</Label>
            <Select value={periodB} onValueChange={setPeriodB}>
              <SelectTrigger data-testid="movers-period-b" className="h-9 rounded-sm border-2"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{periodValues.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger data-testid="movers-metric" className="h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>{METRICS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        {sameAB && <p className="mt-3 text-xs font-medium text-amber-600">Pick two different periods to see movement.</p>}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MoverList title="▲ Biggest Gainers" items={gainers} positive testid="movers-gainers" />
        <MoverList title="▼ Biggest Drops" items={droppers} positive={false} testid="movers-droppers" />
      </div>

      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="movers-chart">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Change: {periodA} → {periodB} ({metricDef.label})</h2>
          <Button data-testid="movers-export-btn" onClick={exportMovers} variant="outline" size="sm" className="gap-2 rounded-sm" disabled={sameAB || movers.length === 0}>
            <FileSpreadsheet className="h-4 w-4" /> Export
          </Button>
        </div>
        <div className="p-4">
          {movers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => (metricDef.money ? `₹${v}` : num(v))} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Bar dataKey="change" radius={[0, 2, 2, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.change >= 0 ? "#2E9E6B" : "#C0392B"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
