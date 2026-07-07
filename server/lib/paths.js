const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const SITE_DATA_FILE = path.join(DATA_DIR, "site-data.json");
const ADMIN_USER_FILE = path.join(DATA_DIR, "admin-user.json");
const SESSION_SECRET_FILE = path.join(DATA_DIR, ".session-secret");
const UPLOADS_DIR = path.join(ROOT_DIR, "assets", "uploads");
const UPLOADS_PUBLIC_PREFIX = "assets/uploads";

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  BACKUPS_DIR,
  SITE_DATA_FILE,
  ADMIN_USER_FILE,
  SESSION_SECRET_FILE,
  UPLOADS_DIR,
  UPLOADS_PUBLIC_PREFIX,
};
