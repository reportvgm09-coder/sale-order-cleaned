// Order Ledger as a Windows program.
//
// One window, three things running behind it: a MongoDB that keeps this PC's
// data, the app's own server (backend/server.py, bundled by PyInstaller), and
// the website, which that server hands out. Nothing is installed separately and
// nothing listens beyond this PC. Sync with the online site is the server's
// job, exactly as with setup-offline.bat - see backend/sync.py.

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { spawn, execFile } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

// Fixed, not random: the website is built with the server's address baked in
// (REACT_APP_BACKEND_URL), and a sign-in is remembered per address. Picked high
// to stay clear of the 3000 / 8000 / 27017 that start-app.bat and a separately
// installed MongoDB use, so both can run alongside this.
const API_PORT = 47800;
const DB_PORT = 47817;
const APP_URL = `http://127.0.0.1:${API_PORT}`;

const DATA = app.getPath("userData"); // %APPDATA%\Order Ledger
const SETTINGS = path.join(DATA, "settings.json");
const DB_DIR = path.join(DATA, "database");
const LOG_DIR = path.join(DATA, "logs");

// Packaged, the pieces sit in resources\; while developing, in the repo.
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
const MONGOD = app.isPackaged
  ? path.join(RES, "mongodb", "mongod.exe")
  : path.join(__dirname, "vendor", "mongodb", "mongod.exe");
const SITE = app.isPackaged ? path.join(RES, "site") : path.join(RES, "frontend", "build");
const serverCmd = (args) =>
  app.isPackaged
    ? [path.join(RES, "server", "order-ledger-server.exe"), args]
    : [path.join(RES, "backend", "venv", "Scripts", "python.exe"), [path.join(RES, "backend", "desktop_main.py"), ...args]];

let win = null;
let mongod = null;
let server = null;
let quitting = false;
// The setup window can be the only one open; closing it is not quitting.
let settingUp = false;

// ---------------------------------------------------------------- settings --
const readSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
  } catch {
    return null;
  }
};

const writeSettings = (s) => {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2));
};

/** Pull what can be reused out of an existing app folder's backend\.env, so
 *  nobody has to find and paste an Atlas connection string by hand. */
const importOldFolder = (dir) => {
  const candidates = [path.join(dir, "backend", ".env"), path.join(dir, ".env")];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) return { error: "No settings found there. Pick the folder that has start-app.bat in it." };
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const local = (u) => /localhost|127\.0\.0\.1/.test(u || "");
  return {
    remote: env.SYNC_REMOTE_URL || (local(env.MONGO_URL) ? "" : env.MONGO_URL || ""),
    dbName: env.DB_NAME || "",
    username: env.APP_USERNAME || "",
    passwordHash: env.APP_PASSWORD_HASH || "",
  };
};

const hashPassword = (pw) =>
  new Promise((resolve, reject) => {
    const [cmd, args] = serverCmd(["hash-password"]);
    const p = execFile(cmd, args, { windowsHide: true }, (err, out) =>
      err ? reject(err) : resolve(String(out).trim())
    );
    p.stdin.end(pw + "\n");
  });

// ------------------------------------------------------------- processes --
const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });

const waitFor = (check, what, ms = 60000) =>
  new Promise((resolve, reject) => {
    const until = Date.now() + ms;
    const tick = async () => {
      if (await check()) return resolve();
      if (Date.now() > until) return reject(new Error(`${what} did not start in time.`));
      setTimeout(tick, 300);
    };
    tick();
  });

const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

const apiUp = () =>
  new Promise((resolve) => {
    http
      .get(`${APP_URL}/api/`, (r) => (r.resume(), resolve(r.statusCode === 200)))
      .on("error", () => resolve(false));
  });

const logTo = (name) => fs.createWriteStream(path.join(LOG_DIR, name), { flags: "a" });

const startDatabase = async () => {
  if (!(await portFree(DB_PORT))) throw new Error(`Port ${DB_PORT} is already in use - is Order Ledger already open?`);
  fs.mkdirSync(DB_DIR, { recursive: true });
  mongod = spawn(
    MONGOD,
    ["--dbpath", DB_DIR, "--port", String(DB_PORT), "--bind_ip", "127.0.0.1", "--logpath", path.join(LOG_DIR, "database.log"), "--logappend"],
    { windowsHide: true }
  );
  mongod.on("exit", (code) => !quitting && fail(`The database stopped unexpectedly (code ${code}).`));
  await waitFor(() => portOpen(DB_PORT), "The database");
};

const serverEnv = (s) => ({
  ...process.env,
  PORT: String(API_PORT),
  MONGO_URL: `mongodb://127.0.0.1:${DB_PORT}`,
  DB_NAME: s.dbName,
  APP_USERNAME: s.username,
  APP_PASSWORD_HASH: s.passwordHash,
  JWT_SECRET: s.jwtSecret,
  SYNC_REMOTE_URL: s.remote || "",
  FRONTEND_DIR: SITE,
  CORS_ORIGINS: APP_URL,
  PYTHONUNBUFFERED: "1",
});

const startServer = async (s) => {
  if (!(await portFree(API_PORT))) throw new Error(`Port ${API_PORT} is already in use - is Order Ledger already open?`);
  const [cmd, args] = serverCmd([]);
  server = spawn(cmd, args, { env: serverEnv(s), windowsHide: true });
  const log = logTo("server.log");
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on("exit", (code) => !quitting && fail(`The app's server stopped unexpectedly (code ${code}).`));
  await waitFor(apiUp, "The app's server", 90000);
};

const stopAll = async () => {
  quitting = true;
  if (server) server.kill();
  if (mongod) {
    const s = readSettings();
    await new Promise((resolve) => {
      const [cmd, args] = serverCmd(["shutdown-db"]);
      execFile(cmd, args, { env: s ? serverEnv(s) : process.env, windowsHide: true, timeout: 10000 }, () => resolve());
    });
    await waitFor(async () => mongod.exitCode !== null, "Stopping", 10000).catch(() => mongod.kill());
  }
};

const fail = (msg) => {
  dialog.showErrorBox(
    "Order Ledger could not carry on",
    `${msg}\n\nClose it and open it again. If this keeps happening, the logs are in:\n${LOG_DIR}`
  );
  app.quit();
};

// ---------------------------------------------------------------- windows --
const openSetup = () =>
  new Promise((resolve) => {
    settingUp = true;
    const setup = new BrowserWindow({
      width: 560,
      height: 800,
      resizable: false,
      icon: ICON,
      title: "Set up Order Ledger",
      autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "preload.js") },
    });
    setup.loadFile(path.join(__dirname, "setup.html"), {
      query: { existing: JSON.stringify((({ remote, dbName, username, passwordHash }) => ({ remote, dbName, username, passwordHash }))(readSettings() || {})) },
    });
    ipcMain.removeHandler("pick-folder");
    ipcMain.removeHandler("save-settings");
    ipcMain.handle("pick-folder", async () => {
      const r = await dialog.showOpenDialog(setup, {
        title: "Pick your old Order Ledger folder (the one with start-app.bat)",
        properties: ["openDirectory"],
      });
      return r.canceled ? null : importOldFolder(r.filePaths[0]);
    });
    ipcMain.handle("save-settings", async (_e, form) => {
      const old = readSettings() || {};
      const s = {
        remote: (form.remote || "").trim(),
        dbName: (form.dbName || "").trim() || "sale_orders",
        username: (form.username || "").trim(),
        passwordHash: form.password ? await hashPassword(form.password) : form.passwordHash || old.passwordHash,
        jwtSecret: old.jwtSecret || crypto.randomBytes(32).toString("hex"),
      };
      if (!s.username || !s.passwordHash) return { error: "Enter a username and a password." };
      writeSettings(s);
      resolve(s);
      setup.close();
      return { ok: true };
    });
    // closed without saving: nothing changes. settingUp stays on until the
    // caller has a window open again - "closed" fires before window-all-closed.
    setup.on("closed", () => resolve(null));
  });

const ICON = path.join(__dirname, "assets", "icon.png");

const menu = () =>
  Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [
        { label: "Reload", accelerator: "F5", click: () => win && win.reload() },
        { type: "separator" },
        { label: "Print…", accelerator: "Ctrl+P", click: () => win && win.webContents.print() },
        { type: "separator" },
        { role: "quit", label: "Exit" },
      ],
    },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
    {
      label: "Help",
      submenu: [
        {
          label: "Change settings…",
          click: async () => {
            const saved = await openSetup();
            settingUp = false;
            if (saved && win) {
              await stopAll();
              app.relaunch();
              app.exit(0);
            }
          },
        },
        { label: "Open data folder", click: () => shell.openPath(DATA) },
        { label: "Open logs folder", click: () => shell.openPath(LOG_DIR) },
      ],
    },
  ]);

const start = async () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  let settings = readSettings();
  if (!settings) settings = await openSetup();
  if (!settings) return app.quit(); // closed the setup window without saving

  Menu.setApplicationMenu(menu());
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    title: "Order Ledger",
    icon: ICON,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  settingUp = false;
  win.maximize();
  win.loadFile(path.join(__dirname, "loading.html"));
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => (win = null));
  // The app's own pages stay in the window; anything else is the web, in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) shell.openExternal(url);
    return { action: url.startsWith(APP_URL) ? "allow" : "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith("file:")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  try {
    await startDatabase();
    await startServer(settings);
  } catch (e) {
    return fail(e.message);
  }
  win.loadURL(APP_URL);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
  app.on("window-all-closed", () => !settingUp && app.quit());
  let stopped = false;
  app.on("before-quit", (e) => {
    if (stopped) return;
    e.preventDefault();
    stopAll().finally(() => {
      stopped = true;
      app.quit();
    });
  });
}
