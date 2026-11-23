/* ==========================================================================
   لوحة تحكم جاد العبدالله — v2
   ========================================================================== */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const TZ = "Asia/Riyadh";
const SUPPORT_WHATSAPP = "201007835547";

const state = {
  data: null,
  status: null,
  view: "overview",
  search: { practices: "", cases: "", blog: "" },
  drawer: null, // { collection, item, snapshot }
};

/* ---------------- helpers ---------------- */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const icon = (name) => `<svg class="i"><use href="#i-${name}"/></svg>`;

async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  let res;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: isForm ? undefined : { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new Error("تعذر الاتصال بلوحة التحكم. تأكدي أن نافذة التشغيل السوداء ما زالت مفتوحة.");
  }
  if (res.status === 401) {
    window.removeEventListener("beforeunload", beforeUnload);
    window.location.href = "/admin/login.html";
    throw new Error("انتهت الجلسة، يرجى تسجيل الدخول.");
  }
  let result;
  try {
    result = await res.json();
  } catch {
    throw new Error(`استجابة غير متوقعة من الخادم (${res.status}).`);
  }
  if (!result.ok) {
    const err = new Error(result.error || "حدث خطأ غير متوقع.");
    err.result = result;
    throw err;
  }
  return result;
}

function toast(message, type = "ok", ms = 3600) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-ic">${icon(type === "ok" ? "check" : "x")}</span><span>${esc(message)}</span>`;
  $("#toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, ms);
}

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.html = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span><span>${esc(label || "جارٍ الحفظ…")}</span>`;
  } else {
    btn.disabled = false;
    if (btn.dataset.html) btn.innerHTML = btn.dataset.html;
  }
}

/* promise-based confirm dialog */
function confirmBox({ title, text, yes = "تأكيد", danger = true }) {
  return new Promise((resolve) => {
    const dlg = $("#confirmDialog");
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    const yesBtn = $("#confirmYes");
    yesBtn.textContent = yes;
    yesBtn.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
    const scrim = $("#scrim");
    const drawerOpen = $("#drawer").classList.contains("show");
    scrim.classList.add("show");
    scrim.style.zIndex = "78";
    dlg.classList.add("show");
    const done = (val) => {
      dlg.classList.remove("show");
      scrim.style.zIndex = "";
      if (!drawerOpen) scrim.classList.remove("show");
      yesBtn.onclick = null;
      $("#confirmNo").onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        done(false);
      }
    };
    document.addEventListener("keydown", onKey, true);
    yesBtn.onclick = () => done(true);
    $("#confirmNo").onclick = () => done(false);
    setTimeout(() => yesBtn.focus(), 50);
  });
}

/* ---------------- date & time (Riyadh) ---------------- */
const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
const fmtDay = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: TZ, weekday: "long" });
const fmtGreg = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const fmtHijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" });
const fmtFull = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: TZ, day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });
const fmtHour = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false });
const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

function tickClock() {
  const now = new Date();
  const parts = Object.fromEntries(fmtTime.formatToParts(now).map((p) => [p.type, p.value]));
  const period = /pm/i.test(parts.dayPeriod || "") ? "م" : "ص";
  $("#clockTime").innerHTML = `${parts.hour}:${parts.minute}<span class="sec">:${parts.second}</span> <span class="sec">${period}</span>`;
  $("#clockDay").textContent = fmtDay.format(now);
  $("#clockDate").textContent = `${fmtGreg.format(now)} · ${fmtHijri.format(now)}`;
}

function greeting() {
  const h = Number(fmtHour.format(new Date()));
  if (h >= 4 && h < 12) return "صباح الخير";
  if (h >= 12 && h < 17) return "مساء الخير";
  return "مساء النور";
}

function relativeTime(iso) {
  if (!iso) return "—";
  const diff = (new Date(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return "الآن";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtFull.format(new Date(iso));
}

/* ---------------- bilingual fields ---------------- */
function biHtml(id, { multiline = false, rows = 3, required = false, placeholder = {} } = {}) {
  const tag = multiline ? "textarea" : "input";
  const cell = (lang) => {
    const attrs = `id="${id}_${lang}" data-key="${id}" data-lang="${lang}" ${lang === "en" ? 'dir="ltr"' : ""} ${required ? "data-required" : ""} placeholder="${esc(placeholder[lang] || (lang === "ar" ? "بالعربية" : "In English"))}"`;
    const control = multiline ? `<textarea ${attrs} rows="${rows}"></textarea>` : `<input type="text" ${attrs} />`;
    return `<div class="bi-cell" data-lang="${lang}"><span class="lang">${lang === "ar" ? "ع" : "EN"}</span>${control}</div>`;
  };
  return `<div class="bi field" style="margin-bottom:0">${cell("ar")}${cell("en")}</div>`;
}

function fieldBlock(label, hint, inner) {
  return `<div class="field"><span class="field-label">${esc(label)}</span>${hint ? `<span class="hint" style="margin-top:-4px">${esc(hint)}</span>` : ""}${inner}</div>`;
}

const getBi = (root, id) => ({ ar: $(`#${id}_ar`, root).value.trim(), en: $(`#${id}_en`, root).value.trim() });
function setBi(root, id, value) {
  $(`#${id}_ar`, root).value = value?.ar || "";
  $(`#${id}_en`, root).value = value?.en || "";
}

/* ==========================================================================
   Navigation
   ========================================================================== */
const VIEWS = ["overview", "contact", "texts", "practices", "cases", "blog", "settings"];

async function go(view, { force = false } = {}) {
  if (!VIEWS.includes(view)) view = "overview";
  if (!force && view !== state.view && pageForm.isDirty()) {
    const leave = await confirmBox({ title: "تعديلات غير محفوظة", text: "لم تحفظي تعديلاتك في هذه الصفحة. هل تريدين تركها بدون حفظ؟", yes: "ترك بدون حفظ" });
    if (!leave) return;
    pageForm.reset();
  }
  state.view = view;
  $$(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
  $$(".view").forEach((v) => v.classList.remove("active"));
  const el = $(`#view-${view}`);
  void el.offsetWidth; // إعادة تشغيل حركة الدخول
  el.classList.add("active");
  $("#pageTitle").textContent = el.dataset.title;
  $("#pageSub").textContent = el.dataset.sub;
  document.title = `${el.dataset.title} — لوحة التحكم`;
  document.body.classList.remove("nav-open");
  if (location.hash.slice(1) !== view) history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0 });
  pageForm.bind(view);
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-view], [data-goto]");
  if (nav && !nav.closest("form")) {
    e.preventDefault();
    if ($("#publishDialog").classList.contains("show")) closePublish();
    go(nav.dataset.view || nav.dataset.goto);
  }
});
$("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1);
  if (VIEWS.includes(v) && v !== state.view) go(v);
});

/* ==========================================================================
   Page forms (contact / texts) with save bar
   ========================================================================== */
const TEXT_FIELDS = [
  { key: "heroKicker", label: "شعار الصفحة الرئيسية", hint: "السطر الصغير أعلى العنوان الرئيسي" },
  { key: "heroLead", label: "مقدمة الصفحة الرئيسية", hint: "الفقرة أسفل العنوان الرئيسي", multiline: true },
  { key: "aboutLead", label: "مقدمة صفحة «من نحن»", multiline: true },
  { key: "aboutBody", label: "نص إضافي في «من نحن»", multiline: true, rows: 5 },
  { key: "founderRole", label: "المسمى الوظيفي لقيادة المكتب" },
  { key: "founderCaption", label: "وصف مختصر لقيادة المكتب" },
  { key: "footerText", label: "نص أسفل الموقع (الفوتر)", multiline: true },
];

$("#textsFields").innerHTML = TEXT_FIELDS.map(
  (f) => `<div class="section-block"><h4>${esc(f.label)}</h4>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : '<span class="hint"></span>'}${biHtml(`t_${f.key}`, { multiline: f.multiline, rows: f.rows || 3, required: true })}</div>`,
).join("");
$$("[data-bi]").forEach((holder) => {
  holder.outerHTML = biHtml(holder.dataset.bi, { multiline: holder.dataset.multiline === "1", rows: 2, required: true });
});

const PAGE_FORMS = {
  contact: {
    form: "#contactForm",
    fill(d) {
      const c = d.contact || {};
      $("#c_phone").value = c.phone || "";
      $("#c_whatsapp").value = c.whatsapp || "";
      $("#c_email").value = c.email || "";
      setBi(document, "c_address", c.address);
      setBi(document, "c_hours", c.hours);
    },
    read() {
      return {
        phone: $("#c_phone").value.trim(),
        whatsapp: $("#c_whatsapp").value.trim().replace(/[^\d]/g, ""),
        email: $("#c_email").value.trim(),
        address: getBi(document, "c_address"),
        hours: getBi(document, "c_hours"),
      };
    },
    url: "/api/data/contact",
    done: "تم حفظ بيانات التواصل",
  },
  texts: {
    form: "#textsForm",
    fill(d) {
      const t = d.texts || {};
      TEXT_FIELDS.forEach((f) => setBi(document, `t_${f.key}`, t[f.key]));
    },
    read() {
      const body = {};
      TEXT_FIELDS.forEach((f) => (body[f.key] = getBi(document, `t_${f.key}`)));
      return body;
    },
    url: "/api/data/texts",
    done: "تم حفظ النصوص",
  },
};

const pageForm = {
  current: null,
  snapshot: "",
  bind(view) {
    this.current = PAGE_FORMS[view] || null;
    if (this.current && state.data) {
      this.current.fill(state.data);
      clearInvalid($(this.current.form));
      this.snapshot = JSON.stringify(this.current.read());
    }
    this.update();
  },
  isDirty() {
    return Boolean(this.current && state.data && JSON.stringify(this.current.read()) !== this.snapshot);
  },
  update() {
    $("#savebar").classList.toggle("show", this.isDirty());
  },
  reset() {
    if (this.current && state.data) this.current.fill(state.data);
    this.update();
  },
  async save() {
    if (!this.current || !this.isDirty()) return;
    const formEl = $(this.current.form);
    if (!validateRequired(formEl)) {
      toast("يرجى تعبئة الحقول المطلوبة المظللة باللون الأحمر.", "err");
      return;
    }
    const btn = $("#saveBtn");
    setBusy(btn, true, "حفظ…");
    try {
      await api(this.current.url, { method: "PUT", body: JSON.stringify(this.current.read()) });
      await reloadData();
      this.snapshot = JSON.stringify(this.current.read());
      toast(`${this.current.done} — لا تنسي النشر`);
      refreshStatus();
    } catch (err) {
      toast(err.message, "err", 6000);
    } finally {
      setBusy(btn, false);
      this.update();
    }
  },
};

["#contactForm", "#textsForm"].forEach((sel) => {
  $(sel).addEventListener("input", (e) => {
    e.target.classList?.remove("invalid");
    pageForm.update();
  });
  $(sel).addEventListener("submit", (e) => {
    e.preventDefault();
    pageForm.save();
  });
});
$("#saveBtn").addEventListener("click", () => pageForm.save());
$("#discardBtn").addEventListener("click", () => pageForm.reset());

function clearInvalid(root) {
  $$(".invalid", root).forEach((el) => {
    el.classList.remove("invalid");
    el.style.borderColor = "";
  });
}
function validateRequired(root) {
  let first = null;
  $$("[data-required], [required]", root).forEach((el) => {
    const empty = !String(el.value || "").trim();
    el.classList.toggle("invalid", empty);
    el.style.borderColor = empty ? "var(--red)" : "";
    if (empty && !first) first = el;
  });
  if (first) {
    first.scrollIntoView({ block: "center", behavior: "smooth" });
    first.focus({ preventScroll: true });
  }
  return !first;
}

/* ==========================================================================
   Collections (practices / cases / blog)
   ========================================================================== */
const COLLECTIONS = {
  practices: {
    noun: "خدمة",
    add: "إضافة خدمة",
    icon: "scale",
    fields: [
      { key: "title", label: "اسم الخدمة", required: true },
      { key: "subtitle", label: "وصف مختصر", hint: "سطر واحد يظهر تحت الاسم في البطاقة", required: true },
      { key: "desc", label: "الوصف التفصيلي", multiline: true, rows: 4, required: true },
      { key: "services", label: "الخدمات الفرعية", hint: "اكتبي كل خدمة في سطر مستقل", multiline: true, rows: 6, lines: true },
    ],
    extra: (item) =>
      fieldBlock("الأيقونة", "اسم أيقونة من مكتبة lucide.dev (اختياري)", `<input type="text" id="f_icon" dir="ltr" value="${esc(item?.icon || "briefcase-business")}" />`),
    readExtra: (form) => ({ icon: $("#f_icon", form).value.trim() }),
    toBody(values) {
      return { ...values, servicesAr: values.services.ar, servicesEn: values.services.en, services: undefined };
    },
    card: (item) => ({ tag: null, title: item.title?.ar, sub: item.subtitle?.ar, foot: `${(item.services?.ar || []).length} خدمة فرعية` }),
    searchText: (i) => `${i.title?.ar} ${i.title?.en} ${i.subtitle?.ar}`,
  },
  cases: {
    noun: "قضية",
    add: "إضافة قضية",
    icon: "folder",
    fields: [
      { key: "title", label: "عنوان القضية", required: true },
      { key: "category", label: "التصنيف", hint: "مثال: تجاري، تنفيذ، عقاري", required: true },
      { key: "amount", label: "القيمة / نوع الملف", hint: "اختياري" },
      { key: "result", label: "النتيجة", hint: "اختياري — مثال: كسب الدعوى" },
      { key: "summary", label: "ملخص القضية", multiline: true, rows: 4, required: true },
      { key: "challenge", label: "التحدي القانوني", hint: "اختياري", multiline: true },
      { key: "action", label: "الإجراء المتخذ", hint: "اختياري", multiline: true },
    ],
    extra: (item) => `
      ${fieldBlock("صورة القضية", "اختياري — jpg أو png أو webp حتى 5 ميجابايت", dropHtml("image", item?.image))}
      ${fieldBlock("ملف القضية (PDF)", "اختياري — حتى 15 ميجابايت", dropHtml("file", item?.file))}`,
    readExtra: (form) => ({ image: $("#f_image", form).value, file: $("#f_file", form).value }),
    card: (item) => ({ media: item.image, tag: item.category?.ar, title: item.title?.ar, sub: item.summary?.ar, foot: item.result?.ar || item.amount?.ar || "" }),
    searchText: (i) => `${i.title?.ar} ${i.title?.en} ${i.category?.ar} ${i.summary?.ar}`,
  },
  blog: {
    noun: "مقالة",
    add: "إضافة مقالة",
    icon: "pen",
    fields: [
      { key: "title", label: "عنوان المقالة", required: true },
      { key: "category", label: "التصنيف", required: true },
      { key: "summary", label: "نص المقالة", multiline: true, rows: 8, required: true },
    ],
    card: (item) => ({ tag: item.category?.ar, title: item.title?.ar, sub: item.summary?.ar, foot: "" }),
    searchText: (i) => `${i.title?.ar} ${i.title?.en} ${i.category?.ar} ${i.summary?.ar}`,
  },
};

function renderCounts() {
  if (!state.data) return;
  ["practices", "cases", "blog"].forEach((k) => {
    $$(`[data-count="${k}"]`).forEach((el) => (el.textContent = (state.data[k] || []).length));
  });
}

function renderList(key) {
  const cfg = COLLECTIONS[key];
  const holder = $(`#list-${key}`);
  if (!state.data) {
    holder.innerHTML = '<div class="skeleton"></div>'.repeat(3);
    return;
  }
  const q = state.search[key].trim().toLowerCase();
  const items = (state.data[key] || []).filter((i) => !q || cfg.searchText(i).toLowerCase().includes(q));
  const add = q ? "" : `<button class="item add" data-add="${key}"><span class="plus">${icon("plus")}</span>${esc(cfg.add)}</button>`;
  holder.innerHTML =
    add +
    items
      .map((item) => {
        const c = cfg.card(item);
        const media = c.media ? `<div class="item-media" style="background-image:url('/${esc(c.media)}')"></div>` : "";
        return `<button class="item" data-edit="${esc(item.id)}" data-col="${key}">
          ${media}
          <div class="item-body">
            ${c.tag ? `<span class="item-tag">${esc(c.tag)}</span>` : ""}
            <div class="item-title">${esc(c.title)}</div>
            <div class="item-sub">${esc(c.sub)}</div>
            <div class="item-foot">${esc(c.foot)}<span class="edit">${icon("pen")}تعديل</span></div>
          </div>
        </button>`;
      })
      .join("") +
    (q && !items.length ? `<div class="empty">لا توجد نتائج لـ «${esc(q)}»</div>` : "");
  holder.classList.remove("stagger");
  void holder.offsetWidth;
  holder.classList.add("stagger");
}

function renderAll() {
  renderCounts();
  Object.keys(COLLECTIONS).forEach(renderList);
  renderOverview();
}

document.addEventListener("click", (e) => {
  const addBtn = e.target.closest("[data-add]");
  if (addBtn) return openDrawer(addBtn.dataset.add, null);
  const editBtn = e.target.closest("[data-edit]");
  if (editBtn) {
    const item = (state.data[editBtn.dataset.col] || []).find((i) => i.id === editBtn.dataset.edit);
    if (item) openDrawer(editBtn.dataset.col, item);
  }
  const quick = e.target.closest("[data-quick]");
  if (quick) {
    const col = { case: "cases", blog: "blog", practice: "practices" }[quick.dataset.quick];
    go(col).then(() => openDrawer(col, null));
  }
});

$$("[data-search]").forEach((input) =>
  input.addEventListener("input", () => {
    state.search[input.dataset.search] = input.value;
    renderList(input.dataset.search);
  }),
);

/* ---------------- uploads ---------------- */
function dropHtml(kind, value) {
  const isImg = kind === "image";
  return `<label class="drop" data-drop="${kind}">
    <input type="file" accept="${isImg ? "image/jpeg,image/png,image/webp" : "application/pdf"}" />
    <span class="thumb" id="f_${kind}_thumb"></span>
    <span class="d-text"><b id="f_${kind}_name"></b><span id="f_${kind}_hint"></span></span>
    <button type="button" class="btn btn-sm btn-ghost remove" id="f_${kind}_remove" style="display:none">${icon("x")}إزالة</button>
    <input type="hidden" id="f_${kind}" value="${esc(value || "")}" />
  </label>`;
}

function paintDrop(form, kind) {
  const value = $(`#f_${kind}`, form).value;
  const thumb = $(`#f_${kind}_thumb`, form);
  const isImg = kind === "image";
  thumb.style.backgroundImage = value && isImg ? `url('/${value}')` : "";
  thumb.innerHTML = value && isImg ? "" : icon(isImg ? "image" : "file");
  $(`#f_${kind}_name`, form).textContent = value ? decodeURIComponent(value.split("/").pop()) : isImg ? "اسحبي صورة هنا أو اضغطي للاختيار" : "اسحبي ملف PDF هنا أو اضغطي للاختيار";
  $(`#f_${kind}_hint`, form).textContent = value ? "اضغطي لاستبداله" : isImg ? "JPG · PNG · WEBP" : "PDF";
  $(`#f_${kind}_remove`, form).style.display = value ? "" : "none";
}

function wireDrops(form) {
  $$("[data-drop]", form).forEach((zone) => {
    const kind = zone.dataset.drop;
    const fileInput = $('input[type="file"]', zone);
    paintDrop(form, kind);
    const handle = async (file) => {
      if (!file) return;
      const fd = new FormData();
      fd.append(kind === "image" ? "image" : "document", file);
      $(`#f_${kind}_name`, form).textContent = "جارٍ الرفع…";
      try {
        const { path } = await api(kind === "image" ? "/api/upload" : "/api/upload-doc", { method: "POST", body: fd });
        $(`#f_${kind}`, form).value = path;
        toast(kind === "image" ? "تم رفع الصورة" : "تم رفع الملف");
      } catch (err) {
        toast(err.message, "err", 6000);
      }
      paintDrop(form, kind);
      fileInput.value = "";
    };
    fileInput.addEventListener("change", () => handle(fileInput.files[0]));
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("over");
      handle(e.dataTransfer.files[0]);
    });
    $(`#f_${kind}_remove`, form).addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      $(`#f_${kind}`, form).value = "";
      paintDrop(form, kind);
    });
  });
}

/* ---------------- drawer ---------------- */
const drawerForm = $("#drawerForm");

function readDrawer() {
  const { collection } = state.drawer;
  const cfg = COLLECTIONS[collection];
  const values = {};
  cfg.fields.forEach((f) => (values[f.key] = getBi(drawerForm, `f_${f.key}`)));
  Object.assign(values, cfg.readExtra ? cfg.readExtra(drawerForm) : {});
  return values;
}

function openDrawer(collection, item) {
  const cfg = COLLECTIONS[collection];
  state.drawer = { collection, item };
  $("#drawerTitle").textContent = item ? `تعديل ${cfg.noun}` : cfg.add;
  $("#drawerSub").textContent = item ? item.title?.ar || "" : "املئي الحقول باللغتين ثم اضغطي حفظ";
  $("#drawerIcon").innerHTML = icon(cfg.icon);
  $("#drawerDelete").style.display = item ? "" : "none";
  drawerForm.innerHTML =
    `<div class="form-error" id="drawerError">${icon("alert")}<span></span></div>` +
    cfg.fields
      .map((f) =>
        fieldBlock(
          f.label + (f.required ? " *" : ""),
          f.hint,
          biHtml(`f_${f.key}`, { multiline: f.multiline, rows: f.rows || 3, required: f.required }),
        ),
      )
      .join("") +
    (cfg.extra ? cfg.extra(item) : "");
  cfg.fields.forEach((f) => {
    const v = item?.[f.key];
    setBi(drawerForm, `f_${f.key}`, f.lines ? { ar: (v?.ar || []).join("\n"), en: (v?.en || []).join("\n") } : v);
  });
  wireDrops(drawerForm);
  state.drawer.snapshot = JSON.stringify(readDrawer());
  $("#scrim").classList.add("show");
  $("#drawer").classList.add("show");
  drawerForm.scrollTop = 0;
  setTimeout(() => $("input, textarea", drawerForm)?.focus({ preventScroll: true }), 350);
}

async function closeDrawer(force = false) {
  if (!state.drawer) return;
  if (!force && JSON.stringify(readDrawer()) !== state.drawer.snapshot) {
    const leave = await confirmBox({ title: "إغلاق بدون حفظ؟", text: "لديك تعديلات لم تُحفظ في هذا النموذج.", yes: "إغلاق بدون حفظ" });
    if (!leave) return;
  }
  $("#drawer").classList.remove("show");
  $("#scrim").classList.remove("show");
  state.drawer = null;
}

function drawerError(message) {
  const box = $("#drawerError");
  if (!box) return;
  if (!message) return box.classList.remove("show");
  $("span", box).textContent = message;
  box.classList.remove("show");
  void box.offsetWidth;
  box.classList.add("show");
  drawerForm.scrollTo({ top: 0, behavior: "smooth" });
}

drawerForm.addEventListener("input", (e) => {
  if (e.target.classList?.contains("invalid")) {
    e.target.classList.remove("invalid");
    e.target.style.borderColor = "";
  }
});

// مستمع واحد دائم — النسخة القديمة كانت تستخدم {once:true} فإذا فشل الحفظ مرة
// كان الضغط الثاني يعيد تحميل الصفحة ويضيع كل ما كُتب.
drawerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.drawer) return;
  drawerError(null);
  if (!validateRequired(drawerForm)) {
    drawerError("يرجى تعبئة الحقول المطلوبة (*) باللغتين العربية والإنجليزية.");
    return;
  }
  const { collection, item } = state.drawer;
  const cfg = COLLECTIONS[collection];
  const values = readDrawer();
  const body = cfg.toBody ? cfg.toBody(values) : values;
  const btn = $("#drawerSave");
  setBusy(btn, true);
  try {
    if (item) await api(`/api/data/${collection}/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify(body) });
    else await api(`/api/data/${collection}`, { method: "POST", body: JSON.stringify(body) });
    await reloadData();
    closeDrawer(true);
    toast(item ? "تم حفظ التعديلات — لا تنسي النشر" : `تمت إضافة ال${cfg.noun} — لا تنسي النشر`);
    refreshStatus();
  } catch (err) {
    drawerError(err.message);
  } finally {
    setBusy(btn, false);
  }
});

$("#drawerDelete").addEventListener("click", async () => {
  if (!state.drawer?.item) return;
  const { collection, item } = state.drawer;
  const cfg = COLLECTIONS[collection];
  const yes = await confirmBox({ title: `حذف ال${cfg.noun}`, text: `سيتم حذف «${item.title?.ar}» من الموقع عند النشر القادم. يوجد نسخة احتياطية تلقائية.`, yes: "حذف" });
  if (!yes) return;
  try {
    await api(`/api/data/${collection}/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await reloadData();
    closeDrawer(true);
    toast("تم الحذف — لا تنسي النشر");
    refreshStatus();
  } catch (err) {
    drawerError(err.message);
  }
});

$("#drawerClose").addEventListener("click", () => closeDrawer());
$("#drawerCancel").addEventListener("click", () => closeDrawer());
$("#scrim").addEventListener("click", () => {
  if ($("#confirmDialog").classList.contains("show")) return;
  if ($("#publishDialog").classList.contains("show")) return closePublish();
  closeDrawer();
});

/* ==========================================================================
   Status (GitHub connection + pending changes)
   ========================================================================== */
function expiryText(t) {
  if (!t || !t.configured) return "—";
  if (t.neverExpires) return "بدون تاريخ انتهاء ✓";
  if (t.expiresAt) {
    const left = t.daysLeft;
    return `حتى ${fmtGreg.format(new Date(t.expiresAt))}${left != null ? ` · متبقي ${left} يوم` : ""}`;
  }
  return "—";
}

function connInfo(t) {
  if (!t) return { dot: "", text: "جارٍ الفحص…", sub: "GitHub" };
  if (!t.configured) return { dot: "err", text: "النشر غير مربوط", sub: "اضغطي للربط" };
  if (t.reason === "offline") return { dot: "warn", text: "لا يوجد إنترنت", sub: "سيُعاد الفحص تلقائيًا" };
  if (!t.valid) return { dot: "err", text: "الربط متوقف", sub: "اضغطي للإصلاح" };
  if (t.daysLeft != null && t.daysLeft <= 14) return { dot: "warn", text: "النشر متصل", sub: `الرمز ينتهي خلال ${t.daysLeft} يوم` };
  return { dot: "ok", text: "النشر متصل", sub: "GitHub · يعمل" };
}

function renderStatus() {
  const s = state.status;
  const t = s?.token;
  const info = connInfo(t);
  ["#connDot", "#ovDot", "#ghDot"].forEach((sel) => ($(sel).className = `dot ${info.dot}`));
  $("#connText").textContent = info.text;
  $("#connSub").textContent = info.sub;
  $("#ovConn").textContent = info.text;
  $("#ghState").textContent = t ? t.message : "…";
  $("#ovExpiry").textContent = expiryText(t);
  $("#ghExpiry").textContent = expiryText(t);
  $("#ghRepo").textContent = t?.repo || "Abdelrhmanmansoor/jad-law-firm";
  $("#ovLast").textContent = s?.lastPublish ? relativeTime(s.lastPublish.at) : "—";

  const pending = s?.pending || 0;
  $("#pendingBadge").textContent = pending > 99 ? "99+" : pending;
  $("#publishBtn").classList.toggle("has-pending", pending > 0);
  $("#statPending").textContent = pending;

  const banner = $("#tokenBanner");
  const broken = t && t.reason !== "offline" && !t.valid;
  const expiring = t && t.valid && t.daysLeft != null && t.daysLeft <= 14;
  banner.classList.toggle("show", Boolean((broken || expiring) && state.view !== "settings"));
  banner.className = `banner ${broken ? "err" : "warn"} ${(broken || expiring) && state.view !== "settings" ? "show" : ""}`;
  $("#tokenBannerTitle").textContent = broken ? "النشر متوقف حاليًا" : `رمز الربط ينتهي خلال ${t?.daysLeft} يوم`;
  $("#tokenBannerText").textContent = broken ? `${t.message} تعديلاتك محفوظة ولن تضيع.` : "جدّدي الرمز من الإعدادات قبل انتهائه حتى لا يتوقف النشر.";
}

async function refreshStatus(force = false) {
  try {
    const s = await api(`/api/status${force ? "?force=1" : ""}`);
    state.status = s;
    renderStatus();
  } catch {
    /* status is best-effort */
  }
}

function renderOverview() {
  const name = $("#whoami").textContent;
  $("#hello").innerHTML = `${greeting()}، <span>${esc(name && name !== "…" ? name : "")}</span>`;
  $("#helloDate").textContent = `${fmtDay.format(new Date())} · ${fmtGreg.format(new Date())}`;
}

/* ==========================================================================
   Publish
   ========================================================================== */
let publishTimer = null;

function setStep(name, cls) {
  const li = $(`#publishSteps [data-step="${name}"]`);
  li.className = cls || "";
  $(".s-ic", li).innerHTML = cls === "done" ? icon("check") : cls === "fail" ? icon("x") : "";
}

function closePublish() {
  if ($("#publishClose").disabled) return;
  $("#publishDialog").classList.remove("show");
  if (!$("#drawer").classList.contains("show")) $("#scrim").classList.remove("show");
}

async function publish() {
  if (pageForm.isDirty()) {
    const saveFirst = await confirmBox({ title: "تعديلات غير محفوظة", text: "في هذه الصفحة تعديلات لم تُحفظ بعد. سيتم حفظها أولًا ثم نشرها.", yes: "حفظ ونشر", danger: false });
    if (!saveFirst) return;
    await pageForm.save();
    if (pageForm.isDirty()) return;
  }
  const dlg = $("#publishDialog");
  const steps = ["check", "build", "sync", "push"];
  steps.forEach((s) => setStep(s, ""));
  $("#publishTitle").textContent = "جارٍ نشر التعديلات";
  $("#publishText").textContent = "لا تغلقي الصفحة، يستغرق الأمر بضع ثوانٍ…";
  $("#publishResult").className = "publish-result";
  $("#publishBurst").classList.remove("show");
  $("#publishFix").style.display = "none";
  $("#publishView").style.display = "none";
  $("#publishClose").disabled = true;
  $("#scrim").classList.add("show");
  dlg.classList.add("show");

  let idx = 0;
  setStep(steps[0], "run");
  publishTimer = setInterval(() => {
    if (idx < steps.length - 1) {
      setStep(steps[idx], "done");
      idx += 1;
      setStep(steps[idx], "run");
    }
  }, 1300);

  let result;
  try {
    const res = await fetch("/api/publish", { method: "POST", credentials: "same-origin" });
    result = await res.json();
  } catch {
    result = { ok: false, code: "offline", error: "تعذر الاتصال بلوحة التحكم. تأكدي أن نافذة التشغيل مفتوحة." };
  }
  clearInterval(publishTimer);

  const box = $("#publishResult");
  if (result.ok) {
    steps.forEach((s) => setStep(s, "done"));
    $("#publishBurst").classList.add("show");
    if (result.noChanges) {
      $("#publishTitle").textContent = "الموقع محدَّث بالفعل";
      $("#publishText").textContent = "لا توجد تعديلات جديدة لنشرها.";
    } else {
      $("#publishTitle").textContent = "تم النشر بنجاح";
      $("#publishText").textContent = "ستظهر التعديلات على الموقع خلال دقيقة تقريبًا.";
      $("#publishView").style.display = "";
    }
  } else {
    const failAt = { token: "check", offline: "check", busy: "check", git: idx >= 2 ? steps[idx] : "sync" }[result.code] || steps[idx];
    const failIdx = steps.indexOf(failAt);
    steps.forEach((s, i) => setStep(s, i < failIdx ? "done" : i === failIdx ? "fail" : ""));
    $("#publishTitle").textContent = "لم يكتمل النشر";
    $("#publishText").textContent = "تعديلاتك محفوظة على هذا الجهاز ولن تضيع.";
    box.className = "publish-result err show";
    box.textContent = result.error || "حدث خطأ غير متوقع.";
    if (result.code === "token") $("#publishFix").style.display = "";
  }
  $("#publishClose").disabled = false;
  $("#publishClose").focus();
  refreshStatus(true);
}

$("#publishBtn").addEventListener("click", publish);
$("[data-action='publish']").addEventListener("click", publish);
$("#publishClose").addEventListener("click", closePublish);
$("#publishFix").addEventListener("click", () => {
  $("#publishClose").disabled = false;
  closePublish();
});

/* ==========================================================================
   Settings
   ========================================================================== */
$("#tokenForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#tokenError");
  err.classList.remove("show");
  const value = $("#tokenInput").value.trim();
  if (!value) {
    $("span", err).textContent = "الصقي الرمز أولًا.";
    err.classList.add("show");
    return;
  }
  const btn = $("#tokenSave");
  setBusy(btn, true, "جارٍ الفحص…");
  try {
    await api("/api/github-token", { method: "POST", body: JSON.stringify({ token: value }) });
    $("#tokenInput").value = "";
    toast("تم ربط النشر بنجاح ✓");
    await refreshStatus(true);
  } catch (e2) {
    $("span", err).textContent = e2.message;
    err.classList.add("show");
  } finally {
    setBusy(btn, false);
  }
});

$("#tokenRecheck").addEventListener("click", async () => {
  const btn = $("#tokenRecheck");
  setBusy(btn, true, "جارٍ الفحص…");
  await refreshStatus(true);
  setBusy(btn, false);
  toast(state.status?.token?.message || "تم الفحص", state.status?.token?.valid ? "ok" : "err");
});

$$("[data-toggle-pw]").forEach((b) =>
  b.addEventListener("click", () => {
    const input = $(`#${b.dataset.togglePw}`);
    input.type = input.type === "password" ? "text" : "password";
  }),
);

$("#passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#pwError");
  err.classList.remove("show");
  try {
    await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: $("#p_current").value, newPassword: $("#p_new").value, confirmPassword: $("#p_confirm").value }),
    });
    e.target.reset();
    toast("تم تحديث كلمة المرور");
  } catch (e2) {
    $("span", err).textContent = e2.message;
    err.classList.add("show");
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  if (pageForm.isDirty()) {
    const ok = await confirmBox({ title: "تسجيل الخروج", text: "لديك تعديلات غير محفوظة ستضيع. متابعة؟", yes: "خروج" });
    if (!ok) return;
  }
  window.removeEventListener("beforeunload", beforeUnload);
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* ignore */
  }
  window.location.href = "/admin/login.html";
});

/* ==========================================================================
   Keyboard & lifecycle
   ========================================================================== */
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (state.drawer) drawerForm.requestSubmit();
    else pageForm.save();
  }
  if (e.key === "Escape") {
    if ($("#publishDialog").classList.contains("show")) closePublish();
    else if (state.drawer) closeDrawer();
    else document.body.classList.remove("nav-open");
  }
});

function beforeUnload(e) {
  if (pageForm.isDirty() || (state.drawer && JSON.stringify(readDrawer()) !== state.drawer.snapshot)) {
    e.preventDefault();
    e.returnValue = "";
  }
}
window.addEventListener("beforeunload", beforeUnload);

async function reloadData() {
  const { data } = await api("/api/data");
  state.data = data;
  renderAll();
}

(async function init() {
  tickClock();
  setInterval(tickClock, 1000);
  $("#reportBtn").href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent("لدي مشكلة في لوحة تحكم موقع جاد العبدالله: ")}`;
  Object.keys(COLLECTIONS).forEach(renderList);
  renderOverview();
  try {
    const me = await api("/api/me");
    $("#whoami").textContent = me.username;
    $("#avatar").textContent = (me.username || "ج").charAt(0).toUpperCase();
    await reloadData();
    const initial = location.hash.slice(1);
    go(VIEWS.includes(initial) ? initial : "overview", { force: true });
  } catch (err) {
    toast(err.message, "err", 8000);
  }
  refreshStatus();
  setInterval(refreshStatus, 60000);
  setInterval(renderOverview, 60000);
  window.addEventListener("focus", () => refreshStatus());
})();
