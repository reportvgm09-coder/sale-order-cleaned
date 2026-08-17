import { useEffect, useState } from "react";
import { downloadMultiSheet } from "@/lib/excel";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { FileSpreadsheet, RotateCcw } from "lucide-react";

const PREF_KEY = "ledger_export_columns";

const loadPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
  } catch {
    return {};
  }
};

const savePrefs = (all) => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch {
    /* private browsing or a full quota - the export still works, it just won't be remembered */
  }
};

/**
 * Column picker shown before every Excel export, remembering what you chose last time.
 *
 * sheets: [{ name, columns: [{ key, get(record, index) }], data: [...] }]
 *   `data` is already flattened - one entry per spreadsheet row - so a sheet that
 *   lists order lines passes { order, item } pairs rather than orders.
 *
 * What gets stored is the list of columns you turned OFF, not the ones you left on.
 * That way a column added to the app later shows up by default instead of being
 * silently missing from your exports forever.
 */
export function ExportDialog({ open, onOpenChange, storageKey, fileName, sheets, title, description }) {
  const [state, setState] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const saved = loadPrefs()[storageKey] || {};
    const next = {};
    sheets.forEach((s) => {
      const rec = saved[s.name] || {};
      const known = s.columns.map((c) => c.key);
      next[s.name] = {
        skip: !!rec.skip,
        // drop remembered keys for columns that no longer exist
        off: (Array.isArray(rec.off) ? rec.off : []).filter((k) => known.includes(k)),
      };
    });
    setState(next);
    // `sheets` is rebuilt every render, so depending on it would loop
  }, [open, storageKey]); // eslint-disable-line

  const recFor = (name) => state[name] || { skip: false, off: [] };
  const isOn = (name, key) => !recFor(name).off.includes(key);

  const toggleCol = (name, key) =>
    setState((p) => {
      const rec = p[name] || { skip: false, off: [] };
      const off = rec.off.includes(key) ? rec.off.filter((k) => k !== key) : [...rec.off, key];
      return { ...p, [name]: { ...rec, off } };
    });

  const toggleSheet = (name) =>
    setState((p) => ({ ...p, [name]: { ...(p[name] || { off: [] }), skip: !recFor(name).skip } }));

  const setAll = (sheet, on) =>
    setState((p) => ({
      ...p,
      [sheet.name]: { skip: false, off: on ? [] : sheet.columns.map((c) => c.key) },
    }));

  const resetAll = () => {
    const next = {};
    sheets.forEach((s) => (next[s.name] = { skip: false, off: [] }));
    setState(next);
  };

  const chosen = sheets
    .map((s) => {
      const rec = recFor(s.name);
      const cols = rec.skip ? [] : s.columns.filter((c) => !rec.off.includes(c.key));
      return { sheet: s, cols };
    })
    .filter((x) => x.cols.length > 0);

  const totalCols = chosen.reduce((n, x) => n + x.cols.length, 0);

  const run = async () => {
    if (chosen.length === 0) return toast.error("Pick at least one column to export");
    setBusy(true);
    try {
      const out = chosen.map(({ sheet, cols }) => ({
        name: sheet.name,
        rows: (sheet.data || []).map((record, i) => {
          const row = {};
          cols.forEach((c) => {
            row[c.key] = c.get(record, i);
          });
          return row;
        }),
      }));
      await downloadMultiSheet(out, fileName);
      savePrefs({ ...loadPrefs(), [storageKey]: state });
      toast.success(`Exported ${totalCols} column${totalCols === 1 ? "" : "s"}`);
      onOpenChange(false);
    } catch (e) {
      toast.error("Could not create the file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-sm border-2 border-border" data-testid="export-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">{title || "Choose what to export"}</DialogTitle>
          <DialogDescription>
            {description || "Untick anything you don't need. Your choice is remembered for next time."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {sheets.map((s) => {
            const rec = recFor(s.name);
            const onCount = s.columns.filter((c) => !rec.off.includes(c.key)).length;
            return (
              <div key={s.name} className="rounded-sm border-2 border-border" data-testid={`export-sheet-${s.name}`}>
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/60 px-3 py-2">
                  <Checkbox
                    data-testid={`export-sheet-toggle-${s.name}`}
                    checked={!rec.skip}
                    onCheckedChange={() => toggleSheet(s.name)}
                  />
                  <span className="font-display text-sm font-bold tracking-tight">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(s.data || []).length} row{(s.data || []).length === 1 ? "" : "s"} · {onCount} of {s.columns.length} columns
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 rounded-sm text-xs" onClick={() => setAll(s, true)}>All</Button>
                    <Button variant="ghost" size="sm" className="h-7 rounded-sm text-xs" onClick={() => setAll(s, false)}>None</Button>
                  </div>
                </div>
                {!rec.skip && (
                  <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 p-3 sm:grid-cols-2 md:grid-cols-3">
                    {s.columns.map((c) => (
                      <label key={c.key} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          data-testid={`export-col-${s.name}-${c.key}`}
                          checked={isOn(s.name, c.key)}
                          onCheckedChange={() => toggleCol(s.name, c.key)}
                        />
                        <span className="truncate">{c.key}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={resetAll} className="gap-1 rounded-sm" data-testid="export-reset">
            <RotateCcw className="h-4 w-4" /> Select everything
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-sm">Cancel</Button>
          <Button data-testid="export-confirm" onClick={run} disabled={busy || chosen.length === 0} className="gap-2 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" />
            {busy ? "Building…" : `Export ${chosen.length} sheet${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
