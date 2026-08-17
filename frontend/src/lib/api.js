import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API });

// ---- auth plumbing ----
let authToken = "";
let unauthorizedHandler = null;

export const setAuthToken = (t) => {
  authToken = t || "";
};

/** Called when the server rejects our token, so the app can sign out. */
export const onUnauthorized = (fn) => {
  unauthorizedHandler = fn;
};

client.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

client.interceptors.response.use(
  (r) => r,
  (e) => {
    // Never sign out because a login attempt failed - that is a wrong password,
    // not an expired session.
    const isLogin = (e?.config?.url || "").includes("/auth/login");
    if (e?.response?.status === 401 && !isLogin && unauthorizedHandler) unauthorizedHandler();
    return Promise.reject(e);
  }
);

export const api = {
  // auth
  login: (username, password) => client.post(`/auth/login`, { username, password }).then((r) => r.data),
  me: () => client.get(`/auth/me`).then((r) => r.data),
  // masters
  listMasters: (type) => client.get(`/masters/${type}`).then((r) => r.data),
  addMaster: (type, payload) => client.post(`/masters/${type}`, payload).then((r) => r.data),
  updateMaster: (type, id, body) => client.put(`/masters/${type}/${id}`, body).then((r) => r.data),
  bulkMaster: (type, body) => client.post(`/masters/${type}/bulk`, body).then((r) => r.data),
  deleteMaster: (type, id) => client.delete(`/masters/${type}/${id}`).then((r) => r.data),
  bulkDeleteMasters: (type, ids) => client.post(`/masters/${type}/bulk-delete`, { ids }).then((r) => r.data),
  // sale orders
  listSaleOrders: () => client.get(`/sale-orders`).then((r) => r.data),
  // One order plus its customer, including brand_rows - enough to open the
  // edit and dispatch dialogs from any page.
  saleOrder: (id) => client.get(`/sale-orders/${id}`).then((r) => r.data),
  createSaleOrder: (payload) => client.post(`/sale-orders`, payload).then((r) => r.data),
  updateSaleOrder: (id, payload) => client.put(`/sale-orders/${id}`, payload).then((r) => r.data),
  deleteSaleOrder: (id) => client.delete(`/sale-orders/${id}`).then((r) => r.data),
  bulkDeleteSaleOrders: (ids) => client.post(`/sale-orders/bulk-delete`, { ids }).then((r) => r.data),
  bulkSaleOrders: (orders) => client.post(`/sale-orders/bulk`, { orders }).then((r) => r.data),
  // dispatch
  listDispatches: () => client.get(`/dispatch-orders`).then((r) => r.data),
  createDispatch: (payload) => client.post(`/dispatch-orders`, payload).then((r) => r.data),
  deleteDispatch: (id) => client.delete(`/dispatch-orders/${id}`).then((r) => r.data),
  bulkDeleteDispatches: (ids) => client.post(`/dispatch-orders/bulk-delete`, { ids }).then((r) => r.data),
  // expenses
  listExpenses: () => client.get(`/expenses`).then((r) => r.data),
  createExpense: (payload) => client.post(`/expenses`, payload).then((r) => r.data),
  updateExpense: (id, payload) => client.put(`/expenses/${id}`, payload).then((r) => r.data),
  deleteExpense: (id) => client.delete(`/expenses/${id}`).then((r) => r.data),
  expenseSummary: (params) => client.get(`/expenses/summary`, { params }).then((r) => r.data),
  // dashboard
  dashboard: (params) => client.get(`/dashboard`, { params }).then((r) => r.data),
  // reports
  reports: () => client.get(`/reports`).then((r) => r.data),
  // customers
  listCustomers: () => client.get(`/customers`).then((r) => r.data),
  customerHistory: (id) => client.get(`/customers/${id}/history`).then((r) => r.data),
  // backup
  backup: () => client.get(`/backup`).then((r) => r.data),
};

export const apiErr = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string" && d) return d;
  if (d?.message) return d.message; // structured errors, e.g. the near-duplicate warning
  return e?.message || "Something went wrong";
};

// A 409 from the masters endpoints means "this looks like something you already have".
// Returns { message, similar: [{ id, name, city }] }, or null for any other error.
export const duplicateWarning = (e) =>
  e?.response?.status === 409 && e?.response?.data?.detail?.similar ? e.response.data.detail : null;
