import { useEffect, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { addMasterConfirmed } from "@/lib/masters";
import { useAuth } from "@/context/Auth";
import { inr, num, today } from "@/lib/format";
import { readWorkbookRows, downloadTemplateWithLists } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, Progress } from "@/components/StatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import FastOrderEntry from "@/components/FastOrderEntry";
import { ExportDialog } from "@/components/ExportDialog";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, X, FileSpreadsheet, Upload, Download, ScrollText, Zap } from "lucide-react";

const blankItem = () => ({ id: `tmp-${Math.random().toString(36).slice(2, 8)}`, brand_id: "", rate: "", qty: "" });
const genOrderId = () => `SO-${Date.now().toString(36).toUpperCase().slice(-6)}`;
const blankDraft = () => ({
  id: genOrderId(),
  order_date: today(),
  customer_id: "",
  dispatch_date: "",
  event_type: "exhibition",
  exhibition_id: "",
  salesman_id: "",
  season_id: "",
  items: [blankItem()],
});

export default function SaleOrders() {
  const [orders, setOrders] = useState([]);
  const [masters, setMasters] = useState({ customers: [], brands: [], exhibitions: [], salesmen: [], seasons: [] });
  const [draft, setDraft] = useState(blankDraft());
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ customer: "all", status: "all" });
  const [selected, setSelected] = useState([]);
  const [showNewCust, setShowNewCust] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", city: "" });
  const [importPreview, setImportPreview] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState("single"); // "single" = one order at a time, "fast" = grid pad
  const { requireUnlock } = useAuth();

  // Shared by both entry modes so the customer list only ever updates in one place.
  // Returns null if the near-duplicate warning made the user think again.
  const createCustomer = async (name, city) => {
    const c = await addMasterConfirmed("customers", { name, city });
    if (!c) return null;
    setMasters((m) => ({ ...m, customers: [...m.customers, c].sort((a, b) => a.name.localeCompare(b.name)) }));
    return c;
  };

  const addCustomer = async () => {
    if (!newCust.name.trim() || !newCust.city.trim()) return toast.error("Name and city are required");
    try {
      const c = await createCustomer(newCust.name.trim(), newCust.city.trim());
      if (!c) return;
      setDraft((d) => ({ ...d, customer_id: c.id }));
      setNewCust({ name: "", city: "" });
      setShowNewCust(false);
      toast.success("Customer added");
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const toggleSel = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const bulkDelete = () =>
    requireUnlock(async () => {
      if (!window.confirm(`Delete ${selected.length} selected sale order(s) and their dispatches?`)) return;
      try {
        await api.bulkDeleteSaleOrders(selected);
        toast.success(`Deleted ${selected.length} order(s)`);
        setSelected([]);
        load();
      } catch (e) {
        toast.error(apiErr(e));
      }
    });

  const nameOf = (list, id) => masters[list].find((m) => m.id === id)?.name || "—";
  const cityOf = (id) => masters.customers.find((m) => m.id === id)?.city || "";

  const load = async () => {
    try {
      const [o, c, b, e, s, se] = await Promise.all([
        api.listSaleOrders(),
        api.listMasters("customers"),
        api.listMasters("brands"),
        api.listMasters("exhibitions"),
        api.listMasters("salesmen"),
        api.listMasters("seasons"),
      ]);
      setOrders(o);
      setMasters({ customers: c, brands: b, exhibitions: e, salesmen: s, seasons: se });
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setItem = (idx, key, val) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)) }));
  const selectBrand = (idx, brandId) => {
    const b = masters.brands.find((x) => x.id === brandId);
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, i) => {
        if (i !== idx) return it;
        const empty = it.rate === "" || it.rate == null || Number(it.rate) === 0;
        return { ...it, brand_id: brandId, rate: empty && b?.rate ? b.rate : it.rate };
      }),
    }));
  };
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
  const removeItem = (idx) => setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));

  const total = draft.items.reduce((s, it) => s + (Number(it.rate) || 0) * (Number(it.qty) || 0), 0);

  const resetForm = () => {
    setDraft(blankDraft());
    setEditing(null);
  };

  const submit = async () => {
    if (!draft.id.trim()) return toast.error("Sale Order ID is required");
    if (!draft.customer_id) return toast.error("Select a customer");
    const items = draft.items
      .filter((it) => it.brand_id && Number(it.qty) > 0)
      .map((it) => ({ brand_id: it.brand_id, rate: Number(it.rate) || 0, qty: Number(it.qty) || 0 }));
    if (items.length === 0) return toast.error("Add at least one item with brand and quantity");
    const payload = {
      id: draft.id.trim(),
      order_date: draft.order_date,
      customer_id: draft.customer_id,
      dispatch_date: draft.dispatch_date || null,
      event_type: draft.event_type,
      exhibition_id: draft.event_type === "exhibition" ? draft.exhibition_id || null : null,
      salesman_id: draft.event_type === "door_to_door" ? draft.salesman_id || null : null,
      season_id: draft.season_id || null,
      items,
    };
    try {
      if (editing) {
        await api.updateSaleOrder(editing, payload);
        toast.success("Sale order updated");
      } else {
        await api.createSaleOrder(payload);
        toast.success("Sale order saved");
      }
      resetForm();
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  const startEdit = (o) => {
    setEditing(o.id);
    setDraft({
      id: o.id,
      order_date: o.order_date || today(),
      customer_id: o.customer_id || "",
      dispatch_date: o.dispatch_date || "",
      event_type: o.event_type || "exhibition",
      exhibition_id: o.exhibition_id || "",
      salesman_id: o.salesman_id || "",
      season_id: o.season_id || "",
      items: (o.items || []).map((it) => ({ id: it.id, brand_id: it.brand_id, rate: it.rate, qty: it.qty })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (id) => {
    if (!window.confirm(`Delete sale order ${id}? Related dispatches will also be removed.`)) return;
    try {
      await api.deleteSaleOrder(id);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  const exportSheets = [
    {
      name: "Sale Orders",
      data: orders.flatMap((o) => (o.items || []).map((it) => ({ o, it }))),
      columns: [
        { key: "Sale Order", get: (x) => x.o.id },
        { key: "Customer", get: (x) => nameOf("customers", x.o.customer_id) },
        { key: "City", get: (x) => cityOf(x.o.customer_id) },
        { key: "Order Date", get: (x) => x.o.order_date || "" },
        { key: "Dispatch Date", get: (x) => x.o.dispatch_date || "" },
        { key: "Event Type", get: (x) => (x.o.event_type === "door_to_door" ? "Door to Door" : "Exhibition") },
        { key: "Exhibition", get: (x) => nameOf("exhibitions", x.o.exhibition_id) },
        { key: "Salesman", get: (x) => nameOf("salesmen", x.o.salesman_id) },
        { key: "Season", get: (x) => nameOf("seasons", x.o.season_id) },
        { key: "Brand", get: (x) => nameOf("brands", x.it.brand_id) },
        { key: "Rate", get: (x) => x.it.rate },
        { key: "Qty", get: (x) => x.it.qty },
        { key: "Amount", get: (x) => (Number(x.it.rate) || 0) * (Number(x.it.qty) || 0) },
        { key: "Status", get: (x) => x.o.totals.status },
      ],
    },
    {
      name: "Order Totals",
      data: orders,
      columns: [
        { key: "Sale Order", get: (o) => o.id },
        { key: "Customer", get: (o) => nameOf("customers", o.customer_id) },
        { key: "Order Date", get: (o) => o.order_date || "" },
        { key: "Ordered", get: (o) => o.totals.ordered_qty },
        { key: "Dispatched", get: (o) => o.totals.dispatched_qty },
        { key: "Pending", get: (o) => o.totals.pending_qty },
        { key: "Amount", get: (o) => o.totals.amount },
        { key: "Status", get: (o) => o.totals.status },
      ],
    },
  ];

  const downloadTemplate = () => {
    const columns = ["Sale Order", "Customer", "City", "Order Date", "Dispatch Date", "Event Type", "Exhibition", "Salesman", "Season", "Brand", "Rate", "Qty"];
    const sample = ["SO-1001", masters.customers[0]?.name || "Acme Traders", masters.customers[0]?.city || "Mumbai", today(), "", "exhibition", masters.exhibitions[0]?.name || "", "", masters.seasons[0]?.name || "", masters.brands[0]?.name || "Nova Wear", 500, 20];
    const lists = {
      Customer: masters.customers.map((c) => c.name),
      City: Array.from(new Set(masters.customers.map((c) => c.city).filter(Boolean))),
      "Event Type": ["exhibition", "door_to_door"],
      Exhibition: masters.exhibitions.map((x) => x.name),
      Salesman: masters.salesmen.map((x) => x.name),
      Season: masters.seasons.map((x) => x.name),
      Brand: masters.brands.map((b) => b.name),
    };
    downloadTemplateWithLists(columns, sample, lists, "sale-orders-template.xlsx");
  };

  const parseImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readWorkbookRows(file);
      const findId = (list, name) => masters[list].find((m) => m.name.toLowerCase() === String(name).trim().toLowerCase())?.id || null;
      const existing = new Set(orders.map((o) => o.id));
      const grouped = {};
      const issues = [];
      rows.forEach((r, i) => {
        const rowNo = i + 2;
        const oid = String(r["Sale Order"] || r["SaleOrder"] || r["ID"] || "").trim();
        if (!oid) { issues.push({ row: rowNo, level: "error", msg: "Missing Sale Order ID — row skipped" }); return; }
        if (!grouped[oid]) {
          const rawEvent = String(r["Event Type"] || r["Event"] || "").trim().toLowerCase().replace(/\s+/g, "_");
          const eventType = rawEvent === "door_to_door" ? "door_to_door" : "exhibition";
          const custName = String(r["Customer"] || "").trim();
          const customer_id = findId("customers", custName);
          if (!customer_id) issues.push({ row: rowNo, so: oid, level: "error", msg: `Customer "${custName || "(blank)"}" not found in Masters` });
          if (existing.has(oid)) issues.push({ row: rowNo, so: oid, level: "warn", msg: `Sale Order "${oid}" already exists — will be skipped` });
          let exhibition_id = null, salesman_id = null, season_id = null;
          if (eventType === "exhibition" && String(r["Exhibition"] || "").trim()) { exhibition_id = findId("exhibitions", r["Exhibition"]); if (!exhibition_id) issues.push({ row: rowNo, so: oid, level: "warn", msg: `Exhibition "${r["Exhibition"]}" not found — left blank` }); }
          if (eventType === "door_to_door" && String(r["Salesman"] || "").trim()) { salesman_id = findId("salesmen", r["Salesman"]); if (!salesman_id) issues.push({ row: rowNo, so: oid, level: "warn", msg: `Salesman "${r["Salesman"]}" not found — left blank` }); }
          if (String(r["Season"] || "").trim()) { season_id = findId("seasons", r["Season"]); if (!season_id) issues.push({ row: rowNo, so: oid, level: "warn", msg: `Season "${r["Season"]}" not found — left blank` }); }
          grouped[oid] = { id: oid, order_date: String(r["Order Date"] || "").slice(0, 10) || today(), customer_id, dispatch_date: String(r["Dispatch Date"] || "").slice(0, 10) || null, event_type: eventType, exhibition_id, salesman_id, season_id, items: [] };
        }
        const brandName = String(r["Brand"] || "").trim();
        const brandId = findId("brands", brandName);
        if (!brandName) issues.push({ row: rowNo, so: oid, level: "warn", msg: "No Brand on this line — skipped" });
        else if (!brandId) issues.push({ row: rowNo, so: oid, level: "error", msg: `Brand "${brandName}" not found in Masters` });
        else {
          const brand = masters.brands.find((b) => b.id === brandId);
          const rate = r["Rate"] !== undefined && r["Rate"] !== "" ? Number(r["Rate"]) : (brand?.rate || 0);
          const qty = Number(r["Qty"]) || 0;
          if (qty <= 0) issues.push({ row: rowNo, so: oid, level: "warn", msg: `Qty is 0 for ${brandName}` });
          grouped[oid].items.push({ brand_id: brandId, rate: rate || 0, qty });
        }
      });
      const all = Object.values(grouped);
      const valid = all.filter((o) => o.customer_id && o.items.length && !existing.has(o.id));
      const skipCount = all.length - valid.length;
      setImportPreview({ fileName: file.name, totalRows: rows.length, valid, skipCount, issues });
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      e.target.value = "";
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.valid?.length) return toast.error("No valid orders to import");
    try {
      const res = await api.bulkSaleOrders(importPreview.valid);
      toast.success(`Imported ${res.added}, skipped ${res.skipped}`);
      setImportPreview(null);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const filtered = orders.filter(
    (o) => (filter.customer === "all" || o.customer_id === filter.customer) && (filter.status === "all" || o.totals.status === filter.status)
  );

  const listTotals = filtered.reduce(
    (a, o) => ({ ordered: a.ordered + o.totals.ordered_qty, pending: a.pending + o.totals.pending_qty, amount: a.amount + o.totals.amount }),
    { ordered: 0, pending: 0, amount: 0 }
  );

  return (
    <div className="space-y-6" data-testid="sale-orders-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Sale Orders</h1>
          <p className="text-sm text-muted-foreground">Create orders, add line items and track fulfilment.</p>
        </div>
        <div className="flex items-center gap-1 rounded-sm border-2 border-border p-1" data-testid="so-mode-toggle">
          <Button
            data-testid="so-mode-single"
            variant={mode === "single" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("single")}
            className="gap-1 rounded-sm"
          >
            <ScrollText className="h-4 w-4" /> Single Order
          </Button>
          <Button
            data-testid="so-mode-fast"
            variant={mode === "fast" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("fast")}
            className="gap-1 rounded-sm"
          >
            <Zap className="h-4 w-4" /> Fast Entry
          </Button>
        </div>
      </div>

      {mode === "fast" && (
        <FastOrderEntry masters={masters} onSaved={load} onCreateCustomer={createCustomer} />
      )}

      {/* Form */}
      {mode === "single" && (
      <Card className="rounded-sm border-border p-5 shadow-none">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold tracking-tight">{editing ? `Edit Order ${editing}` : "New Sale Order"}</h2>
          {editing && (
            <Button data-testid="cancel-edit-btn" variant="ghost" size="sm" onClick={resetForm} className="gap-1">
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs uppercase tracking-widest">Sale Order ID</Label>
            <Input data-testid="so-id-input" value={draft.id} readOnly onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="auto" className="mt-1 rounded-sm bg-secondary/60" />
            <p className="mt-1 text-[10px] text-muted-foreground">Auto-generated</p>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Order Date</Label>
            <Input data-testid="so-order-date" type="date" value={draft.order_date} onChange={(e) => setDraft({ ...draft, order_date: e.target.value })} className="mt-1 rounded-sm" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Dispatch Date</Label>
            <Input data-testid="so-dispatch-date" type="date" value={draft.dispatch_date} onChange={(e) => setDraft({ ...draft, dispatch_date: e.target.value })} className="mt-1 rounded-sm" />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-widest">Customer</Label>
              <button type="button" data-testid="so-new-customer-btn" onClick={() => setShowNewCust(true)} className="text-[10px] font-semibold text-primary hover:underline">+ New</button>
            </div>
            <Select value={draft.customer_id} onValueChange={(v) => setDraft({ ...draft, customer_id: v })}>
              <SelectTrigger data-testid="so-customer-select" className="mt-1 rounded-sm"><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {masters.customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Event Type</Label>
            <Select value={draft.event_type} onValueChange={(v) => setDraft({ ...draft, event_type: v })}>
              <SelectTrigger data-testid="so-event-type" className="mt-1 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exhibition">Exhibition</SelectItem>
                <SelectItem value="door_to_door">Door to Door</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.event_type === "exhibition" ? (
            <div>
              <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
              <Select value={draft.exhibition_id} onValueChange={(v) => setDraft({ ...draft, exhibition_id: v })}>
                <SelectTrigger data-testid="so-exhibition-select" className="mt-1 rounded-sm"><SelectValue placeholder="Select exhibition" /></SelectTrigger>
                <SelectContent>
                  {masters.exhibitions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-widest">Sales Man</Label>
              <Select value={draft.salesman_id} onValueChange={(v) => setDraft({ ...draft, salesman_id: v })}>
                <SelectTrigger data-testid="so-salesman-select" className="mt-1 rounded-sm"><SelectValue placeholder="Select salesman" /></SelectTrigger>
                <SelectContent>
                  {masters.salesmen.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-widest">Season</Label>
            <Select value={draft.season_id} onValueChange={(v) => setDraft({ ...draft, season_id: v })}>
              <SelectTrigger data-testid="so-season-select" className="mt-1 rounded-sm"><SelectValue placeholder="Select season" /></SelectTrigger>
              <SelectContent>
                {masters.seasons.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Line items */}
        <div className="mt-6 rounded-sm border border-border">
          <div className="grid grid-cols-[1fr_120px_120px_140px_40px] gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <div>Brand</div><div>Rate (₹)</div><div>Qty</div><div className="text-right">Amount</div><div />
          </div>
          {draft.items.map((it, idx) => (
            <div key={it.id} className="grid grid-cols-[1fr_120px_120px_140px_40px] items-center gap-2 px-3 py-2" data-testid={`item-row-${idx}`}>
              <Select value={it.brand_id} onValueChange={(v) => selectBrand(idx, v)}>
                <SelectTrigger data-testid={`item-brand-${idx}`} className="rounded-sm"><SelectValue placeholder="Brand" /></SelectTrigger>
                <SelectContent>
                  {masters.brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.rate ? ` · ₹${b.rate}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input data-testid={`item-rate-${idx}`} type="number" value={it.rate} onChange={(e) => setItem(idx, "rate", e.target.value)} className="rounded-sm" />
              <Input data-testid={`item-qty-${idx}`} type="number" value={it.qty} onChange={(e) => setItem(idx, "qty", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} className="rounded-sm" />
              <div className="text-right tabular-nums font-medium">{inr((Number(it.rate) || 0) * (Number(it.qty) || 0))}</div>
              <Button data-testid={`item-remove-${idx}`} variant="ghost" size="icon" onClick={() => removeItem(idx)} className="h-8 w-8 text-destructive">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <Button data-testid="add-item-btn" variant="outline" size="sm" onClick={addItem} className="gap-1 rounded-sm">
              <Plus className="h-4 w-4" /> Add Item Row
            </Button>
            <div className="text-sm">Total: <span className="font-display text-lg font-bold tabular-nums" data-testid="so-total">{inr(total)}</span></div>
          </div>
        </div>

        <div className="mt-4">
          <Button data-testid="save-so-btn" onClick={submit} className="rounded-sm">
            {editing ? "Save Changes" : "Save Sale Order"}
          </Button>
        </div>
      </Card>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="sale-orders"
        fileName={`sale-orders-${today()}.xlsx`}
        sheets={exportSheets}
      />

      <Dialog open={showNewCust} onOpenChange={setShowNewCust}>
        <DialogContent className="max-w-sm rounded-sm border-2 border-border" data-testid="new-customer-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">New Customer</DialogTitle>
            <DialogDescription>Add a customer without leaving this form.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input data-testid="new-customer-name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="Customer name" className="rounded-sm border-2" />
            <Input data-testid="new-customer-city" value={newCust.city} onChange={(e) => setNewCust({ ...newCust, city: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCustomer()} placeholder="City" className="rounded-sm border-2" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewCust(false)} className="rounded-sm">Cancel</Button>
            <Button data-testid="new-customer-save" onClick={addCustomer} className="rounded-sm">Add Customer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!importPreview} onOpenChange={(v) => !v && setImportPreview(null)}>
        <DialogContent className="max-w-xl rounded-sm border-2 border-border" data-testid="import-preview-dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Import Preview</DialogTitle>
            <DialogDescription>{importPreview?.fileName} · {importPreview?.totalRows} rows read</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 text-sm">
            <span className="rounded-sm border-2 border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700" data-testid="import-valid-count">{importPreview?.valid?.length || 0} ready to import</span>
            <span className="rounded-sm border-2 border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-700" data-testid="import-skip-count">{importPreview?.skipCount || 0} skipped</span>
          </div>
          <div className="max-h-64 overflow-auto rounded-sm border border-border" data-testid="import-issues">
            {(!importPreview?.issues || importPreview.issues.length === 0) ? (
              <div className="p-4 text-center text-sm text-emerald-700">No problems found — everything matches your masters.</div>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {importPreview.issues.map((is, i) => (
                  <li key={i} className="flex items-start gap-2 px-3 py-2" data-testid={`import-issue-${i}`}>
                    <span className={`mt-0.5 rounded px-1.5 text-[10px] font-bold uppercase ${is.level === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{is.level}</span>
                    <span><span className="font-mono text-xs text-muted-foreground">Row {is.row}{is.so ? ` · ${is.so}` : ""}:</span> {is.msg}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportPreview(null)} className="rounded-sm">Cancel</Button>
            <Button data-testid="import-confirm-btn" onClick={confirmImport} disabled={!importPreview?.valid?.length} className="rounded-sm">
              Import {importPreview?.valid?.length || 0} Order(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Import */}
      <Card className="rounded-sm border-border p-4 shadow-none">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Import from Excel:</span>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-input px-3 py-1.5 text-sm hover:bg-secondary">
            <Upload className="h-4 w-4" /> Choose File
            <input data-testid="so-import-input" type="file" accept=".xlsx,.xls,.csv" onChange={parseImport} className="hidden" />
          </label>
          <Button data-testid="so-template-btn" variant="ghost" size="sm" onClick={downloadTemplate} className="gap-1">
            <Download className="h-4 w-4" /> Download template
          </Button>
          <span className="text-xs text-muted-foreground">Customer & Brand names must match Masters.</span>
        </div>
      </Card>

      {/* List */}
      <Card className="rounded-sm border-border shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">All Sale Orders</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={filter.customer} onValueChange={(v) => setFilter({ ...filter, customer: v })}>
              <SelectTrigger data-testid="filter-customer" className="h-9 w-44 rounded-sm"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {masters.customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filter.status} onValueChange={(v) => setFilter({ ...filter, status: v })}>
              <SelectTrigger data-testid="filter-status" className="h-9 w-36 rounded-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
            <Button data-testid="so-export-btn" variant="outline" size="sm" onClick={() => setExportOpen(true)} className="gap-1 rounded-sm">
              <FileSpreadsheet className="h-4 w-4" /> Export
            </Button>
          </div>
        </div>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-b border-border bg-accent/40 px-4 py-2" data-testid="so-bulk-bar">
            <span className="text-sm font-medium">{selected.length} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected([])} className="rounded-sm">Clear</Button>
              <Button data-testid="so-bulk-delete" variant="destructive" size="sm" onClick={bulkDelete} className="gap-1 rounded-sm">
                <Trash2 className="h-4 w-4" /> Delete Selected
              </Button>
            </div>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No sale orders yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="w-10">
                  <Checkbox
                    data-testid="so-select-all"
                    checked={filtered.length > 0 && selected.length === filtered.length}
                    onCheckedChange={(v) => setSelected(v ? filtered.map((o) => o.id) : [])}
                  />
                </TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Order</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Customer</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Ordered</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Fulfilment</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Amount</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Status</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id} className="hover:bg-secondary/40" data-testid={`so-row-${o.id}`}>
                  <TableCell>
                    <Checkbox data-testid={`so-select-${o.id}`} checked={selected.includes(o.id)} onCheckedChange={() => toggleSel(o.id)} />
                  </TableCell>
                  <TableCell className="font-mono font-semibold">{o.id}</TableCell>
                  <TableCell>{nameOf("customers", o.customer_id)}{cityOf(o.customer_id) ? <span className="ml-1 text-xs text-muted-foreground">· {cityOf(o.customer_id)}</span> : null}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(o.totals.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(o.totals.pending_qty)}</TableCell>
                  <TableCell><Progress ordered={o.totals.ordered_qty} dispatched={o.totals.dispatched_qty} /></TableCell>
                  <TableCell className="text-right tabular-nums">{inr(o.totals.amount)}</TableCell>
                  <TableCell><StatusBadge status={o.totals.status} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button data-testid={`so-edit-${o.id}`} variant="ghost" size="icon" className="h-8 w-8" onClick={() => requireUnlock(() => startEdit(o))}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button data-testid={`so-delete-${o.id}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => requireUnlock(() => remove(o.id))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="so-total-row">
                <TableCell colSpan={3}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(listTotals.ordered)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(listTotals.pending)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{inr(listTotals.amount)}</TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
