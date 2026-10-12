import "@/App.css";
import { lazy, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/Auth";
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
  Users: () => import("@/pages/Users"),
  MyOrders: () => import("@/pages/MyOrders"),
  MyExpenses: () => import("@/pages/MyExpenses"),
  MyReports: () => import("@/pages/MyReports"),
  MapView: () => import("@/pages/MapView"),
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
const Users = lazy(pages.Users);
const MyOrders = lazy(pages.MyOrders);
const MyExpenses = lazy(pages.MyExpenses);
const MyReports = lazy(pages.MyReports);
const MapView = lazy(pages.MapView);

function App() {
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2000));
    idle(() => Object.values(pages).forEach((load) => load().catch(() => {})));
  }, []);

  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

function AppRoutes() {
  const { isSalesman, seesMoney } = useAuth();

  // A salesman gets an app of his own: four screens, and any other address
  // lands back on the first. The server refuses him everything else anyway;
  // this just means he never meets a page that cannot load.
  if (isSalesman) {
    return (
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<MyOrders />} />
          <Route path="my-expenses" element={<MyExpenses />} />
          <Route path="my-reports" element={<MyReports />} />
          <Route path="my-map" element={<MapView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }

  return (
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
        <Route path="expenses" element={seesMoney ? <Expenses /> : <Navigate to="/" replace />} />
        <Route path="compare" element={<Compare />} />
        <Route path="map" element={<MapView />} />
        <Route path="masters" element={<Masters />} />
        <Route path="users" element={<Users />} />
      </Route>
    </Routes>
  );
}

export default App;
