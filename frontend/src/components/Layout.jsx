import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/context/Auth";
import { Loader } from "@/components/Loader";
import { SyncBar } from "@/components/SyncBar";
import tree from "@/assets/brand/tree.webp";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LayoutGrid, ScrollText, Truck, Database, BarChart3, Building2, GitCompareArrows, LogOut, UserRound, Wallet, Table, Tag, ShieldCheck, Menu, MapIcon } from "lucide-react";

const tabs = [
  { to: "/", label: "Dashboard", icon: LayoutGrid, testid: "nav-dashboard", end: true },
  { to: "/sale-orders", label: "Sale Orders", icon: ScrollText, testid: "nav-sale-orders" },
  { to: "/orders", label: "Orders", icon: Table, testid: "nav-orders" },
  { to: "/dispatch-orders", label: "Dispatch", icon: Truck, testid: "nav-dispatch-orders" },
  { to: "/customers", label: "Customers", icon: Building2, testid: "nav-customers" },
  { to: "/brands", label: "Brands", icon: Tag, testid: "nav-brands" },
  { to: "/reports", label: "Reports", icon: BarChart3, testid: "nav-reports" },
  { to: "/expenses", label: "Expenses", icon: Wallet, testid: "nav-expenses", moneyOnly: true },
  { to: "/compare", label: "Compare", icon: GitCompareArrows, testid: "nav-compare" },
  { to: "/map", label: "Map", icon: MapIcon, testid: "nav-map" },
  { to: "/masters", label: "Masters", icon: Database, testid: "nav-masters" },
  { to: "/users", label: "Users", icon: ShieldCheck, testid: "nav-users", adminOnly: true },
];

const COMPANY = "Veena Garments";

// A salesman's whole app - see AppRoutes.
const salesmanTabs = [
  { to: "/", label: "Orders", icon: ScrollText, testid: "nav-my-orders", end: true },
  { to: "/my-expenses", label: "Expenses", icon: Wallet, testid: "nav-my-expenses" },
  { to: "/my-reports", label: "Reports", icon: BarChart3, testid: "nav-my-reports" },
  { to: "/my-map", label: "Map", icon: MapIcon, testid: "nav-my-map" },
];

// More tabs than this go in a slide-out menu below laptop width (xl): the
// office's twelve need about 1200px in a row, which a phone or tablet never
// has. A salesman's four still fit, and stay one tap away.
const FITS_ON_PHONE = 4;

export const Layout = () => {
  const loc = useLocation();
  const { user, role, isAdmin, isSalesman, seesMoney, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  // Expenses is nothing but money, so a login that cannot see money has no use for it.
  const shown = isSalesman ? salesmanTabs : tabs.filter((t) => (!t.adminOnly || isAdmin) && (!t.moneyOnly || seesMoney));
  const isActive = (t) => (t.end ? loc.pathname === "/" : loc.pathname.startsWith(t.to));
  const current = shown.find(isActive);
  const useMenu = shown.length > FITS_ON_PHONE;

  const who = (
    <>
      <UserRound className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{user}</span>
      {role && (
        <span data-testid="signed-in-role" className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
          {role}
        </span>
      )}
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-white/95 shadow-[0_1px_0_0_hsl(var(--border)),0_6px_18px_-12px_rgb(0_0_0/0.25)] backdrop-blur no-print">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between gap-2 sm:h-16">
            <div className="flex min-w-0 items-center gap-2 sm:gap-3">
              {useMenu && (
                <Button
                  data-testid="nav-menu-btn"
                  variant="outline"
                  size="icon"
                  onClick={() => setMenuOpen(true)}
                  className="h-9 w-9 shrink-0 rounded-sm xl:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              )}
              <img src={tree} alt="" className="h-10 w-10 shrink-0" data-testid="brand-mark" />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-display text-lg font-extrabold tracking-tight text-foreground">Order Ledger</div>
                {/* On a phone with the menu folded away, this says where you are. */}
                <div className="truncate text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {useMenu ? (
                    <>
                      <span className="xl:hidden" data-testid="nav-current">{current?.label || COMPANY}</span>
                      <span className="hidden xl:inline">{COMPANY}</span>
                    </>
                  ) : (
                    COMPANY
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex" data-testid="signed-in-as">
                {who}
              </span>
              <Button
                data-testid="sign-out-btn"
                variant="outline"
                size="sm"
                onClick={signOut}
                className={`gap-1 rounded-sm ${useMenu ? "hidden xl:inline-flex" : ""}`}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign Out</span>
              </Button>
            </div>
          </div>
          {/* Scrolls sideways rather than clipping if a tab is ever added that
              no longer fits; narrower screens get the menu instead. */}
          <nav className={`gap-1 overflow-x-auto pb-2.5 ${useMenu ? "hidden xl:flex" : "flex"}`}>
            {shown.map((t) => {
              const Icon = t.icon;
              const active = isActive(t);
              return (
                <NavLink
                  key={t.to}
                  to={t.to}
                  data-testid={t.testid}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    useMenu ? "" : "flex-1 justify-center md:flex-none"
                  } ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                >
                  {/* a salesman's four tabs fit a phone by their words alone */}
                  <Icon className={`h-4 w-4 ${useMenu ? "" : "hidden sm:block"}`} />
                  {t.label}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>
      {/* a salesman's routes are fenced to his own screens, status included */}
      {!isSalesman && <SyncBar />}

      {useMenu && (
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0" data-testid="nav-drawer">
            <SheetHeader className="border-b border-border p-4 text-left">
              <SheetTitle className="flex items-center gap-2 font-display text-lg font-extrabold tracking-tight">
                <img src={tree} alt="" className="h-8 w-8" /> Order Ledger
              </SheetTitle>
              <SheetDescription className="flex items-center gap-1.5 text-sm">{who}</SheetDescription>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto p-2">
              {shown.map((t) => {
                const Icon = t.icon;
                const active = isActive(t);
                return (
                  <NavLink
                    key={t.to}
                    to={t.to}
                    data-testid={`drawer-${t.testid}`}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium ${
                      active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {t.label}
                  </NavLink>
                );
              })}
            </nav>
            <div className="border-t border-border p-4">
              <Button data-testid="drawer-sign-out-btn" variant="outline" onClick={signOut} className="w-full gap-2 rounded-sm">
                <LogOut className="h-4 w-4" /> Sign Out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-8">
        <Suspense fallback={<Loader label="Loading page…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
};
