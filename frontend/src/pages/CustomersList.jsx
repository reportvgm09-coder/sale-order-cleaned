import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, apiErr } from "@/lib/api";
import { inr, num } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Building2, ArrowRight, Search, FilterX } from "lucide-react";
import { Loader } from "@/components/Loader";

// "Active" means the customer still has pieces waiting to go out, i.e. at least
// one order that is pending or partly dispatched.
const isActive = (c) => (c.pending_qty || 0) > 0;

export default function CustomersList() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.listCustomers());
      } catch (e) {
        toast.error(apiErr(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeCount = rows.filter(isActive).length;

  const filtered = rows.filter((c) => {
    const term = q.toLowerCase();
    const matchesSearch = c.name.toLowerCase().includes(term) || (c.city || "").toLowerCase().includes(term);
    if (!matchesSearch) return false;
    if (status === "active") return isActive(c);
    if (status === "settled") return (c.order_count || 0) > 0 && !isActive(c);
    if (status === "none") return (c.order_count || 0) === 0;
    return true;
  });

  const totals = filtered.reduce(
    (a, c) => ({ orders: a.orders + (c.order_count || 0), pending: a.pending + (c.pending_qty || 0), amount: a.amount + (c.amount || 0) }),
    { orders: 0, pending: 0, amount: 0 }
  );

  if (loading) return <Loader label="Loading customers…" />;

  return (
    <div className="space-y-6" data-testid="customers-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">Open any customer to see their full order history and dispatch timeline.</p>
      </div>

      <Card className="rounded-sm border-2 border-border shadow-none">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              data-testid="customer-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or city…"
              className="h-9 max-w-sm rounded-sm border-2"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="customer-filter-status" className="h-9 w-52 rounded-sm border-2">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              <SelectItem value="active">With Active Orders ({activeCount})</SelectItem>
              <SelectItem value="settled">Nothing Pending</SelectItem>
              <SelectItem value="none">No Orders Yet</SelectItem>
            </SelectContent>
          </Select>
          {(status !== "all" || q) && (
            <Button
              data-testid="customer-filter-reset"
              variant="outline"
              size="sm"
              onClick={() => {
                setStatus("all");
                setQ("");
              }}
              className="h-9 gap-1 rounded-sm"
            >
              <FilterX className="h-4 w-4" /> Reset
            </Button>
          )}
          <span className="text-xs text-muted-foreground" data-testid="customer-count">
            Showing {filtered.length} of {rows.length}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground" data-testid="customers-empty">
            {rows.length === 0 ? "No customers yet." : "No customers match these filters."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">Customer</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">City</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Orders</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending Pcs</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Total Value</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-secondary/40"
                  data-testid={`customer-row-${c.id}`}
                  onClick={() => navigate(`/customers/${c.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-accent text-primary">
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                      {c.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.city || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(c.order_count)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(c.pending_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(c.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Button data-testid={`customer-view-${c.id}`} variant="ghost" size="sm" className="gap-1" onClick={(e) => { e.stopPropagation(); navigate(`/customers/${c.id}`); }}>
                      View <ArrowRight className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="customers-total-row">
                <TableCell colSpan={2}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(totals.orders)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(totals.pending)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(totals.amount)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
