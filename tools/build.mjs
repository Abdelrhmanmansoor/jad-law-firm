/**
 * التوليد المسبق (Pre-rendering) للموقع.
 *
 * الموقع تطبيق صفحة واحدة، وكانت محركات البحث ترى صفحة فارغة تمامًا.
 * هذا الملف ينفّذ script.js في بيئة Node بدون متصفح، ويولّد لكل مسار
 * ملف HTML كامل المحتوى تحت مساره الحقيقي، بالعربية والإنجليزية، مع
 * كل وسوم السيو والبيانات المنظمة، إضافة إلى sitemap.xml و 404.html.
 *
 *   node tools/build.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_FILE = path.join(ROOT, "index.template.html");
const OUT_ROOT = ROOT;

/* ────────────────────────────────────────────────────────────────────────────
   1. تشغيل script.js في بيئة بلا متصفح
   ──────────────────────────────────────────────────────────────────────────── */

/** عنصر DOM وهمي: يكفي لتمرير الكود الذي يسجّل المستمعات عند الإقلاع. */
function createStubElement(tagName = "div") {
  const element = {
    tagName,
    className: "",
    dataset: {},
    style: {},
    attributes: {},
    children: [],
    innerHTML: "",
    textContent: "",
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    hasAttribute(name) {
      return name in this.attributes;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceWith() {},
    remove() {},
    focus() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    matches: () => false,
  };
  return element;
}

function createSandbox() {
  const head = createStubElement("head");
  const document = {
    documentElement: createStubElement("html"),
    head,
    body: createStubElement("body"),
    createElement: (tag) => createStubElement(tag),
    createElementNS: (ns, tag) => createStubElement(tag),
    getElementById: () => createStubElement(),
    querySelector: () => createStubElement(),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  const storage = new Map();
  const sandbox = {
    console,
    document,
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: { pathname: "/", hash: "", search: "", origin: "https://jaadlegal.com" },
    history: { pushState() {}, replaceState() {} },
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    fetch: () => Promise.reject(new Error("fetch غير متاح أثناء البناء")),
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    alert() {},
    open() {},
    URL,
    JSON,
    Math,
    Date,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

const EPILOGUE = `
globalThis.__site = {
  applySiteData,
  parseRoute,
  routePath,
  routeUrl,
  seoFor,
  structuredDataFor,
  breadcrumbsFor,
  SEO_TEXT,
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  SITE_ORIGIN,
  STATIC_PAGES,
  content,
  renderPage(route, activeLang) {
    lang = activeLang;
    currentRoute = route;
    return pageMarkup(route);
  },
  collections() {
    return { practices, caseWins, blogPosts };
  },
};
`;

function loadSite() {
  let source = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

  // نقطع كود الإقلاع الخاص بالمتصفح (المحمّل المسبق وجلب البيانات) ونستبدله بالواجهة أعلاه.
  const bootAnchor = "const preloaderSafetyTimer";
  const cut = source.indexOf(bootAnchor);
  if (cut < 0) throw new Error("لم يُعثر على نقطة قطع كود الإقلاع في script.js");
  source = source.slice(0, cut) + EPILOGUE;

  const sandbox = createSandbox();
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "script.js" });

  const site = sandbox.__site;
  if (!site) throw new Error("فشل استخراج واجهة الموقع من script.js");

  const dataFile = path.join(ROOT, "data/site-data.json");
  if (fs.existsSync(dataFile)) {
    site.applySiteData(JSON.parse(fs.readFileSync(dataFile, "utf8")));
  }
  return site;
}

/* ────────────────────────────────────────────────────────────────────────────
   2. بناء ترويسة السيو لكل صفحة
   ──────────────────────────────────────────────────────────────────────────── */

const escapeAttr = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function seoHead(site, route, lang) {
  const { SITE_ORIGIN, SUPPORTED_LANGS, DEFAULT_LANG } = site;
  const meta = site.seoFor(route, lang);
  const canonical = site.routeUrl(route.page, route.id, lang);
  const siteName = (site.SEO_TEXT[lang] ?? site.SEO_TEXT[DEFAULT_LANG]).siteName;
  const shareImage = `${SITE_ORIGIN}/assets/og-cover.png`;
  const isError = route.page === "404";
  const jsonLd = JSON.stringify(site.structuredDataFor(route, lang), null, 2)
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n");

  const alternates = SUPPORTED_LANGS.map(
    (code) => `    <link rel="alternate" hreflang="${code}" href="${escapeAttr(site.routeUrl(route.page, route.id, code))}" />`,
  ).join("\n");

  return `    <title>${escapeAttr(meta.title)}</title>
    <meta name="description" content="${escapeAttr(meta.description)}" />
    <meta name="robots" content="${isError ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1"}" />
    <meta name="author" content="${escapeAttr(siteName)}" />

${isError ? "" : `    <link rel="canonical" href="${escapeAttr(canonical)}" />`}
${alternates}
    <link rel="alternate" hreflang="x-default" href="${escapeAttr(site.routeUrl(route.page, route.id, DEFAULT_LANG))}" />

    <meta property="og:type" content="${route.page === "article" ? "article" : "website"}" />
    <meta property="og:site_name" content="${escapeAttr(siteName)}" />
    <meta property="og:locale" content="${lang === "ar" ? "ar_SA" : "en_US"}" />
    <meta property="og:locale:alternate" content="${lang === "ar" ? "en_US" : "ar_SA"}" />
    <meta property="og:title" content="${escapeAttr(meta.title)}" />
    <meta property="og:description" content="${escapeAttr(meta.description)}" />
    <meta property="og:url" content="${escapeAttr(canonical)}" />
    <meta property="og:image" content="${shareImage}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeAttr(siteName)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeAttr(meta.title)}" />
    <meta name="twitter:description" content="${escapeAttr(meta.description)}" />
    <meta name="twitter:image" content="${shareImage}" />

    <script type="application/ld+json" id="structuredData">
${jsonLd}
    </script>`;
}

/* ────────────────────────────────────────────────────────────────────────────
   3. تكييف القالب المشترك حسب اللغة والمسار
   ──────────────────────────────────────────────────────────────────────────── */

/** يترجم نصوص الترويسة والتذييل الثابتة إلى اللغة المطلوبة. */
function localiseShell(html, site, lang) {
  const table = site.content[lang];
  if (!table) return html;
  return html.replace(
    /(<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>)([^<]*)(<\/\2>)/gi,
    (match, open, tag, key, text, close) => {
      const value = table[key];
      if (typeof value !== "string") return match;
      return `${open}${value}${close}`;
    },
  );
}

/** يعيد كتابة روابط التنقل لتحمل بادئة اللغة، ويعلّم الرابط النشط. */
function localiseLinks(html, site, route, lang) {
  const activePath = site.routePath(route.page, "", lang);
  return html.replace(
    /<a\b([^>]*\bdata-route="([^"]*)"[^>]*)>/gi,
    (match, attrs, page) => {
      const idMatch = attrs.match(/data-route-id="([^"]*)"/);
      const href = site.routePath(page, idMatch ? idMatch[1] : "", lang);
      let next = match.replace(/href="[^"]*"/, `href="${escapeAttr(href)}"`);
      next = next.replace(/\s*aria-current="[^"]*"/g, "");
      if (href === activePath) next = next.replace(/>$/, ' aria-current="page">');
      return next;
    },
  );
}

function buildPage(template, site, route, lang, appHtml) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  let html = template
    .replace("{{LANG}}", lang)
    .replace("{{DIR}}", dir)
    .replace("{{SEO_HEAD}}", seoHead(site, route, lang))
    .replace("{{APP}}", appHtml);
  html = localiseShell(html, site, lang);
  html = localiseLinks(html, site, route, lang);
  return html;
}

/* ────────────────────────────────────────────────────────────────────────────
   4. التوليد
   ──────────────────────────────────────────────────────────────────────────── */

function writePage(routePath, html) {
  const relative = routePath === "/" ? "index.html" : path.join(routePath.replace(/^\//, ""), "index.html");
  const target = path.join(OUT_ROOT, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");
  return relative.replace(/\\/g, "/");
}

const CHANGE_FREQ = {
  "": ["weekly", "1.0"],
  about: ["monthly", "0.8"],
  practices: ["monthly", "0.9"],
  practice: ["monthly", "0.8"],
  consulting: ["monthly", "0.8"],
  cases: ["weekly", "0.8"],
  case: ["monthly", "0.7"],
  blog: ["weekly", "0.8"],
  article: ["monthly", "0.6"],
  contact: ["yearly", "0.7"],
  privacy: ["yearly", "0.3"],
  terms: ["yearly", "0.3"],
};

function buildSitemap(site, routes) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = routes
    .map((route) => {
      const [changefreq, priority] = CHANGE_FREQ[route.page] ?? ["monthly", "0.5"];
      const alternates = site.SUPPORTED_LANGS.map(
        (code) =>
          `    <xhtml:link rel="alternate" hreflang="${code}" href="${escapeAttr(site.routeUrl(route.page, route.id, code))}" />`,
      ).join("\n");
      return site.SUPPORTED_LANGS.map(
        (code) => `  <url>
    <loc>${escapeAttr(site.routeUrl(route.page, route.id, code))}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${alternates}
    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeAttr(site.routeUrl(route.page, route.id, site.DEFAULT_LANG))}" />
  </url>`,
      ).join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries}
</urlset>
`;
}

function main() {
  if (!fs.existsSync(TEMPLATE_FILE)) {
    throw new Error("index.template.html غير موجود — لا يمكن توليد الصفحات.");
  }
  const template = fs.readFileSync(TEMPLATE_FILE, "utf8");
  const site = loadSite();
  const { practices, caseWins, blogPosts } = site.collections();

  const routes = [
    ...site.STATIC_PAGES.map((page) => ({ page, id: "" })),
    ...practices.map((item) => ({ page: "practice", id: item.id })),
    ...caseWins.map((item) => ({ page: "case", id: item.id })),
    ...blogPosts.map((item) => ({ page: "article", id: item.id })),
  ];

  let written = 0;
  for (const route of routes) {
    for (const lang of site.SUPPORTED_LANGS) {
      const appHtml = site.renderPage(route, lang);
      const html = buildPage(template, site, route, lang, appHtml);
      writePage(site.routePath(route.page, route.id, lang), html);
      written += 1;
    }
  }

  // صفحة 404: تستخدمها GitHub Pages كاحتياطي لأي مسار غير معروف،
  // فتُقلع منها واجهة الموقع وتعرض المسار الصحيح دون إعادة تحميل.
  const notFound = { page: "404", id: "" };
  fs.writeFileSync(
    path.join(OUT_ROOT, "404.html"),
    buildPage(template, site, notFound, site.DEFAULT_LANG, site.renderPage(notFound, site.DEFAULT_LANG)),
    "utf8",
  );

  fs.writeFileSync(path.join(OUT_ROOT, "sitemap.xml"), buildSitemap(site, routes), "utf8");

  console.log(`✓ ${written} صفحة ثابتة (${routes.length} مسار × ${site.SUPPORTED_LANGS.length} لغة)`);
  console.log("✓ 404.html");
  console.log(`✓ sitemap.xml — ${routes.length * site.SUPPORTED_LANGS.length} رابط`);
}

main();
