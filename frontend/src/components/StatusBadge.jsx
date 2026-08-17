const MAP = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  partial: { label: "Partial", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  done: { label: "Done", cls: "bg-emerald-100 text-emerald-800 border-emerald-200" },
};

export const StatusBadge = ({ status }) => {
  const s = MAP[status] || MAP.pending;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
};

export const Progress = ({ ordered, dispatched }) => {
  const pct = ordered > 0 ? Math.min(100, Math.round((dispatched / ordered) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
};
