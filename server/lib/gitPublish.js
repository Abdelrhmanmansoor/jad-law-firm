const { execFile } = require("child_process");
const path = require("path");
const { ROOT_DIR } = require("./paths");

const PRODUCTION_BRANCH = "main";

/**
 * إعادة توليد صفحات الموقع الثابتة.
 *
 * محتوى الموقع صار يُولَّد مسبقًا في ملفات HTML حقيقية (about/index.html ...)
 * حتى تراه محركات البحث. لذلك أي تعديل من لوحة التحكم على data/site-data.json
 * يجب أن يُتبَع بإعادة بناء، وإلا نُشرت صفحات قديمة لا تطابق المحتوى الجديد.
 */
function runBuild() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(ROOT_DIR, "tools", "build.mjs")],
      { cwd: ROOT_DIR, timeout: 120000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr && stderr.trim()) || error.message));
          return;
        }
        resolve((stdout || "").trim());
      },
    );
  });
}

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

async function currentBranch() {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
}

async function ensureOnProductionBranch(log) {
  const branch = await currentBranch();
  if (branch === PRODUCTION_BRANCH) return;
  log.push(`الفرع الحالي "${branch}" وليس فرع النشر الرسمي، جارٍ الانتقال إلى "${PRODUCTION_BRANCH}"...`);
  await runGit(["checkout", PRODUCTION_BRANCH]);
  log.push(`تم الانتقال إلى فرع "${PRODUCTION_BRANCH}" بنجاح.`);
}

async function publish() {
  const log = [];

  if (!(await isGitRepo())) {
    throw new Error("المجلد الحالي ليس مستودع Git.");
  }
  log.push("تم التحقق من مستودع Git.");

  await ensureOnProductionBranch(log);

  // البناء أولًا: قد لا يوجد تغيير في المصدر لكن الصفحات المولّدة تحتاج تحديثًا.
  try {
    await runBuild();
    log.push("تم تحديث صفحات الموقع وخريطة الموقع (sitemap) بالمحتوى الجديد.");
  } catch (buildError) {
    log.push(`تعذّر إعادة توليد صفحات الموقع: ${buildError.message}`);
    return { ok: false, log, error: buildError.message };
  }

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
    await runGit(["push", "origin", `HEAD:${PRODUCTION_BRANCH}`]);
    log.push("تم رفع التعديلات بنجاح إلى GitHub.");
  } catch (pushError) {
    log.push(`تم الحفظ محليًا، لكن فشل الرفع إلى GitHub: ${pushError.message}`);
    return { ok: false, log, error: pushError.message };
  }

  return { ok: true, log };
}

module.exports = { publish, isGitRepo, hasChanges, runBuild };
