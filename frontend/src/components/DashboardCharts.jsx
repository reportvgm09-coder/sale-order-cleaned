import { useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { num } from "@/lib/format";
import { Inbox, BarChart3, List } from "lucide-react";

/* Colours for the dashboard charts, checked with the dataviz palette validator
   (colour-blind separation, contrast on white): ordered blue, dispatched green.
   Pending is amber, as it is everywhere else in the app - green would read as
   done. Bars carry their figures as labels. Text never takes a series
   colour - values and labels stay in the ordinary ink. */
export const SERIES = { ordered: "#2F6FB0", dispatched: "#1F8A47", pending: "#D97706" };
const INK = "hsl(150 24% 11%)";
const MUTED = "hsl(150 8% 38%)";
const GRID = "hsl(110 10% 88%)";

// Order status, in the same colours as the status badges, and always named
// beside its colour - never colour alone.
const STATUS = [
  { key: "pending", label: "Pending", color: "#F59E0B" },
  { key: "partial", label: "Partial", color: "#2F6FB0" },
  { key: "done", label: "Done", color: "#1F8A47" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym) => {
  const [y, m] = String(ym).split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : ym;
};

// 1,48,582 on an axis is noise; 1.5L reads at a glance. Tooltips keep the full figure.
const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(v);
};

const ChartCard = ({ title, subtitle, action, children, testid, className = "" }) => (
  <Card data-testid={testid} className={`flex flex-col rounded-lg border-border shadow-sm ${className}`}>
    <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div>
        <h3 className="font-display text-base font-bold tracking-tight">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
    <div className="flex-1 p-4">{children}</div>
  </Card>
);

const Empty = ({ text = "Nothing pending. All caught up." }) => (
  <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
    <Inbox className="h-6 w-6 opacity-50" />
    {text}
  </div>
);

const Tip = ({ active, payload, label, labelFormat = (l) => l }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-foreground">{labelFormat(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-foreground">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{num(p.value)} pcs</span>
        </div>
      ))}
    </div>
  );
};

/** Pieces ordered against pieces sent, by the month the order was taken. */
export function MonthChart({ rows }) {
  const data = (rows || []).map((r) => ({ ...r, label: monthLabel(r.month) }));
  return (
    <ChartCard
      testid="chart-by-month"
      className="lg:col-span-2"
      title="Ordered vs dispatched, by month"
      subtitle="Pieces, by the month each order was taken"
    >
      {data.length === 0 ? (
        <Empty text="No orders match these filters." />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fill: MUTED, fontSize: 12 }} />
              <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: MUTED, fontSize: 12 }} width={44} />
              <Tooltip content={<Tip />} cursor={{ fill: "hsl(138 48% 93% / 0.6)" }} />
              <Legend verticalAlign="top" align="right" height={28} iconType="square" iconSize={10}
                itemSorter={(item) => (item.dataKey === "ordered_qty" ? 0 : 1)}
                formatter={(v) => <span style={{ color: INK, fontSize: 12 }}>{v}</span>} />
              <Bar dataKey="ordered_qty" name="Ordered" fill={SERIES.ordered} radius={[4, 4, 0, 0]} maxBarSize={36} />
              <Bar dataKey="dispatched_qty" name="Dispatched" fill={SERIES.dispatched} radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/** How many orders are pending, part-sent and done - one bar split three ways. */
export function StatusCard({ mix, ordered, dispatched, children }) {
  const total = STATUS.reduce((n, s) => n + (mix?.[s.key] || 0), 0);
  const pct = ordered > 0 ? Math.round((dispatched / ordered) * 100) : 0;
  return (
    <ChartCard testid="chart-status" title="Where the orders stand" subtitle={`${num(total)} orders`}>
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Pieces dispatched</span>
            <span className="font-display text-2xl font-extrabold tabular-nums">{pct}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${pct}% of ordered pieces dispatched`}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: SERIES.dispatched }} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {num(dispatched)} of {num(ordered)} pcs
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Orders by status</div>
          {total === 0 ? (
            <Empty text="No orders match these filters." />
          ) : (
            <>
              {/* 2px white gaps between the parts, so they read as separate */}
              <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" data-testid="status-bar">
                {STATUS.map((s) =>
                  mix?.[s.key] ? (
                    <div key={s.key} title={`${s.label}: ${num(mix[s.key])}`} style={{ flexGrow: mix[s.key], background: s.color }} />
                  ) : null
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {STATUS.map((s) => (
                  <li key={s.key} className="flex items-center gap-2 text-sm" data-testid={`status-mix-${s.key}`}>
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                    <span className="text-foreground">{s.label}</span>
                    <span className="ml-auto font-semibold tabular-nums">{num(mix?.[s.key] || 0)}</span>
                    <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                      {total ? Math.round(((mix?.[s.key] || 0) / total) * 100) : 0}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        {children}
      </div>
    </ChartCard>
  );
}

const TOP = 10;

// One line per name, cut short with the full name on hover - the chart's own
// ticks wrap a long shop name onto two lines and crowd the bars.
const NameTick = ({ x, y, payload }) => {
  const full = String(payload?.value ?? "");
  const short = full.length > 17 ? `${full.slice(0, 16)}…` : full;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill={INK} fontSize={12}>
      <title>{full}</title>
      {short}
    </text>
  );
};

/** The ten biggest, as bars, with the full list one click away. */
export function TopPending({ title, subtitle, rows, testid }) {
  const [view, setView] = useState("chart");
  const all = rows || [];
  const top = all.slice(0, TOP);
  const toggle = (
    <div className="flex shrink-0 rounded-md border border-border p-0.5" role="group" aria-label="Show as">
      {[
        { key: "chart", icon: BarChart3, label: "Chart" },
        { key: "list", icon: List, label: `All ${num(all.length)}` },
      ].map((o) => (
        <button
          key={o.key}
          type="button"
          data-testid={`${testid}-view-${o.key}`}
          onClick={() => setView(o.key)}
          className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            view === o.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <o.icon className="h-3.5 w-3.5" /> {o.label}
        </button>
      ))}
    </div>
  );
  return (
    <ChartCard testid={testid} title={title} subtitle={subtitle} action={all.length > 0 && toggle}>
      {all.length === 0 ? (
        <Empty />
      ) : view === "list" ? (
        <ul className="max-h-[300px] divide-y divide-border overflow-auto">
          {all.map((r) => (
            <li key={r.name} className="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <span className="truncate font-medium text-foreground">{r.name}</span>
              <span className="shrink-0 tabular-nums font-semibold">{num(r.qty)} pcs</span>
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ height: Math.max(120, top.length * 30 + 12) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={136} tickLine={false} axisLine={false} tick={<NameTick />} />
              <Tooltip content={<Tip />} cursor={{ fill: "hsl(138 48% 93% / 0.6)" }} />
              <Bar dataKey="qty" name="Pending" fill={SERIES.pending} radius={[0, 4, 4, 0]} maxBarSize={20}>
                <LabelList dataKey="qty" position="right" formatter={(v) => num(v)} style={{ fill: INK, fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
