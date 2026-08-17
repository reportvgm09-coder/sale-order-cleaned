import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { num, inr, today, fmtDate } from "@/lib/format";
import { ExportDialog } from "@/components/ExportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Trash2, FileSpreadsheet, Truck, ChevronsUpDown, Check } from "lucide-react";

export default function DispatchOrders() {
  const [orders, setOrders] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [brands, setBrands] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [exhibitions, setExhibitions] = useState([]);
  const [salesmen, setSalesmen] = useState([]);
  const [selected, setSelected] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [dispatchDate, setDispatchDate] = useState(today());
  const [qtyMap, setQtyMap] = useState({});
  const [amtMap, setAmtMap] = useState({});
  const [selRows, setSelRows] = useState([]);
  const [exportOpen, setExportOpen] = useState(false);
  const { requireUnlock } = useAuth();

  const toggleSel = (id) => setSelRows((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const bulkDelete = () =>
    requireUnlock(async () => {
      if (!window.confirm(`Delete ${selRows.length} selected dispatch record(s)?`)) return;
      try {
        await api.bulkDeleteDispatches(selRows);
        toast.success(`Deleted ${selRows.length} dispatch(es)`);
        setSelRows([]);
        load();
      } catch (e) {
        toast.error(apiErr(e));
      }
    });

  const brandName = (id) => brands.find((b) => b.id === id)?.name || "—";
  const customerName = (soId) => {
    const o = orders.find((x) => x.id === soId);
    return customers.find((c) => c.id === o?.customer_id)?.name || "Unassigned";
  };
  const eventInfo = (o) => {
    if ((o.event_type || "exhibition") === "door_to_door") {
      const s = salesmen.find((x) => x.id === o.salesman_id)?.name;
      return { type: "Door to Door", detail: s || "—" };
    }
    const e = exhibitions.find((x) => x.id === o.exhibition_id)?.name;
    return { type: "Exhibition", detail: e || "—" };
  };
  const itemsSummary = (o) =>
    (o.items || [])
      .map((it) => `${brands.find((b) => b.id === it.brand_id)?.name || "?"} × ${num(it.qty)}`)
      .join(", ");

  const load = async () => {
    try {
      const [o, d, b, c, ex, sm] = await Promise.all([
        api.listSaleOrders(),
        api.listDispatches(),
        api.listMasters("brands"),
        api.listMasters("customers"),
        api.listMasters("exhibitions"),
        api.listMasters("salesmen"),
      ]);
      setOrders(o);
      setDispatches(d);
      setBrands(b);
      setCustomers(c);
      setExhibitions(ex);
      setSalesmen(sm);
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const order = orders.find((o) => o.id === selected);

  // per-brand ordered & already dispatched for selected order
  const rows = useMemo(() => {
    if (!order) return [];
    const ordered = {};
    const value = {};
    (order.items || []).forEach((it) => {
      const q = Number(it.qty) || 0;
      ordered[it.brand_id] = (ordered[it.brand_id] || 0) + q;
      value[it.brand_id] = (value[it.brand_id] || 0) + q * (Number(it.rate) || 0);
    });
    const already = {};
    dispatches
      .filter((d) => d.sale_order_id === order.id)
      .forEach((d) => (d.items || []).forEach((it) => (already[it.brand_id] = (already[it.brand_id] || 0) + (Number(it.qty) || 0))));
    return Object.keys(ordered).map((bid) => ({
      brand_id: bid,
      ordered: ordered[bid],
      dispatched: already[bid] || 0,
      pending: Math.max(0, ordered[bid] - (already[bid] || 0)),
      // blended, because one brand can sit on several order lines at different rates
      rate: ordered[bid] > 0 ? value[bid] / ordered[bid] : 0,
    }));
  }, [order, dispatches]);

  const onSelect = (v) => {
    setSelected(v);
    setQtyMap({});
    setAmtMap({});
    setComboOpen(false);
  };

  const submit = async () => {
    if (!selected) return toast.error("Select a sale order");
    const items = rows
      .map((r) => {
        const typed = String(amtMap[r.brand_id] ?? "").trim();
        return {
          brand_id: r.brand_id,
          qty: Number(qtyMap[r.brand_id]) || 0,
          // blank means "value it at the order rate", exactly as before
          amount: typed === "" ? null : Number(typed) || 0,
        };
      })
      .filter((it) => it.qty > 0);
    if (items.length === 0) return toast.error("Enter a dispatch quantity");
    const negative = items.find((it) => it.amount !== null && it.amount < 0);
    if (negative) return toast.error(`Amount cannot be negative for ${brandName(negative.brand_id)}`);
    const over = items.find((it) => {
      const r = rows.find((x) => x.brand_id === it.brand_id);
      return it.qty > r.pending;
    });
    if (over) return toast.error(`Dispatch qty exceeds pending for ${brandName(over.brand_id)}`);
    try {
      await api.createDispatch({ sale_order_id: selected, dispatch_date: dispatchDate, items });
      toast.success("Dispatch saved");
      setQtyMap({});
      setAmtMap({});
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this dispatch record?")) return;
    try {
      await api.deleteDispatch(id);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  const exportSheets = [
    {
      name: "Dispatch History",
      data: dispatches.flatMap((d) => (d.items || []).map((it) => ({ d, it }))),
      columns: [
        { key: "Dispatch", get: (x) => x.d.id },
        { key: "Sale Order", get: (x) => x.d.sale_order_id },
        { key: "Customer", get: (x) => customerName(x.d.sale_order_id) },
        { key: "Date", get: (x) => x.d.dispatch_date || "" },
        { key: "Brand", get: (x) => brandName(x.it.brand_id) },
        { key: "Qty", get: (x) => x.it.qty },
        { key: "Actual Amount", get: (x) => (x.it.amount == null ? "" : x.it.amount) },
      ],
    },
  ];

  return (
    <div className="space-y-6" data-testid="dispatch-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Dispatch Orders</h1>
        <p className="text-sm text-muted-foreground">Record dispatches against open sale orders.</p>
      </div>

      <Card className="rounded-sm border-border p-5 shadow-none">
        <h2 className="mb-4 font-display text-lg font-bold tracking-tight">New Dispatch</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label className="text-xs uppercase tracking-widest">Sale Order</Label>
            <Popover open={comboOpen} onOpenChange={setComboOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  data-testid="dispatch-so-select"
                  className="mt-1 w-full justify-between rounded-sm border-2 font-normal"
                >
                  {selected ? `${selected} · ${customerName(selected)}` : "Search sale order…"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] rounded-sm border-2 p-0" align="start">
                <Command>
                  <CommandInput data-testid="dispatch-so-search" placeholder="Search by order id or customer…" />
                  <CommandList>
                    <CommandEmpty>No sale order found.</CommandEmpty>
                    <CommandGroup>
                      {orders.map((o) => {
                        const ev = eventInfo(o);
                        return (
                          <CommandItem
                            key={o.id}
                            value={`${o.id} ${customerName(o.id)} ${itemsSummary(o)} ${ev.type} ${ev.detail}`}
                            onSelect={() => onSelect(o.id)}
                            data-testid={`dispatch-so-option-${o.id}`}
                            className="flex-col items-start gap-1 py-2"
                          >
                            <div className="flex w-full items-center gap-2">
                              <Check className={`h-4 w-4 ${selected === o.id ? "opacity-100" : "opacity-0"}`} />
                              <span className="font-mono font-semibold">{o.id}</span>
                              <span className="text-xs text-muted-foreground">· {customerName(o.id)}</span>
                              <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">{num(o.totals.pending_qty)} pending</span>
                            </div>
                            <div className="pl-6 text-xs text-muted-foreground">
                              <div className="font-medium text-foreground/80">{itemsSummary(o) || "No items"}</div>
                              <div>{ev.type}{ev.detail !== "—" ? ` · ${ev.detail}` : ""}</div>
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Dispatch Date</Label>
            <Input data-testid="dispatch-date-input" type="date" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} className="mt-1 rounded-sm" />
          </div>
        </div>

        {order && (
          <div className="mt-5 rounded-sm border border-border">
            <div className="grid grid-cols-[1fr_90px_110px_90px_120px_150px] gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <div>Brand</div><div className="text-right">Ordered</div><div className="text-right">Dispatched</div><div className="text-right">Pending</div><div className="text-right">Dispatch Now</div><div className="text-right">Actual Amount ₹</div>
            </div>
            {rows.map((r) => {
              const q = Number(qtyMap[r.brand_id]) || 0;
              const suggested = q * (r.rate || 0);
              const typed = String(amtMap[r.brand_id] ?? "").trim();
              return (
                <div key={r.brand_id} className="grid grid-cols-[1fr_90px_110px_90px_120px_150px] items-center gap-2 px-3 py-2" data-testid={`dispatch-item-${r.brand_id}`}>
                  <div className="font-medium">{brandName(r.brand_id)}</div>
                  <div className="text-right tabular-nums">{num(r.ordered)}</div>
                  <div className="text-right tabular-nums text-muted-foreground">{num(r.dispatched)}</div>
                  <div className="text-right tabular-nums font-semibold text-amber-700">{num(r.pending)}</div>
                  <div className="flex justify-end">
                    <Input
                      data-testid={`dispatch-qty-${r.brand_id}`}
                      type="number"
                      min="0"
                      max={r.pending}
                      disabled={r.pending === 0}
                      value={qtyMap[r.brand_id] || ""}
                      onChange={(e) => setQtyMap({ ...qtyMap, [r.brand_id]: e.target.value })}
                      className="w-24 rounded-sm text-right"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex flex-col items-end">
                    <Input
                      data-testid={`dispatch-amount-${r.brand_id}`}
                      type="number"
                      min="0"
                      disabled={r.pending === 0}
                      value={amtMap[r.brand_id] ?? ""}
                      onChange={(e) => setAmtMap({ ...amtMap, [r.brand_id]: e.target.value })}
                      className="w-32 rounded-sm text-right"
                      placeholder={q > 0 ? String(Math.round(suggested)) : "optional"}
                    />
                    {q > 0 && (
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        {typed === "" ? `${inr(suggested)} at order rate` : `${inr((Number(typed) || 0) / q)} each`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="border-t border-border p-3">
              <Button data-testid="save-dispatch-btn" onClick={submit} className="gap-2 rounded-sm">
                <Truck className="h-4 w-4" /> Save Dispatch
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card className="rounded-sm border-border shadow-none">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Dispatch History</h2>
          <Button data-testid="dispatch-export-btn" variant="outline" size="sm" onClick={() => setExportOpen(true)} className="gap-1 rounded-sm">
            <FileSpreadsheet className="h-4 w-4" /> Export
          </Button>
        </div>
        {selRows.length > 0 && (
          <div className="flex items-center justify-between border-b border-border bg-accent/40 px-4 py-2" data-testid="dispatch-bulk-bar">
            <span className="text-sm font-medium">{selRows.length} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelRows([])} className="rounded-sm">Clear</Button>
              <Button data-testid="dispatch-bulk-delete" variant="destructive" size="sm" onClick={bulkDelete} className="gap-1 rounded-sm">
                <Trash2 className="h-4 w-4" /> Delete Selected
              </Button>
            </div>
          </div>
        )}
        {dispatches.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No dispatches recorded yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="w-10">
                  <Checkbox data-testid="dispatch-select-all" checked={dispatches.length > 0 && selRows.length === dispatches.length} onCheckedChange={(v) => setSelRows(v ? dispatches.map((d) => d.id) : [])} />
                </TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Dispatch</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Sale Order</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Items</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Total Pcs</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatches.map((d) => {
                const totalPcs = (d.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
                return (
                  <TableRow key={d.id} className="hover:bg-secondary/40" data-testid={`dispatch-row-${d.id}`}>
                    <TableCell>
                      <Checkbox data-testid={`dispatch-select-${d.id}`} checked={selRows.includes(d.id)} onCheckedChange={() => toggleSel(d.id)} />
                    </TableCell>
                    <TableCell className="font-mono font-semibold">{d.id}</TableCell>
                    <TableCell className="font-mono">{d.sale_order_id}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(d.dispatch_date)}</TableCell>
                    <TableCell className="text-sm">
                      {(d.items || []).map((it) => `${brandName(it.brand_id)} × ${num(it.qty)}`).join(", ")}
                      <div className="text-xs text-muted-foreground">
                        {d.total_amount == null
                          ? "valued at order rates"
                          : `${inr(d.total_amount)}${d.fully_priced ? "" : " (part actual)"}`}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">{num(totalPcs)}</TableCell>
                    <TableCell className="text-right">
                      <Button data-testid={`dispatch-delete-${d.id}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => requireUnlock(() => remove(d.id))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="dispatch-total-row">
                <TableCell colSpan={5}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(dispatches.reduce((s, d) => s + (d.items || []).reduce((x, it) => x + (Number(it.qty) || 0), 0), 0))}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="dispatch-history"
        fileName={`dispatch-history-${today()}.xlsx`}
        sheets={exportSheets}
      />
    </div>
  );
}
