import "@/App.css";
import { lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/Auth";
import { Layout } from "@/components/Layout";

// Each page is its own chunk, so the first visit downloads only the page it
// lands on. The rest are fetched once the browser is idle, which keeps
// switching tabs instant after that.
const pages = {
  Dashboard: () => import("@/pages/Dashboard"),
  SaleOrders: () => import("@/pages/SaleOrders"),
  Orders: () => import("@/pages/Orders"),
  DispatchOrders: () => import("@/pages/DispatchOrders"),
  Reports: () => import("@/pages/Reports"),
  Expenses: () => import("@/pages/Expenses"),
  Compare: () => import("@/pages/Compare"),
  Masters: () => import("@/pages/Masters"),
  CustomersList: () => import("@/pages/CustomersList"),
  CustomerHistory: () => import("@/pages/CustomerHistory"),
  BrandsList: () => import("@/pages/BrandsList"),
  BrandHistory: () => import("@/pages/BrandHistory"),
};
const Dashboard = lazy(pages.Dashboard);
const SaleOrders = lazy(pages.SaleOrders);
const Orders = lazy(pages.Orders);
const DispatchOrders = lazy(pages.DispatchOrders);
const Reports = lazy(pages.Reports);
const Expenses = lazy(pages.Expenses);
const Compare = lazy(pages.Compare);
const Masters = lazy(pages.Masters);
const CustomersList = lazy(pages.CustomersList);
const CustomerHistory = lazy(pages.CustomerHistory);
const BrandsList = lazy(pages.BrandsList);
const BrandHistory = lazy(pages.BrandHistory);

function App() {
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    idle(() => Object.values(pages).forEach((load) => load().catch(() => {})));
  }, []);

  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="sale-orders" element={<SaleOrders />} />
              <Route path="orders" element={<Orders />} />
              <Route path="dispatch-orders" element={<DispatchOrders />} />
              <Route path="customers" element={<CustomersList />} />
              <Route path="customers/:id" element={<CustomerHistory />} />
              <Route path="brands" element={<BrandsList />} />
              <Route path="brands/:id" element={<BrandHistory />} />
              <Route path="reports" element={<Reports />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="compare" element={<Compare />} />
              <Route path="masters" element={<Masters />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
