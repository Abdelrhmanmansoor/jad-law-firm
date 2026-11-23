/**
 * مشغّل لوحة التحكم — يُستدعى من Jad-Admin.bat بعد التحديث.
 *
 *  1. يوقف نسخة قديمة من اللوحة تحجز المنفذ (عملية node فقط).
 *  2. يشغّل الخادم في الخلفية بلا نافذة، وسجلّه في data/logs.
 *  3. ينتظر حتى تعمل اللوحة فعلًا (ويتأكد أنها لوحتنا لا برنامج آخر).
 *  4. يفتحها كتطبيق مستقل (Microsoft Edge بوضع التطبيق) أو في المتصفح.
 *  5. ينشئ اختصارًا على سطح المكتب بأيقونة المكتب (مرة واحدة).
 *
 * تطوير: solimanx.com
 */
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_URL = `http://localhost:${PORT}/admin`;
const LOG_DIR = path.join(ROOT, "data", "logs");

const say = (msg) => process.stdout.write(`  ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: urlPath, timeout: 2500 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body, location: res.headers.location || "" }));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function pidsOnPort() {
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${PORT}`)) pids.add(Number(cols[4]));
    }
    return [...pids].filter(Boolean);
  } catch {
    return [];
  }
}

function imageName(pid) {
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true });
    return (out.split(",")[0] || "").replace(/"/g, "").trim().toLowerCase();
  } catch {
    return "";
  }
}

/** هل الذي يعمل على المنفذ لوحتنا (قديمة أو جديدة)؟ /admin يحوّل دائمًا لإحدى صفحاتها. */
async function isOurPanel() {
  const res = await get("/admin");
  return Boolean(res && res.status >= 300 && res.status < 400 && /^\/admin\/(setup|login|dashboard)\.html/.test(res.location));
}

async function stopOldPanel() {
  const pids = pidsOnPort();
  if (!pids.length) return true;
  if (!(await isOurPanel())) return false; // برنامج آخر — لا نلمسه
  for (const pid of pids) {
    if (imageName(pid) !== "node.exe") return false;
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 30 && pidsOnPort().length; i++) await sleep(100);
  return pidsOnPort().length === 0;
}

function startServer() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, "panel.log"), "w");
  const err = fs.openSync(path.join(LOG_DIR, "panel-error.log"), "w");
  const child = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, err],
    env: { ...process.env, PORT: String(PORT) },
  });
  child.unref();
}

async function waitUntilReady() {
  for (let i = 0; i < 150; i++) {
    const res = await get("/admin/login.html");
    if (res && (/authForm/.test(res.body) || (res.status >= 300 && res.status < 400 && /^\/admin\//.test(res.location)))) return true;
    await sleep(200);
  }
  return false;
}

function findEdge() {
  const candidates = [
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return candidates.find((p) => p && fs.existsSync(p));
}

function openApp() {
  const edge = findEdge();
  if (edge) {
    spawn(edge, [`--app=${ADMIN_URL}`, "--window-size=1440,900"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("cmd", ["/c", "start", "", ADMIN_URL], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

function ensureShortcut() {
  try {
    const desktop = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!desktop) return;
    const lnk = path.join(desktop, "لوحة تحكم جاد العبدالله.lnk");
    const target = path.join(ROOT, "Jad-Admin.bat");
    const marker = path.join(ROOT, "data", ".shortcut");
    if (fs.existsSync(lnk) && fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === target) return;
    const q = (s) => `'${s.replace(/'/g, "''")}'`;
    const script = [
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut(" + q(lnk) + ")",
      "$s.TargetPath = " + q(target),
      "$s.WorkingDirectory = " + q(ROOT),
      "$s.IconLocation = " + q(path.join(ROOT, "assets", "admin.ico") + ",0"),
      "$s.Description = 'لوحة تحكم موقع جاد العبدالله للمحاماة'",
      "$s.WindowStyle = 7",
      "$s.Save()",
    ].join("; ");
    execFileSync("powershell", ["-NoProfile", "-Command", script], { windowsHide: true, stdio: "ignore" });
    fs.writeFileSync(marker, target, "utf8");
    say("✓ تم إنشاء اختصار «لوحة تحكم جاد العبدالله» على سطح المكتب");
  } catch {
    /* الاختصار ميزة إضافية — لا يوقف التشغيل */
  }
}

(async () => {
  say("جارٍ تشغيل لوحة التحكم…");
  if (!(await stopOldPanel())) {
    say(`✗ المنفذ ${PORT} مستخدم من برنامج آخر. أغلقي البرامج المفتوحة أو أعيدي تشغيل الجهاز.`);
    process.exit(2);
  }
  startServer();
  if (!(await waitUntilReady())) {
    let detail = "";
    try {
      detail = fs.readFileSync(path.join(LOG_DIR, "panel-error.log"), "utf8").trim().split("\n").slice(-3).join("\n");
    } catch {
      /* no log */
    }
    say("✗ لم تبدأ لوحة التحكم بالعمل." + (detail ? `\n${detail}` : ""));
    process.exit(3);
  }
  openApp();
  ensureShortcut();
  say("✓ تم فتح لوحة التحكم");
})();
