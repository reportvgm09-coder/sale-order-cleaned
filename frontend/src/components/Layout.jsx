import { Suspense } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/Auth";
import { Loader } from "@/components/Loader";
import { Button } from "@/components/ui/button";
import { LayoutGrid, ScrollText, Truck, Database, BookMarked, BarChart3, Building2, GitCompareArrows, LogOut, UserRound, Wallet, Table, Tag } from "lucide-react";

const tabs = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, testid: "nav-dashboard", end: true },
  { to: "/sale-orders", label: "Sale Orders", icon: ScrollText, testid: "nav-sale-orders" },
  { to: "/orders", label: "Orders", icon: Table, testid: "nav-orders" },
  { to: "/dispatch-orders", label: "Dispatch", icon: Truck, testid: "nav-dispatch-orders" },
  { to: "/customers", label: "Customers", icon: Building2, testid: "nav-customers" },
  { to: "/brands", label: "Brands", icon: Tag, testid: "nav-brands" },
  { to: "/reports", label: "Reports", icon: BarChart3, testid: "nav-reports" },
  { to: "/expenses", label: "Expenses", icon: Wallet, testid: "nav-expenses" },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, testid: "nav-compare" },
  { to: "/masters", label: "Masters", icon: Database, testid: "nav-masters" },
];

export const Layout = () => {
  const loc = useLocation();
  const { user, signOut } = useAuth();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-white no-print">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                <BookMarked className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <div className="font-display text-lg font-extrabold tracking-tight text-foreground">Order Ledger</div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Garment Distribution</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex" data-testid="signed-in-as">
                <UserRound className="h-3.5 w-3.5" /> {user}
              </span>
              <Button data-testid="sign-out-btn" variant="outline" size="sm" onClick={signOut} className="gap-1 rounded-sm">
                <LogOut className="h-4 w-4" /> Sign Out
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = t.end ? loc.pathname === "/" : loc.pathname.startsWith(t.to);
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  data-testid={t.testid}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
        <Suspense fallback={<Loader label="Loading page…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
};
