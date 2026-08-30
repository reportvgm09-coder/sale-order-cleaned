export const inr = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(n) || 0);

export const num = (n) => new Intl.NumberFormat("en-IN").format(Number(n) || 0);

const pad = (n) => String(n).padStart(2, "0");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dates are stored as plain "YYYY-MM-DD" - a calendar day, with no time and no
 * timezone. `new Date("2026-08-19")` reads that as midnight *UTC*, which prints
 * as the day before anywhere behind UTC. Splitting it by hand keeps the day the
 * same everywhere the app is opened.
 */
const asDate = (d) => {
  if (typeof d === "string" && DATE_ONLY.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  return new Date(d);
};

export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = asDate(d);
  // Show what is actually stored rather than the words "Invalid Date" - if a
  // bad value ever reaches the database, seeing it is what leads to the cause.
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * The Monday of the week a stored date falls in, as "YYYY-MM-DD".
 *
 * Built from asDate and setDate for the same reason fmtDate splits by hand:
 * anything that goes through UTC lands on the previous day west of it, which
 * would file a Monday's dispatch under the week before. getDay() counts Sunday
 * as 0, so it is shifted to make Monday the start of the week.
 */
export const weekStart = (d) => {
  const dt = asDate(d);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

/** "18 May – 24 May 2026" from that week's Monday. */
export const fmtWeek = (monday) => {
  const a = asDate(monday);
  if (Number.isNaN(a.getTime())) return String(monday);
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
  const dm = (x) => x.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  return `${dm(a)} – ${dm(b)} ${b.getFullYear()}`;
};

/** "May 2026" from a "YYYY-MM" key. */
export const fmtMonth = (key) => {
  const [y, m] = String(key).split("-").map(Number);
  if (!y || !m) return String(key);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
};

/**
 * A stored date as a real Date for Excel, so the column arrives as dates rather
 * than text - sortable, filterable and groupable in a pivot. Built at midnight
 * UTC because that is how ExcelJS converts a Date to a cell; a local midnight
 * would land on the previous day for anyone east of UTC. Anything that is not a
 * date is passed straight through for the sheet to show as it is.
 */
export const xlDate = (d) => {
  if (!d || typeof d !== "string" || !DATE_ONLY.test(d.slice(0, 10))) return d || "";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

// The local date, not the UTC one. toISOString() is UTC, so before 05:30 in
// India this used to answer with yesterday - an order typed at 1am was filed a
// day early, and at a month end it landed in the wrong month altogether.
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
