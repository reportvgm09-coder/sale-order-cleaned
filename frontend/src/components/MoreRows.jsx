import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { num } from "@/lib/format";

// Drawing every row at once is what made big pages slow: a thousand orders
// is some 30,000 elements, which froze the screen for a second or two on every
// page change and on every key typed into a filter. So a table draws this many
// and adds more as it is scrolled to the end. Totals, exports and filters still
// work on every row - only the drawing is held back.
const STEP = 100;

/**
 * Pass the full, filtered and sorted list. Returns the rows to draw now, and a
 * function giving the table row that loads the rest - put it in the body just
 * before the total row, with the table's column count and whether the table
 * has a total row (so the note can say the totals still count everything).
 * A list that is not a table uses `moreItem()` at its end instead.
 */
export function useMoreRows(rows) {
  const [limit, setLimit] = useState(STEP);
  // Back to the top of the list when a filter changes what is in it. Keyed on
  // the count, not the array: an unmemoised list is a new array every render,
  // and resetting on that would never settle.
  const [seen, setSeen] = useState(rows.length);
  if (rows.length !== seen) {
    setSeen(rows.length);
    setLimit(STEP);
  }

  // Printing must show the whole list, not the part scrolled to so far.
  useEffect(() => {
    const all = () => flushSync(() => setLimit(Infinity));
    window.addEventListener("beforeprint", all);
    return () => window.removeEventListener("beforeprint", all);
  }, []);

  const shown = rows.length > limit ? rows.slice(0, limit) : rows;
  const moreRow = (colSpan, hasTotals = true) =>
    rows.length > limit ? (
      <MoreRow key="more-rows" colSpan={colSpan} shown={limit} total={rows.length} hasTotals={hasTotals} setLimit={setLimit} />
    ) : null;
  const moreItem = () =>
    rows.length > limit ? (
      <More key="more-rows" as="div" shown={limit} total={rows.length} setLimit={setLimit} />
    ) : null;
  return { shown, moreRow, moreItem };
}

function MoreRow({ colSpan, ...rest }) {
  return (
    <TableRow className="no-print hover:bg-transparent" data-testid="more-rows">
      <More as={TableCell} colSpan={colSpan} {...rest} />
    </TableRow>
  );
}

function More({ as: Tag, colSpan, shown, total, hasTotals, setLimit }) {
  const ref = useRef(null);

  // Scrolling down to this row loads the next lot, so the buttons are only
  // needed for jumping ahead.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && setLimit((l) => l + STEP),
      { rootMargin: "400px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [setLimit, shown]);

  return (
    <Tag
      ref={ref}
      colSpan={colSpan}
      className="no-print px-2 py-3 text-center text-xs text-muted-foreground"
      data-testid={Tag === "div" ? "more-rows" : undefined}
    >
        Showing {num(shown)} of {num(total)}.{hasTotals && " The totals below count all of them."}
        <span className="ml-3 inline-flex gap-2">
          <Button
            data-testid="more-rows-next"
            variant="outline"
            size="sm"
            className="h-7 rounded-sm px-2 text-xs"
            onClick={() => setLimit((l) => l + STEP)}
          >
            Show {num(Math.min(STEP, total - shown))} more
          </Button>
          <Button
            data-testid="more-rows-all"
            variant="ghost"
            size="sm"
            className="h-7 rounded-sm px-2 text-xs"
            onClick={() => setLimit(Infinity)}
          >
            Show all
          </Button>
        </span>
    </Tag>
  );
}
