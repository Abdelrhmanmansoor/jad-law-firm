const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ROOT_DIR, DATA_DIR } = require("./paths");
const gh = require("./githubAuth");

const PRODUCTION_BRANCH = "main";
const LAST_PUBLISH_FILE = path.join(DATA_DIR, ".last-publish.json");
const LOG_DIR = path.join(DATA_DIR, "logs");
const PUBLISH_LOG = path.join(LOG_DIR, "publish.log");
const PUSH_TIMEOUT = 30 * 60 * 1000; // رفع كبير على اتصال بطيء — التوقف التام يُكتشف أسرع عبر lowSpeedTime

/**
 * حالة عملية النشر الحالية. النشر يعمل في الخلفية واللوحة تتابعه عبر
 * /api/publish/status — فلا ينقطع طلب المتصفح مهما طال الرفع.
 */
let job = null;

function logToFile(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(PUBLISH_LOG, `[${new Date().toISOString()}] ${gh.redact(line)}\n`, "utf8");
  } catch {
    /* not critical */
  }
}

function runBuild() {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [path.join(ROOT_DIR, "tools", "build.mjs")],
      { cwd: ROOT_DIR, timeout: 180000, maxBuffer: 5 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr && stderr.trim()) || "تعذر توليد صفحات الموقع."));
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

async function fetchRemote() {
  const conn = await gh.connectionOptions(gh.readToken());
  await git([...conn.args, "fetch", "--quiet", "origin", PRODUCTION_BRANCH], { timeout: 5 * 60 * 1000, env: conn.env });
}

/**
 * الرفع مع متابعة النسبة المئوية الحقيقية (Writing objects: 45%).
 * لا يظهر نص الأمر في أي رسالة — فقط مخرجات git نفسها بعد التنقيح.
 */
async function pushWithProgress(onProgress) {
  const conn = await gh.connectionOptions(gh.readToken());
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...conn.args, "push", "--progress", "origin", `HEAD:${PRODUCTION_BRANCH}`], {
      cwd: ROOT_DIR,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", ...conn.env },
      windowsHide: true,
    });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("TIMEOUT"), { timedOut: true }));
    }, PUSH_TIMEOUT);
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-8000);
      const m = text.match(/Writing objects:\s+(\d+)%[^\r\n]*?(?:,\s*([\d.]+\s*[KMG]iB))?/g);
      if (m) {
        const last = m[m.length - 1].match(/(\d+)%(?:.*?,\s*([\d.]+\s*[KMG]iB))?/);
        if (last) onProgress(Number(last[1]), last[2] || "");
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(gh.redact(err.message)));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const lines = gh.redact(stderr).split(/[\r\n]+/).filter((l) => l && !/^(Enumerating|Counting|Delta|Compressing|Writing|Total)/.test(l));
      reject(new Error(lines.slice(-6).join("\n") || `git push exited with code ${code}`));
    });
  });
}

/** يترجم أخطاء Git الشائعة إلى رسالة مفهومة وخطوة واضحة. */
function explainGitError(err) {
  const text = String((err && err.message) || err || "");
  if ((err && err.timedOut) || /TIMEOUT|low speed|too slow|timed out/i.test(text)) {
    return { code: "slow", message: "الرفع توقف لأن الاتصال بطيء جدًا أو انقطع. تأكدي من الإنترنت ثم اضغطي «نشر التعديلات» مرة أخرى — سيكمل من حيث توقف وتعديلاتك محفوظة." };
  }
  if (/could not resolve host|unable to access|network|connection|reset by peer|RPC failed|early EOF/i.test(text) && !/40[13]/.test(text)) {
    return { code: "offline", message: "انقطع الاتصال بـ GitHub أثناء النشر. تأكدي من الإنترنت ثم أعيدي المحاولة — تعديلاتك محفوظة ولن تضيع." };
  }
  if (/exceeds GitHub's file size limit|large files detected|GH001/i.test(text)) {
    return { code: "large", message: "أحد الملفات المرفوعة أكبر من الحد المسموح في GitHub (100 ميجابايت). احذفي الملف الكبير من اللوحة ثم أعيدي النشر." };
  }
  if (/403|permission|denied|not allowed|write access/i.test(text)) {
    return { code: "token", message: "رمز الربط لا يملك صلاحية الكتابة على المستودع. افتحي الإعدادات والصقي رمزًا جديدًا بصلاحية Contents: Read and write." };
  }
  if (/401|authentication failed|invalid username|could not read username|bad credentials/i.test(text)) {
    return { code: "token", message: "رمز الربط منتهي أو غير صحيح. افتحي الإعدادات والصقي رمزًا جديدًا — تعديلاتك محفوظة ولن تضيع." };
  }
  return { code: "git", message: gh.redact(text).slice(0, 600) };
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

async function ensureOnProductionBranch() {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== PRODUCTION_BRANCH) await git(["checkout", PRODUCTION_BRANCH]);
}

/** يحفظ كل التغييرات؛ يعيد false إن لم يتبقَّ شيء فعلي بعد add. */
async function commitAll(message) {
  try {
    await git(["add", "-A"]);
  } catch {
    // ملف دخيل لا يمكن قراءته (مثل ملف حجزه برنامج الحماية) لا يوقف النشر.
    await git(["add", "-u"]);
    for (const p of ["data", "assets", "case", "article", "practice", "en", "sitemap.xml", "404.html"]) {
      try {
        await git(["add", "--", p]);
      } catch {
        /* path may not exist */
      }
    }
  }
  try {
    await git(["diff", "--cached", "--quiet"]);
    return false;
  } catch {
    await git(["commit", "--quiet", "-m", message]);
    return true;
  }
}

function stamp() {
  return new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
}

/** يدمج تحديثات GitHub مع التعديلات المحلية (تُعتمد النسخة المحلية عند التعارض). */
async function syncWithRemote() {
  await fetchRemote();
  const behind = await countCommits(`HEAD..origin/${PRODUCTION_BRANCH}`);
  if (behind === 0) return false;
  try {
    await git(["rebase", "-X", "theirs", `origin/${PRODUCTION_BRANCH}`], { timeout: 5 * 60 * 1000 });
  } catch (err) {
    try {
      await git(["rebase", "--abort"]);
    } catch {
      /* nothing to abort */
    }
    throw new Error(`تعذر دمج التحديثات تلقائيًا: ${err.message}`);
  }
  return true;
}

async function ensureIdentity() {
  try {
    await git(["config", "user.email"]);
  } catch {
    await git(["config", "user.email", "admin@jad-law.local"]);
    await git(["config", "user.name", "لوحة تحكم جاد العبدالله"]);
  }
}

async function runPublish(j) {
  const step = (name) => {
    j.step = name;
    j.updatedAt = Date.now();
  };
  const note = (line) => {
    j.log.push(line);
    j.updatedAt = Date.now();
  };

  if (!(await isGitRepo())) throw Object.assign(new Error("مجلد الموقع ليس مستودع Git. تواصلي مع الدعم."), { code: "git" });

  step("check");
  const tokenState = await gh.checkToken({ force: true });
  if (tokenState.reason === "offline") throw Object.assign(new Error(tokenState.message), { code: "offline" });
  if (!tokenState.valid) throw Object.assign(new Error(tokenState.message), { code: "token" });
  note("تم التحقق من ربط GitHub.");

  await ensureIdentity();
  await ensureOnProductionBranch();

  step("build");
  await runBuild();
  note("تم تحديث صفحات الموقع وخريطة الموقع.");
  if ((await hasChanges()) && (await commitAll(`تحديث محتوى الموقع عبر لوحة التحكم - ${stamp()}`))) {
    note("تم حفظ نسخة من التعديلات.");
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    step("sync");
    if (await syncWithRemote()) {
      note("تم دمج تحديثات GitHub مع تعديلاتك.");
      await runBuild();
      if (await hasChanges()) await commitAll(`إعادة توليد الصفحات بعد الدمج - ${stamp()}`);
    }

    const ahead = await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`);
    if (ahead === 0) return { noChanges: true };

    step("push");
    j.progress = 0;
    try {
      await pushWithProgress((pct, size) => {
        j.progress = pct;
        j.size = size;
        j.updatedAt = Date.now();
      });
      const record = { at: new Date().toISOString(), commits: ahead };
      writeLastPublish(record);
      note("تم رفع التعديلات إلى GitHub — سيتحدّث الموقع خلال دقيقة تقريبًا.");
      return { lastPublish: record };
    } catch (pushError) {
      if (/rejected|non-fast-forward|fetch first/i.test(pushError.message) && attempt === 1) {
        note("تم تحديث GitHub أثناء النشر، إعادة المحاولة...");
        continue;
      }
      throw pushError;
    }
  }
  throw new Error("تعذر إكمال النشر بعد محاولتين.");
}

/** يبدأ النشر في الخلفية ويعيد حالته فورًا (أو العملية الجارية إن وُجدت). */
function startPublish() {
  if (job && job.running) return publicJob();
  job = { id: Date.now().toString(36), running: true, step: "check", progress: null, size: "", log: [], startedAt: Date.now(), updatedAt: Date.now(), result: null };
  const j = job;
  logToFile("publish started");
  runPublish(j)
    .then((res) => {
      j.result = { ok: true, ...res };
      logToFile(res.noChanges ? "no changes" : "published OK");
    })
    .catch((err) => {
      const info = err.code === "token" || err.code === "offline" || err.code === "git" ? { code: err.code, message: err.message } : explainGitError(err);
      j.result = { ok: false, code: info.code, error: info.message, failedStep: j.step };
      logToFile(`FAILED at ${j.step}: ${err.message}`);
    })
    .finally(() => {
      j.running = false;
      j.updatedAt = Date.now();
    });
  return publicJob();
}

function publicJob() {
  if (!job) return { running: false, step: null, result: null };
  const { id, running, step, progress, size, log, startedAt, updatedAt, result } = job;
  return { id, running, step, progress, size, log, startedAt, updatedAt, elapsed: Math.round((Date.now() - startedAt) / 1000), result };
}

/** حالة النشر للوحة: عدد التعديلات غير المنشورة وآخر نشر. */
async function status() {
  if (!(await isGitRepo())) return { gitRepo: false, pending: 0, lastPublish: readLastPublish() };
  const files = await changedFiles();
  const contentChanges = files.filter((line) => /(data\/site-data\.json|assets\/)/.test(line));
  const ahead = await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`);
  return {
    gitRepo: true,
    pending: contentChanges.length + ahead,
    unpushedCommits: ahead,
    lastPublish: readLastPublish(),
    publishing: Boolean(job && job.running),
  };
}

/** عند تشغيل اللوحة: جلب تحديثات المطور تلقائيًا إن كانت النسخة نظيفة. */
async function syncOnStartup() {
  try {
    if (!(await isGitRepo())) return "not-a-repo";
    const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== PRODUCTION_BRANCH) return "other-branch";
    await fetchRemote();
    const behind = await countCommits(`HEAD..origin/${PRODUCTION_BRANCH}`);
    if (behind === 0) return "up-to-date";
    if ((await hasChanges()) || (await countCommits(`origin/${PRODUCTION_BRANCH}..HEAD`)) > 0) return "pending-local";
    await git(["merge", "--ff-only", "--quiet", `origin/${PRODUCTION_BRANCH}`]);
    return `updated:${behind}`;
  } catch (err) {
    return `skipped:${gh.redact(err.message).slice(0, 120)}`;
  }
}

module.exports = { startPublish, publicJob, status, syncOnStartup, isGitRepo, hasChanges, runBuild };
