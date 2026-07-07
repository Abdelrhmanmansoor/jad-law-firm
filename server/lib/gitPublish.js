const { execFile } = require("child_process");
const { ROOT_DIR } = require("./paths");

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: ROOT_DIR, timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr && stderr.trim()) || error.message;
        reject(new Error(message));
        return;
      }
      resolve((stdout || "").trim());
    });
  });
}

async function isGitRepo() {
  try {
    await runGit(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch (err) {
    return false;
  }
}

async function hasChanges() {
  const status = await runGit(["status", "--porcelain"]);
  return status.length > 0;
}

async function publish() {
  const log = [];

  if (!(await isGitRepo())) {
    throw new Error("المجلد الحالي ليس مستودع Git.");
  }
  log.push("تم التحقق من مستودع Git.");

  const changed = await hasChanges();
  if (!changed) {
    return { ok: true, noChanges: true, log: [...log, "لا توجد أي تغييرات جديدة لنشرها."] };
  }
  log.push("تم العثور على تغييرات جديدة.");

  await runGit(["add", "-A"]);
  log.push("تم حفظ التغييرات (git add).");

  const timestamp = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const message = `تحديث محتوى الموقع عبر لوحة التحكم - ${timestamp}`;
  await runGit(["commit", "-m", message]);
  log.push("تم إنشاء نسخة محفوظة (commit).");

  try {
    await runGit(["push"]);
    log.push("تم رفع التعديلات بنجاح إلى GitHub.");
  } catch (pushError) {
    log.push(`تم الحفظ محليًا، لكن فشل الرفع إلى GitHub: ${pushError.message}`);
    return { ok: false, log, error: pushError.message };
  }

  return { ok: true, log };
}

module.exports = { publish, isGitRepo, hasChanges };
