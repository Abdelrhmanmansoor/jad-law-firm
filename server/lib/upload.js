const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { UPLOADS_DIR, UPLOADS_PUBLIC_PREFIX, CASE_DOCS_DIR, CASE_DOCS_PUBLIC_PREFIX } = require("./paths");

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const ALLOWED_DOC_MIME = new Set(["application/pdf"]);
const ALLOWED_DOC_EXT = new Set([".pdf"]);
const MAX_DOC_SIZE_BYTES = 15 * 1024 * 1024;

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(CASE_DOCS_DIR)) fs.mkdirSync(CASE_DOCS_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_IMAGE_EXT.has(ext) ? ext : ".jpg";
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
    cb(null, uniqueName);
  },
});

function imageFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype) || !ALLOWED_IMAGE_EXT.has(ext)) {
    cb(new Error("نوع الملف غير مسموح. الأنواع المسموحة: jpg, jpeg, png, webp فقط."));
    return;
  }
  cb(null, true);
}

const upload = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE_BYTES, files: 1 },
});

function sanitizeBaseName(originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const cleaned = base
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\.\./g, "")
    .trim()
    .slice(0, 80);
  return cleaned || "مستند";
}

const docStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, CASE_DOCS_DIR);
  },
  filename(req, file, cb) {
    const safeBase = sanitizeBaseName(file.originalname);
    const uniqueName = `${safeBase}-${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}.pdf`;
    cb(null, uniqueName);
  },
});

function docFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_DOC_MIME.has(file.mimetype) || !ALLOWED_DOC_EXT.has(ext)) {
    cb(new Error("نوع الملف غير مسموح. المسموح فقط ملفات PDF."));
    return;
  }
  cb(null, true);
}

const uploadDoc = multer({
  storage: docStorage,
  fileFilter: docFileFilter,
  limits: { fileSize: MAX_DOC_SIZE_BYTES, files: 1 },
});

function publicPathFor(filename) {
  return `${UPLOADS_PUBLIC_PREFIX}/${filename}`;
}

function publicDocPathFor(filename) {
  return `${CASE_DOCS_PUBLIC_PREFIX}/${filename}`;
}

module.exports = { upload, uploadDoc, publicPathFor, publicDocPathFor };
