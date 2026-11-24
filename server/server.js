require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const helmet = require("helmet");

const { ROOT_DIR, SITE_DATA_FILE } = require("./lib/paths");
const auth = require("./lib/auth");
const dataStore = require("./lib/dataStore");
const gitPublish = require("./lib/gitPublish");
const githubAuth = require("./lib/githubAuth");
const { upload, uploadDoc, publicPathFor, publicDocPathFor } = require("./lib/upload");
const {
  isNonEmptyString,
  isBilingual,
  isBilingualOptional,
  isSafeAssetPath,
  generateId,
  isValidId,
  splitLines,
  slugify,
} = require("./lib/validate");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "127.0.0.1";
const ADMIN_DIR = path.join(__dirname, "admin");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.set("etag", "strong");

// ضغط الاستجابات: يقلّل حجم HTML و CSS و JS بنحو 70% ويسرّع أول عرض للصفحة.
app.use(compression());

// ترويسات أمان. سياسة المحتوى معطّلة لأن الموقع يستخدم أنماطًا مضمّنة وخطوط جوجل،
// والخادم محلي فقط - التشديد الفعلي يتم على مستوى الاستضافة.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

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

// ---------- public static site ----------
// الموقع صار يستخدم مسارات حقيقية (/about، /en/practices ...) ولكل مسار ملف
// HTML مولّد مسبقًا عبر `npm run build`. لذلك نخدم جذر المشروع كملفات ثابتة،
// مع منع أي مجلد لا يخص الموقع العام.
const PRIVATE_PREFIXES = ["/server", "/tools", "/node_modules", "/.git", "/data"];

app.use((req, res, next) => {
  const url = req.path.toLowerCase();
  if (url === "/data/site-data.json") return next();
  if (PRIVATE_PREFIXES.some((prefix) => url === prefix || url.startsWith(prefix + "/"))) {
    return res.status(404).send("الصفحة غير موجودة.");
  }
  next();
});

app.get("/data/site-data.json", (req, res) => res.sendFile(SITE_DATA_FILE));

app.use(
  express.static(ROOT_DIR, {
    extensions: ["html"],
    index: "index.html",
    dotfiles: "deny",
    setHeaders(res, filePath) {
      // الأصول ذات الأسماء الثابتة تُخزَّن طويلًا، وصفحات HTML تُراجَع دائمًا.
      if (/\.(webp|png|jpe?g|svg|woff2?|ico)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);

// ---------- session (used by /admin and /api only) ----------
const sessionMiddleware = session({
  name: "jad_admin_sid",
  secret: auth.getOrCreateSessionSecret(),
  resave: false,
  saveUninitialized: false,
  // الجلسة تتجدد مع كل استخدام: لا يُطرد المستخدم أثناء الكتابة. اللوحة محلية فقط.
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 7,
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
function optionalBilingual(value) {
  return { ar: String(value?.ar || "").trim(), en: String(value?.en || "").trim() };
}

/** معرّف جديد مقروء من العنوان الإنجليزي، فريد داخل القائمة. */
function newIdFor(body, prefix, list) {
  if (isValidId(body.id)) return body.id;
  const base = slugify(body.title?.en);
  if (!base || base.length < 2) return generateId(prefix);
  let id = base;
  let n = 2;
  while (list.some((item) => item.id === id)) id = `${base}-${n++}`;
  return id;
}
function buildPracticeRecord(body, existingId, list = []) {
  if (!isBilingual(body.title, 200)) throw new Error("عنوان الخدمة مطلوب باللغتين.");
  if (!isBilingual(body.subtitle, 300)) throw new Error("الوصف المختصر مطلوب باللغتين.");
  if (!isBilingual(body.desc, 2000)) throw new Error("الوصف التفصيلي مطلوب باللغتين.");
  const icon = isNonEmptyString(body.icon, 60) ? body.icon.trim() : "briefcase-business";
  const servicesAr = splitLines(body.servicesAr);
  const servicesEn = splitLines(body.servicesEn);
  return {
    id: existingId || newIdFor(body, "service", list),
    icon,
    title: { ar: body.title.ar.trim(), en: body.title.en.trim() },
    subtitle: { ar: body.subtitle.ar.trim(), en: body.subtitle.en.trim() },
    desc: { ar: body.desc.ar.trim(), en: body.desc.en.trim() },
    services: { ar: servicesAr, en: servicesEn },
  };
}

function buildCaseRecord(body, existingId, list = []) {
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
    id: existingId || newIdFor(body, "case", list),
    file: body.file || "",
    image: body.image || "",
    title: { ar: body.title.ar.trim(), en: body.title.en.trim() },
    category: { ar: body.category.ar.trim(), en: body.category.en.trim() },
    amount: optionalBilingual(body.amount),
    result: optionalBilingual(body.result),
    summary: { ar: body.summary.ar.trim(), en: body.summary.en.trim() },
    challenge: optionalBilingual(body.challenge),
    action: optionalBilingual(body.action),
  };
}

function buildBlogRecord(body, existingId, list = []) {
  if (!isBilingual(body.title, 300)) throw new Error("عنوان المقالة مطلوب باللغتين.");
  if (!isBilingual(body.category, 100)) throw new Error("تصنيف المقالة مطلوب باللغتين.");
  if (!isBilingual(body.summary, 2000)) throw new Error("ملخص المقالة مطلوب باللغتين.");
  return {
    id: existingId || newIdFor(body, "post", list),
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
      const record = build(req.body || {}, null, list);
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

// ---------- case document (PDF) upload ----------
app.post("/api/upload-doc", auth.requireAuth, (req, res) => {
  uploadDoc.single("document")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "لم يتم إرسال أي ملف." });
    }
    res.json({ ok: true, path: publicDocPathFor(req.file.filename) });
  });
});

// ---------- git publish ----------
// النشر يعمل في الخلفية: البدء يعود فورًا واللوحة تتابع التقدم الحقيقي.
// (كان طلبًا واحدًا طويلًا ينقطع إذا طال الرفع على اتصال بطيء.)
app.post("/api/publish", auth.requireAuth, (req, res) => {
  res.json({ ok: true, job: gitPublish.startPublish() });
});

app.get("/api/publish/status", auth.requireAuth, (req, res) => {
  res.json({ ok: true, job: gitPublish.publicJob() });
});

// حالة الربط والتعديلات غير المنشورة — تستخدمها اللوحة لعرض الشارة والتنبيهات.
app.get("/api/status", auth.requireAuth, async (req, res) => {
  try {
    const [publishState, token] = await Promise.all([
      gitPublish.status(),
      githubAuth.checkToken({ force: req.query.force === "1" }),
    ]);
    res.json({ ok: true, ...publishState, token, serverTime: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ ok: false, error: githubAuth.redact(err.message) });
  }
});

app.post("/api/github-token", auth.requireAuth, async (req, res) => {
  try {
    const token = await githubAuth.saveToken(req.body && req.body.token);
    res.json({ ok: true, token });
  } catch (err) {
    res.status(400).json({ ok: false, error: githubAuth.redact(err.message) });
  }
});

app.delete("/api/github-token", auth.requireAuth, (req, res) => {
  githubAuth.clearToken();
  res.json({ ok: true });
});

app.use((req, res) => {
  const fallback = path.join(ROOT_DIR, "404.html");
  // صفحة 404 المصممة تخص الموقع العام فقط، لا لوحة التحكم ولا الـ API.
  if (!req.path.startsWith("/api") && !req.path.startsWith("/admin") && fs.existsSync(fallback)) {
    return res.status(404).sendFile(fallback);
  }
  res.status(404).send("الصفحة غير موجودة.");
});

const server = app.listen(PORT, HOST, async () => {
  console.log("=".repeat(60));
  console.log(`لوحة التحكم تعمل الآن على: http://localhost:${PORT}/admin`);
  console.log(`الموقع نفسه متاح على: http://localhost:${PORT}/`);
  console.log("=".repeat(60));

  try {
    const migration = await githubAuth.migrateLegacyRemote();
    if (migration.migrated) console.log("✓ تم نقل رمز GitHub القديم من رابط المستودع إلى ملف آمن.");
  } catch (err) {
    console.log(`تنبيه: ${githubAuth.redact(err.message)}`);
  }
  const sync = await gitPublish.syncOnStartup();
  if (sync.startsWith("updated:")) console.log(`✓ تم جلب ${sync.split(":")[1]} تحديث جديد من GitHub (يسري بعد إعادة التشغيل).`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // اللوحة مفتوحة بالفعل (ضغطت على ملف التشغيل مرتين) — ليست مشكلة.
    console.log(`لوحة التحكم تعمل بالفعل على http://localhost:${PORT}/admin`);
    process.exit(0);
  }
  throw err;
});
