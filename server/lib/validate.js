function isNonEmptyString(value, maxLen = 5000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLen;
}

function isBilingual(value, maxLen = 5000) {
  return (
    value &&
    typeof value === "object" &&
    isNonEmptyString(value.ar, maxLen) &&
    isNonEmptyString(value.en, maxLen)
  );
}

// الحقول الاختيارية: تُقبل فارغة تمامًا (كانت سابقًا ترفض {ar:"", en:""}
// فيظهر خطأ "غير صالح" عند حفظ قضية بلا قيمة أو نتيجة).
function isBilingualOptional(value, maxLen = 5000) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const ok = (v) => v === undefined || (typeof v === "string" && v.length <= maxLen);
  return ok(value.ar) && ok(value.en);
}

function isSafeAssetPath(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string") return false;
  if (value.includes("..")) return false;
  if (!value.startsWith("assets/")) return false;
  return true;
}

function generateId(prefix = "item") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,60}$/.test(value);
}

/** معرّف مقروء للرابط من العنوان الإنجليزي: "Contract Dispute" → "contract-dispute". */
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

function splitLines(text) {
  if (!text) return [];
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

module.exports = {
  isNonEmptyString,
  isBilingual,
  isBilingualOptional,
  isSafeAssetPath,
  generateId,
  isValidId,
  splitLines,
  slugify,
};
