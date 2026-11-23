const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ROOT_DIR, DATA_DIR } = require("./paths");
const gh = require("./githubAuth");

const PRODUCTION_BRANCH = "main";
const LAST_PUBLISH_FILE = path.join(DATA_DIR, ".last-publish.json");

let publishing = false;

/**
 * إعادة توليد صفحات الموقع الثابتة.
 * أي تعديل على data/site-data.json يجب أن يُتبَع بإعادة بناء، وإلا نُشرت صفحات
 * قديمة لا تطابق المحتوى الجديد.
 */
function runBuild() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(ROOT_DIR, "tools", "build.mjs")],
      { cwd: ROOT_DIR, timeout: 120000, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
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

const git = gh.git;

async function isGitRepo() {
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function changedFiles() {
  const status = await git(["status", "--porcelain"]);
  return status ? status.split("\n").filter(Boolean) : [];
}

async function hasChanges() {
  return (await changedFiles()).length > 0;
}

async function countCommits(range) {
  try {
    return Number(await git(["rev-list", "--count", range])) || 0;
  } catch {
    return 0;
  }
}

async function authArgs() {
  const token = gh.readToken();
  return token ? gh.authHeaderArgs(token) : [];
}

async function fetchRemote() {
  await git([...(await authArgs()), "fetch", "--quiet", "origin", PRODUCTION_BRANCH], { timeout: 120000 });
}

/** يترجم أخطاء Git الشائعة إلى رسالة مفهومة وخطوة واضحة. */
function explainGitError(message) {
  const text = String(message || "");
  if (/could not resolve host|unable to access|timed out|network|connection/i.test(text) && !/40[13]/.test(text)) {
    return { code: "offline", message: "لا يوجد اتصال بالإنترنت أو GitHub غير متاح الآن. تأكد من الإنترنت ثم أعد المحاولة — تعديلاتك محفوظة ولن تضيع." };
  }
  if (/403|permission|denied|not allowed|write access/i.test(text)) {
    return { code: "token", message: "رمز الربط لا يملك صلاحية الكتابة على المستودع. افتح الإعدادات والصق رمزًا جديدًا بصلاحية Contents: Read and write." };
  }
  if (/401|authentication failed|invalid username|could not read username|bad credentials/i.test(text)) {
    return { code: "token", message: "رمز الربط منتهي أو غير صحيح. افتح الإعدادات والصق رمزًا جديدًا — تعديلاتك محفوظة ولن تضيع." };
  }
  return { code: "git", message: gh.redact(text) };
}

function readLastPublish() {
  try {
    return JSON.parse(fs.readFileSync(LAST_PUBLISH_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeLastPublish(record) {
  try {
    fs.writeFileSync(LAST_PUBLISH_FILE, JSON.stringify(record, null, 2), "utf8");
  } catch {
    /* not critical */
  }
}

async function ensureOnProductionBranch(log) {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === PRODUCTION_BRANCH) return;
  log.push(`الانتقال من الفرع "${branch}" إلى فرع النشر "${PRODUCTION_BRANCH}"...`);
  await git(["checkout", PRODUCTION_BRANCH]);
}

/** يحفظ كل التغييرات؛ يعيد false إن لم يتبقَّ شيء فعلي بعد add
 * (مثل فروق نهايات الأسطر فقط في ويندوز) بدل أن يفشل commit. */
async function commitAll(message) {
  await git(["add", "-A"]);
  try {
    await git(["diff", "--cached", "--quiet"]);
    return false; // لا يوجد شيء مُجهَّز للحفظ
  } catch {
    await git(["commit", "--quiet", "-m", message]);
    return true;
  }
}

function stamp() {
  return new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

/**
 * يدمج أي تحديثات على GitHub (مثل تحديثات المطور على الكود) مع تعديلات المحامية.
 * عند التعارض في نفس الملف تُعتمد نسخة المحامية (-X theirs في rebase تعني
 * التعديل الذي يُعاد تطبيقه، أي التعديل المحلي).
 */
async function syncWithRemote(log) {
  await fetchRemote();
  const behind = await countCommits(`HEAD..origin/${PRODUCTION_BRANCH}`);
  if (behind === 0) return false;
  log.push(`يوجد ${behind} تحديث جديد على GitHub، جارٍ دمجه مع تعديلاتك...`);
  try {
    await git(["-c", "user.name=Jad Admin", "-c", "user.email=admin@localhost", "rebase", "-X", "theirs", `origin/${PRODUCTION_BRANCH}`], { timeout: 120000 });
  } catch (err) {
    try {
      await git(["rebase", "--abort"]);
    } catch {
      /* nothing to abort */
    }
    throw new Error(`تعذر دمج التحديثات تلقائيًا: ${err.message}`);
  }
  log.push("تم دمج التحديثات بنجاح.");
  return true;
}

async function ensureIdentity() {
  // جهاز جديد بلا اسم/بريد في Git يجعل commit يفشل برسالة غامضة.
  try {
    await git(["config", "user.email"]);
  } catch {
    await git(["config", "user.email", "admin@jad-law.local"]);
    await git(["config", "user.name", "لوحة تحكم جاد العبدالله"]);
  }
}

async function publish() {
  if (publishing) {
    return { ok: false, code: "busy", log: [], error: "عملية نشر جارية بالفعل، انتظر انتهاءها." };
  }
  publishing = true;
  const log = [];
  try {
    if (!(await isGitRepo())) {
      return { ok: false, code: "git", log, error: "مجلد الموقع ليس مستودع Git. تواصل مع المطور." };
    }

    // 1) فحص الربط قبل أي شيء — حتى لا نبني ونحفظ ثم نفشل في آخر خطوة.
    const tokenState = await gh.checkToken({ force: true });
    if (tokenState.reason === "offline") {
      return { ok: false, code: "offline", log, error: tokenState.message };
    }
    if (!tokenState.valid) {
      return { ok: false, code: "token", log, error: tokenState.message, token: tokenState };
    }
    log.push("تم التحقق من ربط GitHub.");

    await ensureIdentity();
    await ensureOnProductionBranch(log);

    // 2) توليد الصفحات بالمحتوى الجديد.
    await runBuild();
    log.push("تم تحديث صفحات الموقع وخريطة الموقع.");

    // 3) حفظ نسخة محلية.
    if ((await hasChanges()) && (await commitAll(`تحديث محتوى الموقع عبر لوحة التحكم - ${stamp()}`))) {
      log.push("تم حفظ نسخة من التعديلات.");
    }

    // 4) الدمج مع GitHub ثم الرفع (مع محاولة ثانية إن سبقنا تحديث آخر).
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const merged = await syncWithRemote(log);
      if (merged) {
        // الكود قد تغيّر — نعيد البناء ليتطابق القالب الجديد مع المحتوى.
        await runBuild();
        if (await hasChanges()) await commitAll(`إعادة توليد الصفحات بعد الدمج - ${stamp()}`);
      }

      const ahead = await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`);
      if (ahead === 0) {
        return { ok: true, noChanges: true, log: [...log, "لا توجد تعديلات جديدة لنشرها — الموقع محدَّث."] };
      }

      try {
        await git([...(await authArgs()), "push", "--quiet", "origin", `HEAD:${PRODUCTION_BRANCH}`], { timeout: 180000 });
        const record = { at: new Date().toISOString(), commits: ahead };
        writeLastPublish(record);
        log.push("تم رفع التعديلات إلى GitHub — سيتحدّث الموقع خلال دقيقة تقريبًا.");
        return { ok: true, log, lastPublish: record };
      } catch (pushError) {
        const rejected = /rejected|non-fast-forward|fetch first/i.test(pushError.message);
        if (rejected && attempt === 1) {
          log.push("تم تحديث GitHub أثناء النشر، إعادة المحاولة...");
          continue;
        }
        const info = explainGitError(pushError.message);
        return { ok: false, code: info.code, log, error: info.message };
      }
    }
    return { ok: false, code: "git", log, error: "تعذر إكمال النشر بعد محاولتين." };
  } catch (err) {
    const info = explainGitError(err.message);
    return { ok: false, code: info.code, log, error: info.message };
  } finally {
    publishing = false;
  }
}

/** حالة النشر للوحة: عدد التعديلات غير المنشورة وآخر نشر. */
async function status() {
  if (!(await isGitRepo())) return { gitRepo: false, pending: 0, lastPublish: readLastPublish() };
  const files = await changedFiles();
  // نتجاهل الصفحات المولَّدة: المهم ما عدّلته المحامية (البيانات والمرفقات).
  const contentChanges = files.filter((line) => /(data\/site-data\.json|assets\/)/.test(line));
  const ahead = await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`);
  return {
    gitRepo: true,
    pending: contentChanges.length + ahead,
    unpushedCommits: ahead,
    lastPublish: readLastPublish(),
    publishing,
  };
}

/**
 * عند تشغيل اللوحة: إن كانت النسخة المحلية نظيفة ومتأخرة عن GitHub نجلب
 * التحديثات تلقائيًا (fast-forward فقط) — فتصل إصلاحات المطور لجهاز المحامية
 * بدون أي تدخل يدوي.
 */
async function syncOnStartup() {
  try {
    if (!(await isGitRepo())) return "not-a-repo";
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== PRODUCTION_BRANCH) return "other-branch";
    await fetchRemote();
    const behind = await countCommits(`HEAD..origin/${PRODUCTION_BRANCH}`);
    if (behind === 0) return "up-to-date";
    if ((await hasChanges()) || (await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`)) > 0) {
      return "pending-local"; // سيُدمج تلقائيًا عند الضغط على نشر
    }
    await git(["merge", "--ff-only", "--quiet", `origin/${PRODUCTION_BRANCH}`]);
    return `updated:${behind}`;
  } catch (err) {
    return `skipped:${gh.redact(err.message).slice(0, 120)}`;
  }
}

module.exports = { publish, status, syncOnStartup, isGitRepo, hasChanges, runBuild };
