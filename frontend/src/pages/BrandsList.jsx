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
import { Tag, ArrowRight, Search, FilterX } from "lucide-react";
import { Loader } from "@/components/Loader";

// "Moving" means the brand still has pieces waiting to go out on some order.
const isMoving = (b) => (b.pending_qty || 0) > 0;

export default function BrandsList() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        setRows(await api.listBrands());
      } catch (e) {
        toast.error(apiErr(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const movingCount = rows.filter(isMoving).length;

  const filtered = rows.filter((b) => {
    if (!b.name.toLowerCase().includes(q.toLowerCase())) return false;
    if (status === "moving") return isMoving(b);
    if (status === "settled") return (b.order_count || 0) > 0 && !isMoving(b);
    if (status === "none") return (b.order_count || 0) === 0;
    return true;
  });

  const totals = filtered.reduce(
    (a, b) => ({
      orders: a.orders + (b.order_count || 0),
      ordered: a.ordered + (b.ordered_qty || 0),
      pending: a.pending + (b.pending_qty || 0),
      amount: a.amount + (b.amount || 0),
      dispatched_value: a.dispatched_value + (b.dispatched_value || 0),
    }),
    { orders: 0, ordered: 0, pending: 0, amount: 0, dispatched_value: 0 }
  );

  if (loading) return <Loader label="Loading brands…" />;

  return (
    <div className="space-y-6" data-testid="brands-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Brands</h1>
        <p className="text-sm text-muted-foreground">Open any brand to see every order it sits on and its dispatch timeline.</p>
      </div>

      <Card className="rounded-sm border-2 border-border shadow-none">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="flex flex-1 items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              data-testid="brand-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by brand name…"
              className="h-9 max-w-sm rounded-sm border-2"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="brand-filter-status" className="h-9 w-52 rounded-sm border-2">
              <SelectValue placeholder="All brands" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              <SelectItem value="moving">With Pending Pieces ({movingCount})</SelectItem>
              <SelectItem value="settled">Nothing Pending</SelectItem>
              <SelectItem value="none">Not Ordered Yet</SelectItem>
            </SelectContent>
          </Select>
          {(status !== "all" || q) && (
            <Button
              data-testid="brand-filter-reset"
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
          <span className="text-xs text-muted-foreground" data-testid="brand-count">
            Showing {filtered.length} of {rows.length}
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground" data-testid="brands-empty">
            {rows.length === 0 ? "No brands yet." : "No brands match these filters."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">Brand</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Rate</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Orders</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Customers</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Ordered Pcs</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Pending Pcs</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Order Value</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Dispatched ₹</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">History</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b) => (
                <TableRow
                  key={b.id}
                  className="cursor-pointer hover:bg-secondary/40"
                  data-testid={`brand-row-${b.id}`}
                  onClick={() => navigate(`/brands/${b.id}`)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-accent text-primary">
                        <Tag className="h-3.5 w-3.5" />
                      </div>
                      {b.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{inr(b.rate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(b.order_count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(b.customer_count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(b.ordered_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-amber-700">{num(b.pending_qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(b.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{inr(b.dispatched_value)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      data-testid={`brand-view-${b.id}`}
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/brands/${b.id}`);
                      }}
                    >
                      View <ArrowRight className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="brands-total-row">
                <TableCell colSpan={2}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{num(totals.orders)}</TableCell>
                {/* No customer total: one shop buying three brands would be counted three times. */}
                <TableCell />
                <TableCell className="text-right tabular-nums">{num(totals.ordered)}</TableCell>
                <TableCell className="text-right tabular-nums text-amber-700">{num(totals.pending)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(totals.amount)}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-700">{inr(totals.dispatched_value)}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
