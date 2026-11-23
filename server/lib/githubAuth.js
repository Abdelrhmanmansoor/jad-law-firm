/**
 * ربط النشر بـ GitHub.
 *
 * المشكلة القديمة: كان رمز الدخول (Token) يُكتب داخل رابط origin نفسه
 * (https://TOKEN@github.com/...). عند انتهاء صلاحية الرمز يفشل الرفع بصمت،
 * وملف التشغيل لا يعيد طلب رمز جديد لأنه يرى "@github.com" في الرابط فيظن أن
 * الربط سليم — فتعلق المحامية بلا حل إلا تدخل المطور.
 *
 * الحل هنا:
 *  - الرمز يُحفظ في ملف محلي مستقل data/.github-token (مستثنى من Git).
 *  - رابط origin يبقى نظيفًا دائمًا، والرمز يُمرَّر لكل عملية رفع فقط.
 *  - الرمز يُفحص مقابل GitHub قبل كل نشر، ونعرف تاريخ انتهائه من ترويسة
 *    github-authentication-token-expiration لننبّه قبل الانتهاء بوقت كافٍ.
 *  - تغيير الرمز يتم من داخل لوحة التحكم (الإعدادات) بلصقه فقط.
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { ROOT_DIR, DATA_DIR } = require("./paths");

const TOKEN_FILE = path.join(DATA_DIR, ".github-token");
const DEFAULT_REPO = "Abdelrhmanmansoor/jad-law-firm";
const CHECK_CACHE_MS = 5 * 60 * 1000;

let cachedCheck = null;

// يمنع Git ومدير بيانات الاعتماد في ويندوز من فتح نوافذ تسجيل دخول تعلّق النشر.
const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
};

function git(args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      // windowsHide: اللوحة تعمل بلا نافذة، فبدونه يفتح كل أمر git نافذة أوامر سوداء.
      { cwd: ROOT_DIR, timeout: opts.timeout || 90000, maxBuffer: 10 * 1024 * 1024, env: GIT_ENV, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const err = new Error(redact((stderr && stderr.trim()) || error.message));
          err.code = error.code;
          reject(err);
          return;
        }
        resolve((stdout || "").trim());
      },
    );
  });
}

/** يخفي أي رمز قد يظهر في رسائل الأخطاء أو السجلات. */
function redact(text) {
  return String(text || "")
    .replace(/(gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{20,})/g, "••••")
    .replace(/(https?:\/\/)[^@\s/]+@/g, "$1");
}

function looksLikeToken(value) {
  return typeof value === "string" && /^(gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/.test(value.trim());
}

function readToken() {
  try {
    const value = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeToken(token) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, token.trim(), { encoding: "utf8", mode: 0o600 });
  cachedCheck = null;
}

function clearToken() {
  try {
    fs.unlinkSync(TOKEN_FILE);
  } catch {
    /* already gone */
  }
  cachedCheck = null;
}

/** owner/repo من رابط origin — مع احتياطي للمستودع الرسمي. */
async function repoSlug() {
  try {
    const url = await git(["remote", "get-url", "origin"]);
    const match = url.match(/github\.com[/:]([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    /* no origin */
  }
  return DEFAULT_REPO;
}

function cleanRemoteUrl(slug) {
  return `https://github.com/${slug}.git`;
}

/**
 * ترحيل تلقائي من الطريقة القديمة: إن وُجد رمز داخل رابط origin ننقله لملف
 * الرمز (إن لم يوجد ملف بعد) وننظّف الرابط. يُستدعى عند تشغيل الخادم.
 */
async function migrateLegacyRemote() {
  let url;
  try {
    url = await git(["remote", "get-url", "origin"]);
  } catch {
    return { migrated: false };
  }
  const match = url.match(/^https:\/\/(?:([^:@/]+):)?([^@/]+)@github\.com\/(.+?)(?:\.git)?\/?$/i);
  if (!match) return { migrated: false };
  const embedded = decodeURIComponent(match[2]);
  const slug = match[3];
  if (!readToken() && looksLikeToken(embedded)) writeToken(embedded);
  await git(["remote", "set-url", "origin", cleanRemoteUrl(slug)]);
  return { migrated: true };
}

function authHeaderArgs(token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return [
    "-c",
    "credential.helper=",
    "-c",
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
  ];
}

/** "2026-12-31 00:00:00 UTC" أو "2026-12-31 12:00:00 -0700" → ISO */
function parseExpiry(header) {
  if (!header) return null;
  const m = String(header).trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  let zone = m[3] || "Z";
  if (/^utc$/i.test(zone)) zone = "Z";
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const date = new Date(`${m[1]}T${m[2]}${zone}`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** يفحص الرمز مقابل GitHub ويعيد حالته وتاريخ انتهائه. */
async function checkToken({ force = false, token: explicitToken } = {}) {
  const token = explicitToken || readToken();
  if (!token) {
    return { configured: false, valid: false, reason: "missing", message: "لم يتم ربط النشر بعد — الصقي رمز الربط من صفحة الإعدادات." };
  }
  if (!explicitToken && !force && cachedCheck && Date.now() - cachedCheck.at < CHECK_CACHE_MS) {
    return cachedCheck.result;
  }

  const slug = await repoSlug();
  let result;
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "jad-admin-panel",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15000),
    });
    const expiresHeader = res.headers.get("github-authentication-token-expiration");
    const expiresIso = parseExpiry(expiresHeader);
    const daysLeft = expiresIso ? Math.floor((new Date(expiresIso) - Date.now()) / 86400000) : null;

    if (res.status === 401) {
      result = {
        configured: true,
        valid: false,
        reason: "expired",
        message: "رمز الربط منتهي الصلاحية أو تم إلغاؤه. الصق رمزًا جديدًا من الإعدادات.",
      };
    } else if (res.status === 404 || res.status === 403) {
      result = {
        configured: true,
        valid: false,
        reason: "no-access",
        message: "الرمز صالح لكنه لا يملك صلاحية على مستودع الموقع. أنشئ رمزًا يشمل المستودع بصلاحية Contents: Read and write.",
      };
    } else if (!res.ok) {
      result = { configured: true, valid: false, reason: "github-error", message: `استجابة غير متوقعة من GitHub (${res.status}).` };
    } else {
      const body = await res.json();
      const canPush = body.permissions ? body.permissions.push !== false : true;
      result = {
        configured: true,
        valid: canPush,
        reason: canPush ? "ok" : "read-only",
        message: canPush ? "النشر متصل ويعمل." : "الرمز يسمح بالقراءة فقط. يلزم صلاحية Contents: Read and write.",
        repo: slug,
        expiresAt: expiresIso,
        daysLeft,
        neverExpires: !expiresIso,
      };
    }
  } catch (err) {
    // انقطاع الإنترنت لا يعني أن الرمز تالف — لا نعلن انتهاءه.
    result = {
      configured: true,
      valid: null,
      reason: "offline",
      message: "تعذر الاتصال بـ GitHub الآن (تحقق من الإنترنت). سيُعاد الفحص تلقائيًا.",
    };
  }

  if (!explicitToken && result.reason !== "offline") cachedCheck = { at: Date.now(), result };
  return result;
}

async function saveToken(raw) {
  const token = String(raw || "").trim();
  if (!looksLikeToken(token)) {
    throw new Error("هذا لا يبدو رمز GitHub صحيحًا. يبدأ الرمز عادة بـ github_pat_ أو ghp_");
  }
  const result = await checkToken({ token });
  if (result.reason === "offline") throw new Error(result.message);
  if (result.reason === "expired") throw new Error("هذا الرمز غير صحيح أو منتهي الصلاحية. تأكدي من نسخه كاملًا.");
  if (!result.valid) throw new Error(result.message);
  writeToken(token);
  cachedCheck = { at: Date.now(), result };
  return result;
}

module.exports = {
  git,
  redact,
  readToken,
  saveToken,
  clearToken,
  checkToken,
  repoSlug,
  authHeaderArgs,
  migrateLegacyRemote,
  TOKEN_FILE,
};
