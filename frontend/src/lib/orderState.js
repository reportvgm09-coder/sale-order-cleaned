/* What has been decided about an order, by hand. Kept apart from the derived
   status (Pending / Partial / Done), which is only ever about quantity - an
   order can be half dispatched and on hold at the same time.
   One list, so the picker, the badge, the row colour and the column filter can
   never drift apart. */
export const ORDER_STATES = [
  { key: "open", label: "Open", badge: "bg-secondary text-muted-foreground border-border", row: "" },
  {
    key: "hold",
    label: "Hold",
    badge: "bg-slate-200 text-slate-700 border-slate-300",
    row: "bg-slate-100 hover:bg-slate-200/70",
  },
  {
    key: "half",
    label: "50%",
    // Amber rather than yellow: the paler yellows read as a highlighter pen
    // rather than as mustard, and wash out beside the cancelled red.
    badge: "bg-amber-300 text-amber-900 border-amber-400",
    row: "bg-amber-200 hover:bg-amber-300/70",
  },
  {
    key: "cancelled",
    label: "Cancelled",
    badge: "bg-red-200 text-red-900 border-red-300",
    row: "bg-red-100 hover:bg-red-200/70",
  },
];

const BY_KEY = Object.fromEntries(ORDER_STATES.map((s) => [s.key, s]));

// Orders saved before this existed have no state at all, and read as open.
export const stateOf = (order) => BY_KEY[order?.state] || BY_KEY.open;

export const stateLabel = (key) => (BY_KEY[key] || BY_KEY.open).label;

/** Tailwind classes that tint a whole table row. Open orders get nothing, so
 *  an ordinary grid still looks like an ordinary grid. */
export const stateRowClass = (key) => (BY_KEY[key] || BY_KEY.open).row;

export const stateBadgeClass = (key) => (BY_KEY[key] || BY_KEY.open).badge;

/** Read a state back from a spreadsheet cell, so an export can be imported
 *  again without quietly reopening everything. Accepts the label ("50%") or
 *  the stored key ("half"), in any case. Unknown text returns null so the
 *  importer can say so rather than guess. */
export const stateFromLabel = (text) => {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t) return "open";
  return ORDER_STATES.find((s) => s.key === t || s.label.toLowerCase() === t)?.key || null;
};
