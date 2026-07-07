require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");

const { ROOT_DIR, SITE_DATA_FILE } = require("./lib/paths");
const auth = require("./lib/auth");
const dataStore = require("./lib/dataStore");
const gitPublish = require("./lib/gitPublish");
const { upload, publicPathFor } = require("./lib/upload");
const {
  isNonEmptyString,
  isBilingual,
  isBilingualOptional,
  isSafeAssetPath,
  generateId,
  isValidId,
  splitLines,
} = require("./lib/validate");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const ADMIN_DIR = path.join(__dirname, "admin");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);

// ---------- localhost-only guard ----------
function localhostOnly(req, res, next) {
  const ip = req.socket.remoteAddress || "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  if (!isLocal) {
    res.status(403).send("الوصول مسموح فقط من هذا الجهاز (localhost).");
    return;
  }
  next();
}

// ---------- public static site (whitelisted files only) ----------
app.get("/", (req, res) => res.sendFile(path.join(ROOT_DIR, "index.html")));
app.get("/index.html", (req, res) => res.sendFile(path.join(ROOT_DIR, "index.html")));
app.get("/styles.css", (req, res) => res.sendFile(path.join(ROOT_DIR, "styles.css")));
app.get("/script.js", (req, res) => res.sendFile(path.join(ROOT_DIR, "script.js")));
app.get("/data/site-data.json", (req, res) => res.sendFile(SITE_DATA_FILE));
app.use("/assets", express.static(path.join(ROOT_DIR, "assets")));

// ---------- session (used by /admin and /api only) ----------
const sessionMiddleware = session({
  name: "jad_admin_sid",
  secret: auth.getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
});

app.use("/admin", localhostOnly, sessionMiddleware);
app.use("/api", localhostOnly, sessionMiddleware, express.json({ limit: "2mb" }));

// ---------- login rate limiting (simple, in-memory) ----------
const loginAttempts = new Map();
function isLockedOut(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return false;
  if (rec.count < 5) return false;
  return Date.now() - rec.lastAttempt < 60 * 1000;
}
function recordFailedAttempt(key) {
  const rec = loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
  rec.count += 1;
  rec.lastAttempt = Date.now();
  loginAttempts.set(key, rec);
}
function clearAttempts(key) {
  loginAttempts.delete(key);
}

// ---------- /admin pages ----------
app.get("/admin", (req, res) => {
  if (!auth.adminExists()) return res.redirect("/admin/setup.html");
  if (!req.session.authenticated) return res.redirect("/admin/login.html");
  return res.redirect("/admin/dashboard.html");
});

app.get("/admin/setup.html", (req, res) => {
  if (auth.adminExists()) return res.redirect("/admin/login.html");
  res.sendFile(path.join(ADMIN_DIR, "setup.html"));
});

app.get("/admin/login.html", (req, res) => {
  if (!auth.adminExists()) return res.redirect("/admin/setup.html");
  if (req.session.authenticated) return res.redirect("/admin/dashboard.html");
  res.sendFile(path.join(ADMIN_DIR, "login.html"));
});

app.get("/admin/dashboard.html", auth.requireAuth, (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, "dashboard.html"));
});

app.use("/admin", express.static(ADMIN_DIR));

// ---------- auth API ----------
app.post("/api/setup", (req, res) => {
  try {
    if (auth.adminExists()) {
      return res.status(400).json({ ok: false, error: "تم إنشاء حساب الدخول مسبقًا." });
    }
    const { username, password, confirmPassword } = req.body || {};
    if (password !== confirmPassword) {
      return res.status(400).json({ ok: false, error: "كلمتا المرور غير متطابقتين." });
    }
    auth.createAdmin(username, password);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ ok: false, error: "تعذر إنشاء الجلسة." });
      req.session.authenticated = true;
      req.session.username = username;
      res.json({ ok: true });
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const key = String(username || "");
  if (isLockedOut(key)) {
    return res.status(429).json({ ok: false, error: "محاولات كثيرة فاشلة، الرجاء الانتظار دقيقة ثم المحاولة مجددًا." });
  }
  if (!auth.verifyLogin(username, password)) {
    recordFailedAttempt(key);
    return res.status(401).json({ ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." });
  }
  clearAttempts(key);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, error: "تعذر إنشاء الجلسة." });
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ ok: true });
  });
});

app.post("/api/logout", auth.requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("jad_admin_sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  res.json({ ok: true, username: req.session.username });
});

app.post("/api/change-password", auth.requireAuth, (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ ok: false, error: "كلمتا المرور الجديدتان غير متطابقتين." });
    }
    auth.changePassword(currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---------- content data API ----------
app.get("/api/data", auth.requireAuth, (req, res) => {
  try {
    res.json({ ok: true, data: dataStore.readSiteData() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/data/contact", auth.requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    if (!isNonEmptyString(body.phone, 30)) throw new Error("رقم الهاتف مطلوب.");
    if (!isNonEmptyString(body.whatsapp, 30)) throw new Error("رقم واتساب مطلوب.");
    if (!isNonEmptyString(body.email, 200)) throw new Error("البريد الإلكتروني مطلوب.");
    if (!isBilingual(body.address, 500)) throw new Error("العنوان مطلوب باللغتين.");
    if (!isBilingual(body.hours, 200)) throw new Error("ساعات العمل مطلوبة باللغتين.");

    const data = dataStore.readSiteData();
    data.contact = {
      phone: body.phone.trim(),
      whatsapp: body.whatsapp.trim(),
      email: body.email.trim(),
      address: { ar: body.address.ar.trim(), en: body.address.en.trim() },
      hours: { ar: body.hours.ar.trim(), en: body.hours.en.trim() },
    };
    dataStore.writeSiteData(data);
    res.json({ ok: true, data: data.contact });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.put("/api/data/texts", auth.requireAuth, (req, res) => {
  try {
    const body = req.body || {};
    const fields = ["heroKicker", "heroLead", "aboutLead", "aboutBody", "founderRole", "founderCaption", "footerText"];
    const texts = {};
    for (const field of fields) {
      if (!isBilingual(body[field], 5000)) throw new Error(`الحقل "${field}" مطلوب باللغتين.`);
      texts[field] = { ar: body[field].ar.trim(), en: body[field].en.trim() };
    }
    const data = dataStore.readSiteData();
    data.texts = texts;
    dataStore.writeSiteData(data);
    res.json({ ok: true, data: data.texts });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---------- generic collection CRUD (practices / cases / blog) ----------
function buildPracticeRecord(body, existingId) {
  if (!isBilingual(body.title, 200)) throw new Error("عنوان الخدمة مطلوب باللغتين.");
  if (!isBilingual(body.subtitle, 300)) throw new Error("الوصف المختصر مطلوب باللغتين.");
  if (!isBilingual(body.desc, 2000)) throw new Error("الوصف التفصيلي مطلوب باللغتين.");
  const icon = isNonEmptyString(body.icon, 60) ? body.icon.trim() : "briefcase-business";
  const servicesAr = splitLines(body.servicesAr);
  const servicesEn = splitLines(body.servicesEn);
  return {
    id: existingId || (isValidId(body.id) ? body.id : generateId("service")),
    icon,
    title: { ar: body.title.ar.trim(), en: body.title.en.trim() },
    subtitle: { ar: body.subtitle.ar.trim(), en: body.subtitle.en.trim() },
    desc: { ar: body.desc.ar.trim(), en: body.desc.en.trim() },
    services: { ar: servicesAr, en: servicesEn },
  };
}

function buildCaseRecord(body, existingId) {
  if (!isBilingual(body.title, 300)) throw new Error("عنوان القضية مطلوب باللغتين.");
  if (!isBilingual(body.category, 200)) throw new Error("تصنيف القضية مطلوب باللغتين.");
  if (!isBilingual(body.summary, 3000)) throw new Error("ملخص القضية مطلوب باللغتين.");
  if (!isBilingualOptional(body.amount, 200)) throw new Error("قيمة/بيان القضية غير صالح.");
  if (!isBilingualOptional(body.result, 300)) throw new Error("نتيجة القضية غير صالحة.");
  if (!isBilingualOptional(body.challenge, 2000)) throw new Error("حقل التحدي القانوني غير صالح.");
  if (!isBilingualOptional(body.action, 2000)) throw new Error("حقل الإجراء المتخذ غير صالح.");
  if (!isSafeAssetPath(body.file)) throw new Error("مسار الملف غير صالح.");
  if (!isSafeAssetPath(body.image)) throw new Error("مسار الصورة غير صالح.");

  return {
    id: existingId || (isValidId(body.id) ? body.id : generateId("case")),
    file: body.file || "",
    image: body.image || "",
    title: { ar: body.title.ar.trim(), en: body.title.en.trim() },
    category: { ar: body.category.ar.trim(), en: body.category.en.trim() },
    amount: body.amount ? { ar: body.amount.ar.trim(), en: body.amount.en.trim() } : { ar: "", en: "" },
    result: body.result ? { ar: body.result.ar.trim(), en: body.result.en.trim() } : { ar: "", en: "" },
    summary: { ar: body.summary.ar.trim(), en: body.summary.en.trim() },
    challenge: body.challenge ? { ar: body.challenge.ar.trim(), en: body.challenge.en.trim() } : { ar: "", en: "" },
    action: body.action ? { ar: body.action.ar.trim(), en: body.action.en.trim() } : { ar: "", en: "" },
  };
}

function buildBlogRecord(body, existingId) {
  if (!isBilingual(body.title, 300)) throw new Error("عنوان المقالة مطلوب باللغتين.");
  if (!isBilingual(body.category, 100)) throw new Error("تصنيف المقالة مطلوب باللغتين.");
  if (!isBilingual(body.summary, 2000)) throw new Error("ملخص المقالة مطلوب باللغتين.");
  return {
    id: existingId || (isValidId(body.id) ? body.id : generateId("post")),
    category: { ar: body.category.ar.trim(), en: body.category.en.trim() },
    title: { ar: body.title.ar.trim(), en: body.title.en.trim() },
    summary: { ar: body.summary.ar.trim(), en: body.summary.en.trim() },
  };
}

const COLLECTIONS = {
  practices: { key: "practices", build: buildPracticeRecord },
  cases: { key: "cases", build: buildCaseRecord },
  blog: { key: "blog", build: buildBlogRecord },
};

Object.values(COLLECTIONS).forEach(({ key, build }) => {
  app.get(`/api/data/${key}`, auth.requireAuth, (req, res) => {
    try {
      const data = dataStore.readSiteData();
      res.json({ ok: true, data: data[key] || [] });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post(`/api/data/${key}`, auth.requireAuth, (req, res) => {
    try {
      const data = dataStore.readSiteData();
      const list = data[key] || [];
      const record = build(req.body || {});
      if (list.some((item) => item.id === record.id)) {
        throw new Error("المعرّف مستخدم بالفعل، اختر معرّفًا آخر.");
      }
      list.push(record);
      data[key] = list;
      dataStore.writeSiteData(data);
      res.json({ ok: true, data: record });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.put(`/api/data/${key}/:id`, auth.requireAuth, (req, res) => {
    try {
      const data = dataStore.readSiteData();
      const list = data[key] || [];
      const index = list.findIndex((item) => item.id === req.params.id);
      if (index === -1) throw new Error("العنصر غير موجود.");
      const record = build(req.body || {}, req.params.id);
      list[index] = record;
      data[key] = list;
      dataStore.writeSiteData(data);
      res.json({ ok: true, data: record });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete(`/api/data/${key}/:id`, auth.requireAuth, (req, res) => {
    try {
      const data = dataStore.readSiteData();
      const list = data[key] || [];
      const nextList = list.filter((item) => item.id !== req.params.id);
      if (nextList.length === list.length) throw new Error("العنصر غير موجود.");
      data[key] = nextList;
      dataStore.writeSiteData(data);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
});

// ---------- image upload ----------
app.post("/api/upload", auth.requireAuth, (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "لم يتم إرسال أي صورة." });
    }
    res.json({ ok: true, path: publicPathFor(req.file.filename) });
  });
});

// ---------- git publish ----------
app.post("/api/publish", auth.requireAuth, async (req, res) => {
  try {
    const result = await gitPublish.publish();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, log: [err.message], error: err.message });
  }
});

app.use((req, res) => {
  res.status(404).send("الصفحة غير موجودة.");
});

app.listen(PORT, HOST, () => {
  console.log("=".repeat(60));
  console.log(`لوحة التحكم تعمل الآن على: http://${HOST}:${PORT}/admin`);
  console.log(`الموقع نفسه متاح على: http://${HOST}:${PORT}/`);
  console.log("=".repeat(60));
});
