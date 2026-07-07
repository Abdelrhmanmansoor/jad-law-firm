const fs = require("fs");
const path = require("path");
const { DATA_DIR, BACKUPS_DIR, SITE_DATA_FILE } = require("./paths");

const MAX_BACKUPS = 30;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function readSiteData() {
  ensureDirs();
  if (!fs.existsSync(SITE_DATA_FILE)) {
    throw new Error("ملف البيانات data/site-data.json غير موجود.");
  }
  const raw = fs.readFileSync(SITE_DATA_FILE, "utf8");
  return JSON.parse(raw);
}

function backupCurrentFile() {
  ensureDirs();
  if (!fs.existsSync(SITE_DATA_FILE)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUPS_DIR, `site-data-${stamp}.json`);
  fs.copyFileSync(SITE_DATA_FILE, backupPath);
  pruneOldBackups();
  return backupPath;
}

function pruneOldBackups() {
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith("site-data-") && f.endsWith(".json"))
    .sort();
  while (files.length > MAX_BACKUPS) {
    const oldest = files.shift();
    fs.unlinkSync(path.join(BACKUPS_DIR, oldest));
  }
}

function writeSiteData(data) {
  ensureDirs();
  backupCurrentFile();
  const tmpPath = `${SITE_DATA_FILE}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, SITE_DATA_FILE);
}

module.exports = { readSiteData, writeSiteData, backupCurrentFile, ensureDirs };
