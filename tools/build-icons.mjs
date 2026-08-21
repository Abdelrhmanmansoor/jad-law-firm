/**
 * يبني مجموعة أيقونات مصغّرة من مكتبة lucide تحتوي فقط على الأيقونات المستخدمة
 * في الموقع، بدلاً من تحميل المكتبة كاملة (‎+370KB‎) على كل زيارة.
 * أي أيقونة غير موجودة في المجموعة يتم تحميلها تلقائيًا من الملف الكامل.
 *
 *   node tools/build-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lucide = require(path.join(ROOT, "assets/vendor/lucide.min.js"));

/** أيقونات إضافية شائعة حتى لو لم تُستخدم بعد، لتغطية ما يضيفه المحرر من لوحة التحكم. */
const SAFETY_LIST = [
  "scale", "gavel", "landmark", "shield-alert", "shield-check", "briefcase",
  "briefcase-business", "building", "building-2", "file-text", "file-check-2",
  "file-signature", "file-search", "book-open", "users", "user-check", "handshake",
  "badge-dollar-sign", "banknote", "home", "key-round", "award", "lock", "mail",
  "phone", "map-pin", "clock", "arrow-up-left", "arrow-left", "arrow-right",
  "check", "chevron-left", "chevron-right", "external-link", "message-circle",
];

const SOURCES = ["script.js", "index.html", "styles.css"];

const names = new Set(SAFETY_LIST);

for (const file of SOURCES) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, "utf8");
  for (const m of text.matchAll(/data-lucide="([a-z0-9-]+)"/g)) names.add(m[1]);
  for (const m of text.matchAll(/\bicon\(\s*"([a-z0-9-]+)"/g)) names.add(m[1]);
  for (const m of text.matchAll(/\bicon:\s*"([a-z0-9-]+)"/g)) names.add(m[1]);
}

const dataFile = path.join(ROOT, "data/site-data.json");
if (fs.existsSync(dataFile)) {
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  for (const item of data.practices ?? []) if (item?.icon) names.add(item.icon);
}

const pascal = (kebab) => kebab.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");

const icons = {};
const missing = [];
for (const name of [...names].sort()) {
  const node = lucide[pascal(name)];
  if (!node) { missing.push(name); continue; }
  icons[name] = node;
}

const banner = `/* أيقونات lucide مُصغّرة للموقع - مبنية آليًا عبر tools/build-icons.mjs. لا تُعدّل يدويًا. */`;

const output = `${banner}
(function () {
  "use strict";
  var ATTRS = {
    xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24,
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round"
  };
  var ICONS = ${JSON.stringify(icons)};
  var fullLibraryPromise = null;

  function loadFullLibrary() {
    if (fullLibraryPromise) return fullLibraryPromise;
    fullLibraryPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = "/assets/vendor/lucide.min.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return fullLibraryPromise;
  }

  function buildSvg(nodes) {
    var svg = document.createElementNS(ATTRS.xmlns, "svg");
    Object.keys(ATTRS).forEach(function (key) {
      if (key !== "xmlns") svg.setAttribute(key, String(ATTRS[key]));
    });
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    nodes.forEach(function (node) {
      var el = document.createElementNS(ATTRS.xmlns, node[0]);
      Object.keys(node[1] || {}).forEach(function (key) {
        el.setAttribute(key, String(node[1][key]));
      });
      svg.appendChild(el);
    });
    return svg;
  }

  function createIcons() {
    var pending = [];
    document.querySelectorAll("[data-lucide]").forEach(function (host) {
      var name = host.getAttribute("data-lucide");
      var nodes = ICONS[name];
      if (!nodes) { pending.push(name); return; }
      var svg = buildSvg(nodes);
      if (host.className) svg.setAttribute("class", host.className);
      host.replaceWith(svg);
    });
    if (pending.length) {
      loadFullLibrary().then(function () {
        if (window.lucide && window.lucide.createIcons !== createIcons) window.lucide.createIcons();
      }).catch(function () { /* تجاهل: الأيقونة الناقصة لا توقف الصفحة */ });
    }
  }

  window.lucide = window.lucide || {};
  window.lucide.createIcons = window.lucide.createIcons || createIcons;
  window.lucide.icons = ICONS;
})();
`;

fs.writeFileSync(path.join(ROOT, "assets/vendor/icons.js"), output, "utf8");
console.log(`✓ assets/vendor/icons.js — ${Object.keys(icons).length} أيقونة (${(output.length / 1024).toFixed(1)}KB)`);
if (missing.length) console.warn(`! أسماء غير معروفة في lucide: ${missing.join(", ")}`);
