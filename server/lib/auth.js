const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { DATA_DIR, ADMIN_USER_FILE, SESSION_SECRET_FILE } = require("./paths");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function adminExists() {
  return fs.existsSync(ADMIN_USER_FILE);
}

function readAdmin() {
  if (!adminExists()) return null;
  return JSON.parse(fs.readFileSync(ADMIN_USER_FILE, "utf8"));
}

function isValidUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_.\-]{3,40}$/.test(username);
}

function isValidPassword(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 200;
}

function createAdmin(username, password) {
  ensureDataDir();
  if (adminExists()) throw new Error("تم إنشاء حساب الدخول بالفعل.");
  if (!isValidUsername(username)) throw new Error("اسم المستخدم يجب أن يكون 3 أحرف على الأقل (حروف/أرقام إنجليزية فقط).");
  if (!isValidPassword(password)) throw new Error("كلمة المرور يجب ألا تقل عن 8 خانات.");
  const passwordHash = bcrypt.hashSync(password, 12);
  const record = { username, passwordHash, createdAt: new Date().toISOString() };
  fs.writeFileSync(ADMIN_USER_FILE, JSON.stringify(record, null, 2), "utf8");
  return record;
}

function verifyLogin(username, password) {
  const admin = readAdmin();
  if (!admin) return false;
  if (typeof username !== "string" || typeof password !== "string") return false;
  if (username !== admin.username) return false;
  return bcrypt.compareSync(password, admin.passwordHash);
}

function changePassword(currentPassword, newPassword) {
  const admin = readAdmin();
  if (!admin) throw new Error("لا يوجد حساب دخول بعد.");
  if (!bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    throw new Error("كلمة المرور الحالية غير صحيحة.");
  }
  if (!isValidPassword(newPassword)) throw new Error("كلمة المرور الجديدة يجب ألا تقل عن 8 خانات.");
  admin.passwordHash = bcrypt.hashSync(newPassword, 12);
  admin.updatedAt = new Date().toISOString();
  fs.writeFileSync(ADMIN_USER_FILE, JSON.stringify(admin, null, 2), "utf8");
}

function getOrCreateSessionSecret() {
  ensureDataDir();
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  if (fs.existsSync(SESSION_SECRET_FILE)) {
    return fs.readFileSync(SESSION_SECRET_FILE, "utf8").trim();
  }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SESSION_SECRET_FILE, secret, "utf8");
  return secret;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ ok: false, error: "يجب تسجيل الدخول أولاً." });
  }
  return res.redirect("/admin/login");
}

module.exports = {
  adminExists,
  readAdmin,
  createAdmin,
  verifyLogin,
  changePassword,
  getOrCreateSessionSecret,
  requireAuth,
  isValidUsername,
  isValidPassword,
};
