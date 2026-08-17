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
// The counter keeps two rows created in the same millisecond from colliding.
let seq = 0;
const genOrderId = () => {
  seq = (seq + 1) % 1296;
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  return `SO-${stamp}${seq.toString(36).toUpperCase().padStart(2, "0")}`;
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

function CustomerPicker({ customers, value, onChange, onCreate, disabled, testid }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = customers.find((c) => c.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-testid={testid}
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-9 w-full justify-between rounded-sm px-2 font-normal"
        >
          <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>{selected ? selected.name : "Customer…"}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 rounded-sm p-0" align="start">
        <Command>
          <CommandInput placeholder="Type a name…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              <button
                type="button"
                data-testid="fast-customer-create"
                onClick={() => {
                  onCreate(query);
                  setOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm font-semibold text-primary hover:underline"
              >
                + Add “{query || "new customer"}”
              </button>
            </CommandEmpty>
            <CommandGroup>
              {customers.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.name} ${c.city || ""}`}
                  onSelect={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-3.5 w-3.5 ${c.id === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="truncate">{c.name}</span>
                  {c.city ? <span className="ml-1 truncate text-xs text-muted-foreground">· {c.city}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const COLS = "grid-cols-[112px_minmax(150px,1.3fr)_140px_minmax(150px,1.3fr)_84px_96px_110px_92px]";

export default function FastOrderEntry({ masters, onSaved, onCreateCustomer }) {
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
  const [newCust, setNewCust] = useState(null); // { rowKey, name, city }
  const [savingAll, setSavingAll] = useState(false);

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, blankLine()]);
  const removeLine = (key) => setLines((ls) => (ls.length === 1 ? [blankLine()] : ls.filter((l) => l.key !== key)));

  const selectBrand = (key, brandId) => {
    const b = masters.brands.find((x) => x.id === brandId);
    setLines((ls) =>
      ls.map((l) => {
        if (l.key !== key) return l;
        const rateEmpty = l.rate === "" || l.rate == null || Number(l.rate) === 0;
        return { ...l, brand_id: brandId, rate: rateEmpty && b?.rate ? b.rate : l.rate };
      })
    );
  };

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

  const openNewCustomer = (key, name) => setNewCust({ rowKey: key, name: name || "", city: "" });

  const submitNewCustomer = async () => {
    const name = (newCust.name || "").trim();
    const city = (newCust.city || "").trim();
    if (!name || !city) return toast.error("Name and city are both required");
    try {
      const c = await onCreateCustomer(name, city);
      if (!c) return; // near-duplicate warning declined - leave the box open to edit the name
      setLine(newCust.rowKey, { customer_id: c.id });
      setNewCust(null);
      toast.success(`${c.name} added`);
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
            <Select value={header.exhibition_id} onValueChange={(v) => setHeader({ ...header, exhibition_id: v })}>
              <SelectTrigger data-testid="fast-exhibition" className="mt-1 h-9 rounded-sm border-2 bg-background"><SelectValue placeholder="Select exhibition" /></SelectTrigger>
              <SelectContent>
                {masters.exhibitions.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label className="text-xs uppercase tracking-widest">Sales Man</Label>
            <Select value={header.salesman_id} onValueChange={(v) => setHeader({ ...header, salesman_id: v })}>
              <SelectTrigger data-testid="fast-salesman" className="mt-1 h-9 rounded-sm border-2 bg-background"><SelectValue placeholder="Select salesman" /></SelectTrigger>
              <SelectContent>
                {masters.salesmen.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label className="text-xs uppercase tracking-widest">Season</Label>
          <Select value={header.season_id} onValueChange={(v) => setHeader({ ...header, season_id: v })}>
            <SelectTrigger data-testid="fast-season" className="mt-1 h-9 rounded-sm border-2 bg-background"><SelectValue placeholder="Select season" /></SelectTrigger>
            <SelectContent>
              {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
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

                <CustomerPicker
                  testid={`fast-customer-${idx}`}
                  customers={masters.customers}
                  value={l.customer_id}
                  disabled={saved}
                  onChange={(id) => setLine(l.key, { customer_id: id })}
                  onCreate={(name) => openNewCustomer(l.key, name)}
                />

                <Input
                  data-testid={`fast-dispatch-date-${idx}`}
                  type="date"
                  value={l.dispatch_date}
                  disabled={saved}
                  onChange={(e) => setLine(l.key, { dispatch_date: e.target.value })}
                  className="h-9 rounded-sm"
                />

                <Select value={l.brand_id} onValueChange={(v) => selectBrand(l.key, v)} disabled={saved}>
                  <SelectTrigger data-testid={`fast-brand-${idx}`} className="h-9 rounded-sm"><SelectValue placeholder="Brand" /></SelectTrigger>
                  <SelectContent>
                    {masters.brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.rate ? ` · ₹${b.rate}` : ""}</SelectItem>)}
                  </SelectContent>
                </Select>

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

      <Dialog open={!!newCust} onOpenChange={(v) => !v && setNewCust(null)}>
        <DialogContent className="max-w-sm rounded-sm border-2 border-border" data-testid="fast-new-customer-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">New Customer</DialogTitle>
            <DialogDescription>Add them without leaving the pad. City is required.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              data-testid="fast-new-customer-name"
              autoFocus
              value={newCust?.name || ""}
              onChange={(e) => setNewCust({ ...newCust, name: e.target.value })}
              placeholder="Customer name"
              className="rounded-sm border-2"
            />
            <Input
              data-testid="fast-new-customer-city"
              value={newCust?.city || ""}
              onChange={(e) => setNewCust({ ...newCust, city: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && submitNewCustomer()}
              placeholder="City"
              className="rounded-sm border-2"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNewCust(null)} className="rounded-sm">Cancel</Button>
            <Button data-testid="fast-new-customer-save" onClick={submitNewCustomer} className="rounded-sm">Add Customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
