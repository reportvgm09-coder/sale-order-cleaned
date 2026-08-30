import "@/App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/Auth";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import SaleOrders from "@/pages/SaleOrders";
import Orders from "@/pages/Orders";
import DispatchOrders from "@/pages/DispatchOrders";
import Reports from "@/pages/Reports";
import Expenses from "@/pages/Expenses";
import Compare from "@/pages/Compare";
import Masters from "@/pages/Masters";
import CustomersList from "@/pages/CustomersList";
import CustomerHistory from "@/pages/CustomerHistory";
import BrandsList from "@/pages/BrandsList";
import BrandHistory from "@/pages/BrandHistory";

function App() {
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
