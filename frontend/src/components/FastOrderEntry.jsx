import { useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { inr, num, today } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, X, Check, ChevronsUpDown, Save, Zap } from "lucide-react";

// Order IDs are generated up front so you can see them on the pad before saving.
//
// 3 characters of clock + 3 of counter. The counter gives 46,656 distinct
// values, so IDs cannot repeat within a session no matter how fast rows are
// added - an earlier version wrapped after 1,296 and did collide. It starts at
// a random point so two separate sessions don't march in step either. The
// database also refuses a duplicate id outright, as a last line of defence.
let seq = Math.floor(Math.random() * 46656);
const genOrderId = () => {
  seq = (seq + 1) % 46656;
  const stamp = Date.now().toString(36).toUpperCase().slice(-3);
  return `SO-${stamp}${seq.toString(36).toUpperCase().padStart(3, "0")}`;
};

let rowKey = 0;
const blankLine = () => ({
  key: `row-${++rowKey}`,
  id: genOrderId(),
  customer_id: "",
  dispatch_date: "",
  brand_id: "",
  qty: "",
  rate: "",
  status: "draft", // draft | saving | saved
});

const isBlank = (l) => !l.customer_id && !l.brand_id && !l.qty && !l.dispatch_date;

const MASTER_LABEL = {
  customers: "customer",
  brands: "brand",
  exhibitions: "exhibition",
  salesmen: "salesman",
  seasons: "season",
};

/**
 * Searchable picker for any master list, with "Add new" built in - so a name
 * that does not exist yet never sends you off to the Masters page and back,
 * losing the row you were typing.
 *
 * The Add button sits below the list rather than only appearing when nothing
 * matches: "Raj" needs adding just as often when "Rajesh" is already there.
 */
function MasterPicker({
  items,
  value,
  onChange,
  onCreate,
  placeholder,
  addLabel,
  search,
  suffix,
  disabled,
  triggerClass = "",
  testid,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = items.find((i) => i.id === value);

  const create = () => {
    onCreate(query);
    setOpen(false);
  };

  // Drop the search text on the way out, or reopening shows a list still
  // narrowed by whatever was typed last time and looks half empty.
  const change = (v) => {
    setOpen(v);
    if (!v) setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild>
        <Button
          data-testid={testid}
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={`h-9 w-full justify-between rounded-sm px-2 font-normal ${triggerClass}`}
        >
          <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 rounded-sm p-0" align="start">
        <Command>
          <CommandInput placeholder="Type to search…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty className="px-3 py-2 text-left text-sm text-muted-foreground">
              No {addLabel} matches “{query}”.
            </CommandEmpty>
            <CommandGroup>
              {items.map((i) => (
                <CommandItem
                  key={i.id}
                  value={search ? search(i) : i.name}
                  onSelect={() => {
                    onChange(i);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-3.5 w-3.5 shrink-0 ${i.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{i.name}</span>
                  {suffix && suffix(i) ? (
                    <span className="ml-1 shrink-0 text-xs text-muted-foreground">{suffix(i)}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t border-border p-1">
          <button
            type="button"
            data-testid={`${testid}-create`}
            onClick={create}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-secondary"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{query ? `Add “${query}”` : `Add new ${addLabel}`}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const COLS = "grid-cols-[112px_minmax(150px,1.3fr)_140px_minmax(150px,1.3fr)_84px_96px_110px_92px]";

export default function FastOrderEntry({ masters, onSaved, onCreateMaster }) {
  const [header, setHeader] = useState({
    order_date: today(),
    event_type: "exhibition",
    exhibition_id: "",
    salesman_id: "",
    season_id: "",
  });
  // lazy initialiser - otherwise blankLine() would run on every render,
  // burning order IDs for rows that are never used
  const [lines, setLines] = useState(() => [blankLine(), blankLine(), blankLine()]);
  // { type, name, city, rate, apply } - `apply` drops the created record into
  // whichever field asked for it, so one dialog serves every picker.
  const [newMaster, setNewMaster] = useState(null);
  const [savingAll, setSavingAll] = useState(false);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((l) => l.key !== key)));

  // Used both when picking an existing brand and when one is created on the
  // spot, so the brand's rate fills the row the same way either way.
  const applyBrand = (key, brand) =>
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const rateEmpty = l.rate === "" || l.rate == null || Number(l.rate) === 0;
        return { ...l, brand_id: brand.id, rate: rateEmpty && brand.rate ? brand.rate : l.rate };
      })
    );

  const pending = lines.filter((l) => l.status !== "saved");
  const savedCount = lines.filter((l) => l.status === "saved").length;

  const pendingTotal = useMemo(
    () => pending.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.qty) || 0), 0),
    [pending]
  );

  const headerProblem = () => {
    if (!header.order_date) return "Pick an order date at the top first";
    return null;
  };

  const lineProblem = (l) => {
    if (!l.customer_id) return "Pick a customer";
    if (!l.brand_id) return "Pick a brand";
    if (!(Number(l.qty) > 0)) return "Enter a quantity";
    return null;
  };

  const payloadFor = (l) => ({
    id: l.id,
    order_date: header.order_date,
    customer_id: l.customer_id,
    dispatch_date: l.dispatch_date || null,
    event_type: header.event_type,
    exhibition_id: header.event_type === "exhibition" ? header.exhibition_id || null : null,
    salesman_id: header.event_type === "door_to_door" ? header.salesman_id || null : null,
    season_id: header.season_id || null,
    items: [{ brand_id: l.brand_id, rate: Number(l.rate) || 0, qty: Number(l.qty) || 0 }],
  });

  const saveLine = async (key, { quiet = false } = {}) => {
    const l = lines.find((x) => x.key === key);
    if (!l || l.status === "saved") return false;
    const problem = headerProblem() || lineProblem(l);
    if (problem) {
      if (!quiet) toast.error(problem);
      return false;
    }
    setLine(key, { status: "saving" });
    try {
      await api.createSaleOrder(payloadFor(l));
      setLine(key, { status: "saved" });
      if (!quiet) toast.success(`Saved ${l.id}`);
      onSaved && onSaved();
      // keep an empty row ready so entry never stops
      setLines((ls) => (ls.every((x) => x.status === "saved") ? [...ls, blankLine()] : ls));
      return true;
    } catch (e) {
      setLine(key, { status: "draft" });
      toast.error(`${l.id}: ${apiErr(e)}`);
      return false;
    }
  };

  const saveAll = async () => {
    const problem = headerProblem();
    if (problem) return toast.error(problem);
    const ready = lines.filter((l) => l.status === "draft" && !isBlank(l));
    if (ready.length === 0) return toast.error("Nothing filled in to save yet");
    const incomplete = ready.filter((l) => lineProblem(l));
    if (incomplete.length) return toast.error(`Row ${lines.indexOf(incomplete[0]) + 1}: ${lineProblem(incomplete[0])}`);

    setSavingAll(true);
    let done = 0;
    for (const l of ready) {
      // sequential on purpose - a failure part-way leaves the rest untouched
      // and still on screen, rather than a scatter of half-saved orders
      if (await saveLine(l.key, { quiet: true })) done++;
    }
    setSavingAll(false);
    if (done) toast.success(`Saved ${done} order${done === 1 ? "" : "s"}`);
  };

  const clearSaved = () => setLines((ls) => (ls.some((l) => l.status !== "saved") ? ls.filter((l) => l.status !== "saved") : [blankLine()]));

  const openNewMaster = (type, name, apply) => setNewMaster({ type, name: name || "", city: "", rate: "", apply });

  const submitNewMaster = async () => {
    const { type, apply } = newMaster;
    const name = (newMaster.name || "").trim();
    const city = (newMaster.city || "").trim();
    if (!name) return toast.error(`Enter a ${MASTER_LABEL[type]} name`);
    if (type === "customers" && !city) return toast.error("City is required for customers");
    const payload = { name };
    if (type === "customers") payload.city = city;
    if (type === "brands" && String(newMaster.rate).trim() !== "") payload.rate = Number(newMaster.rate) || 0;
    try {
      const rec = await onCreateMaster(type, payload);
      if (!rec) return; // near-duplicate warning declined - leave the box open to edit the name
      apply(rec);
      setNewMaster(null);
      toast.success(`${rec.name} added`);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  return (
    <Card className="rounded-sm border-2 border-border p-5 shadow-none" data-testid="fast-entry">
      <div className="mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Fast Entry</h2>
          <p className="text-xs text-muted-foreground">
            Set the four fields below once, then type a row per order. Each row saves as its own sale order.
          </p>
        </div>
      </div>

      {/* Shared header - applies to every row saved from here */}
      <div className="grid grid-cols-1 gap-4 rounded-sm border-2 border-border bg-secondary/40 p-4 md:grid-cols-4" data-testid="fast-header">
        <div>
          <Label className="text-xs uppercase tracking-widest">Order Date</Label>
          <Input
            data-testid="fast-order-date"
            type="date"
            value={header.order_date}
            onChange={(e) => setHeader({ ...header, order_date: e.target.value })}
            className="mt-1 h-9 rounded-sm border-2 bg-background"
          />
        </div>
        <div>
          <Label className="text-xs uppercase tracking-widest">Event Type</Label>
          <Select value={header.event_type} onValueChange={(v) => setHeader({ ...header, event_type: v })}>
            <SelectTrigger data-testid="fast-event-type" className="mt-1 h-9 rounded-sm border-2 bg-background"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exhibition">Exhibition</SelectItem>
              <SelectItem value="door_to_door">Door to Door</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {header.event_type === "exhibition" ? (
          <div>
            <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
            <MasterPicker
              testid="fast-exhibition"
              items={masters.exhibitions}
              value={header.exhibition_id}
              placeholder="Select exhibition"
              addLabel="exhibition"
              triggerClass="mt-1 border-2 bg-background"
              onChange={(x) => setHeader((h) => ({ ...h, exhibition_id: x.id }))}
              onCreate={(name) =>
                openNewMaster("exhibitions", name, (rec) => setHeader((h) => ({ ...h, exhibition_id: rec.id })))
              }
            />
          </div>
        ) : (
          <div>
            <Label className="text-xs uppercase tracking-widest">Sales Man</Label>
            <MasterPicker
              testid="fast-salesman"
              items={masters.salesmen}
              value={header.salesman_id}
              placeholder="Select salesman"
              addLabel="salesman"
              triggerClass="mt-1 border-2 bg-background"
              onChange={(x) => setHeader((h) => ({ ...h, salesman_id: x.id }))}
              onCreate={(name) =>
                openNewMaster("salesmen", name, (rec) => setHeader((h) => ({ ...h, salesman_id: rec.id })))
              }
            />
          </div>
        )}
        <div>
          <Label className="text-xs uppercase tracking-widest">Season</Label>
          <MasterPicker
            testid="fast-season"
            items={masters.seasons}
            value={header.season_id}
            placeholder="Select season"
            addLabel="season"
            triggerClass="mt-1 border-2 bg-background"
            onChange={(x) => setHeader((h) => ({ ...h, season_id: x.id }))}
            onCreate={(name) => openNewMaster("seasons", name, (rec) => setHeader((h) => ({ ...h, season_id: rec.id })))}
          />
        </div>
      </div>

      {/* Line pad */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[1000px] rounded-sm border border-border">
          <div className={`grid ${COLS} gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground`}>
            <div>Order ID</div>
            <div>Customer Name</div>
            <div>Dispatch Date</div>
            <div>Brand</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Amount</div>
            <div />
          </div>

          {lines.map((l, idx) => {
            const saved = l.status === "saved";
            const amount = (Number(l.rate) || 0) * (Number(l.qty) || 0);
            return (
              <div
                key={l.key}
                data-testid={`fast-row-${idx}`}
                className={`grid ${COLS} items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 ${saved ? "bg-emerald-50/70" : ""}`}
              >
                <div className="truncate font-mono text-xs font-semibold" title={l.id}>{l.id}</div>

                <MasterPicker
                  testid={`fast-customer-${idx}`}
                  items={masters.customers}
                  value={l.customer_id}
                  disabled={saved}
                  placeholder="Customer…"
                  addLabel="customer"
                  search={(c) => `${c.name} ${c.city || ""}`}
                  suffix={(c) => (c.city ? `· ${c.city}` : "")}
                  onChange={(c) => setLine(l.key, { customer_id: c.id })}
                  onCreate={(name) =>
                    openNewMaster("customers", name, (rec) => setLine(l.key, { customer_id: rec.id }))
                  }
                />

                <Input
                  data-testid={`fast-dispatch-date-${idx}`}
                  type="date"
                  value={l.dispatch_date}
                  disabled={saved}
                  onChange={(e) => setLine(l.key, { dispatch_date: e.target.value })}
                  className="h-9 rounded-sm"
                />

                <MasterPicker
                  testid={`fast-brand-${idx}`}
                  items={masters.brands}
                  value={l.brand_id}
                  disabled={saved}
                  placeholder="Brand"
                  addLabel="brand"
                  suffix={(b) => (b.rate ? `· ₹${b.rate}` : "")}
                  onChange={(b) => applyBrand(l.key, b)}
                  onCreate={(name) => openNewMaster("brands", name, (rec) => applyBrand(l.key, rec))}
                />

                <Input
                  data-testid={`fast-qty-${idx}`}
                  type="number"
                  min="0"
                  value={l.qty}
                  disabled={saved}
                  onChange={(e) => setLine(l.key, { qty: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveLine(l.key);
                    }
                  }}
                  className="h-9 rounded-sm text-right"
                />

                <Input
                  data-testid={`fast-rate-${idx}`}
                  type="number"
                  min="0"
                  value={l.rate}
                  disabled={saved}
                  onChange={(e) => setLine(l.key, { rate: e.target.value })}
                  className="h-9 rounded-sm text-right"
                />

                <div className="text-right tabular-nums text-sm font-medium">{inr(amount)}</div>

                <div className="flex justify-end gap-1">
                  {saved ? (
                    <span className="flex items-center gap-1 rounded-sm bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800" data-testid={`fast-saved-${idx}`}>
                      <Check className="h-3 w-3" /> Saved
                    </span>
                  ) : (
                    <>
                      <Button
                        data-testid={`fast-save-${idx}`}
                        size="sm"
                        disabled={l.status === "saving" || savingAll}
                        onClick={() => saveLine(l.key)}
                        className="h-8 gap-1 rounded-sm px-2"
                      >
                        <Save className="h-3.5 w-3.5" /> Save
                      </Button>
                      <Button
                        data-testid={`fast-remove-${idx}`}
                        variant="ghost"
                        size="icon"
                        onClick={() => removeLine(l.key)}
                        className="h-8 w-8 text-destructive"
                        title="Remove this row"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button data-testid="fast-add-line" variant="outline" onClick={addLine} className="gap-1 rounded-sm">
            <Plus className="h-4 w-4" /> Add Line
          </Button>
          <Button data-testid="fast-save-all" onClick={saveAll} disabled={savingAll} className="gap-1 rounded-sm">
            <Save className="h-4 w-4" /> Save All Rows
          </Button>
          {savedCount > 0 && (
            <Button data-testid="fast-clear-saved" variant="ghost" size="sm" onClick={clearSaved} className="rounded-sm">
              Clear {savedCount} saved row{savedCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm">
          {savedCount > 0 && <span className="font-semibold text-emerald-700" data-testid="fast-saved-count">{num(savedCount)} saved</span>}
          <span>
            Unsaved total: <span className="font-display text-lg font-bold tabular-nums" data-testid="fast-pending-total">{inr(pendingTotal)}</span>
          </span>
        </div>
      </div>

      <Dialog open={!!newMaster} onOpenChange={(v) => !v && setNewMaster(null)}>
        <DialogContent className="max-w-sm rounded-sm border-2 border-border" data-testid="fast-new-master-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">
              New {newMaster ? MASTER_LABEL[newMaster.type] : "record"}
            </DialogTitle>
            <DialogDescription>
              {newMaster?.type === "customers"
                ? "Add them without leaving the pad. City is required."
                : "Add it without leaving the pad. It joins the Masters list straight away."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              data-testid="fast-new-master-name"
              autoFocus
              value={newMaster?.name || ""}
              onChange={(e) => setNewMaster({ ...newMaster, name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && newMaster?.type !== "customers" && submitNewMaster()}
              placeholder={`${MASTER_LABEL[newMaster?.type] || "Record"} name`}
              className="rounded-sm border-2"
            />
            {newMaster?.type === "customers" && (
              <Input
                data-testid="fast-new-master-city"
                value={newMaster?.city || ""}
                onChange={(e) => setNewMaster({ ...newMaster, city: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && submitNewMaster()}
                placeholder="City"
                className="rounded-sm border-2"
              />
            )}
            {newMaster?.type === "brands" && (
              <div>
                <Input
                  data-testid="fast-new-master-rate"
                  type="number"
                  min="0"
                  value={newMaster?.rate ?? ""}
                  onChange={(e) => setNewMaster({ ...newMaster, rate: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && submitNewMaster()}
                  placeholder="Default rate (optional)"
                  className="rounded-sm border-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Fills the rate box on any row you pick this brand for. Leave it blank to type the rate each time.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewMaster(null)} className="rounded-sm">Cancel</Button>
            <Button data-testid="fast-new-master-save" onClick={submitNewMaster} className="rounded-sm">
              Add {newMaster ? MASTER_LABEL[newMaster.type] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
