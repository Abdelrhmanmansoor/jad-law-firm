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
const BASE_PORT = Number(process.env.PORT) || 3000;
let PORT = BASE_PORT;
const adminUrl = () => `http://localhost:${PORT}/admin`;
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

/**
 * يختار منفذًا: لوحتنا إن كانت تعمل، وإلا أول منفذ فارغ من 3000 إلى 3009.
 * برنامج آخر على 3000 (مثل مشروع تطوير) لا يمنع اللوحة من العمل.
 */
async function choosePort() {
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    PORT = p;
    if (!pidsOnPort().length) return true;
    if (await isOurPanel()) return true;
  }
  return false;
}

/** رسالة ظاهرة — نافذة التشغيل تعمل مصغّرة فلا تُرى رسائلها. */
function alertUser(message) {
  say(message);
  try {
    const text = (message + "\n\nللدعم الفني عبر واتساب: wa.me/201007835547").replace(/'/g, "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${text}', 'لوحة تحكم جاد العبدالله', 'OK', 'Warning')`,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
  } catch {
    /* the console message remains */
  }
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
    spawn(edge, [`--app=${adminUrl()}`, "--window-size=1440,900"], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("cmd", ["/c", "start", "", adminUrl()], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

function ensureShortcut() {
  try {
    const target = path.join(ROOT, "Jad-Admin.bat");
    const marker = path.join(ROOT, "data", ".shortcut");
    // الاختصار موجود مسبقًا؟ نتحقق بدون تشغيل أي برنامج إضافي.
    try {
      const saved = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (saved.target === target && fs.existsSync(saved.lnk)) return;
    } catch {
      /* first time */
    }
    const desktop = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    if (!desktop) return;
    const lnk = path.join(desktop, "لوحة تحكم جاد العبدالله.lnk");
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
    fs.writeFileSync(marker, JSON.stringify({ target, lnk }), "utf8");
    say("✓ تم إنشاء اختصار «لوحة تحكم جاد العبدالله» على سطح المكتب");
  } catch {
    /* الاختصار ميزة إضافية — لا يوقف التشغيل */
  }
}

/**
 * قفل يمنع تشغيلين في نفس الوقت (ضغطتان متتاليتان على الاختصار كانتا تفتحان
 * نافذتين وتعيدان تشغيل اللوحة مرتين). القفل يُعتبر قديمًا بعد دقيقة.
 */
const LOCK = path.join(ROOT, "data", ".launching");
function takeLock() {
  try {
    const age = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (age < 60000) return false;
  } catch {
    /* no lock */
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}
const releaseLock = () => fs.rmSync(LOCK, { force: true });

(async () => {
  if (!takeLock()) {
    say("لوحة التحكم قيد الفتح بالفعل…");
    return;
  }
  try {
    await main();
  } finally {
    releaseLock();
  }
})();

async function main() {
  say("جارٍ تشغيل لوحة التحكم…");
  if (!(await choosePort())) {
    alertUser("تعذّر تشغيل لوحة التحكم: كل المنافذ من 3000 إلى 3009 مشغولة ببرامج أخرى. أعيدي تشغيل الجهاز ثم حاولي مرة أخرى.");
    process.exitCode = 2;
    return;
  }

  // اللوحة تعمل ولم يصل تحديث جديد: نفتح النافذة فقط — بلا إعادة تشغيل
  // (أسرع، ولا يُطلب تسجيل الدخول من جديد).
  const running = pidsOnPort().length > 0 && (await isOurPanel());
  if (running && process.env.JAD_UPDATED !== "1") {
    openApp();
    ensureShortcut();
    say("✓ تم فتح لوحة التحكم");
    return;
  }

  if (!(await stopOldPanel())) {
    alertUser("تعذّر إعادة تشغيل لوحة التحكم. أعيدي تشغيل الجهاز ثم حاولي مرة أخرى.");
    process.exitCode = 2;
    return;
  }
  startServer();
  if (!(await waitUntilReady())) {
    let detail = "";
    try {
      detail = fs.readFileSync(path.join(LOG_DIR, "panel-error.log"), "utf8").trim().split("\n").slice(-3).join("\n");
    } catch {
      /* no log */
    }
    alertUser("لم تبدأ لوحة التحكم بالعمل." + (detail ? `\n\n${detail}` : ""));
    process.exitCode = 3;
    return;
  }
  openApp();
  ensureShortcut();
  say("✓ تم فتح لوحة التحكم");
}
