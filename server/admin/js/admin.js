const globalAlert = document.getElementById("globalAlert");
const globalSuccess = document.getElementById("globalSuccess");

function showError(message) {
  globalSuccess.classList.remove("show");
  globalAlert.textContent = message;
  globalAlert.classList.add("show");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(message) {
  globalAlert.classList.remove("show");
  globalSuccess.textContent = message;
  globalSuccess.classList.add("show");
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => globalSuccess.classList.remove("show"), 4000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/admin/login.html";
    throw new Error("انتهت الجلسة");
  }
  const result = await res.json();
  if (!result.ok) throw new Error(result.error || "حدث خطأ غير متوقع.");
  return result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

/* ---------------- navigation ---------------- */
document.querySelectorAll(".nav-link[data-section]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll(".nav-link[data-section]").forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    document.querySelectorAll(".content-section").forEach((s) => (s.style.display = "none"));
    document.getElementById(`section-${link.dataset.section}`).style.display = "block";
  });
});

document.getElementById("logoutLink").addEventListener("click", async (e) => {
  e.preventDefault();
  await api("/api/logout", { method: "POST" });
  window.location.href = "/admin/login.html";
});

/* ---------------- whoami ---------------- */
(async () => {
  try {
    const me = await api("/api/me");
    document.getElementById("whoami").textContent = me.username;
  } catch (err) {
    /* redirected already */
  }
})();

/* ---------------- contact ---------------- */
const contactForm = document.getElementById("contactForm");

async function loadContact() {
  const { data } = await api("/api/data");
  const c = data.contact || {};
  document.getElementById("c_phone").value = c.phone || "";
  document.getElementById("c_whatsapp").value = c.whatsapp || "";
  document.getElementById("c_email").value = c.email || "";
  document.getElementById("c_address_ar").value = c.address?.ar || "";
  document.getElementById("c_address_en").value = c.address?.en || "";
  document.getElementById("c_hours_ar").value = c.hours?.ar || "";
  document.getElementById("c_hours_en").value = c.hours?.en || "";
}

contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/data/contact", {
      method: "PUT",
      body: JSON.stringify({
        phone: document.getElementById("c_phone").value.trim(),
        whatsapp: document.getElementById("c_whatsapp").value.trim(),
        email: document.getElementById("c_email").value.trim(),
        address: { ar: document.getElementById("c_address_ar").value, en: document.getElementById("c_address_en").value },
        hours: { ar: document.getElementById("c_hours_ar").value, en: document.getElementById("c_hours_en").value },
      }),
    });
    showSuccess("تم حفظ بيانات التواصل بنجاح.");
  } catch (err) {
    showError(err.message);
  }
});

/* ---------------- texts ---------------- */
const TEXT_FIELDS = [
  { key: "heroKicker", label: "شعار الصفحة الرئيسية (سطر علوي)", multiline: false },
  { key: "heroLead", label: "نص مقدمة الصفحة الرئيسية", multiline: true },
  { key: "aboutLead", label: "مقدمة صفحة (من نحن)", multiline: true },
  { key: "aboutBody", label: "نص إضافي في صفحة (من نحن)", multiline: true },
  { key: "founderRole", label: "المسمى الوظيفي لقيادة المكتب", multiline: false },
  { key: "founderCaption", label: "وصف مختصر لقيادة المكتب", multiline: false },
  { key: "footerText", label: "نص أسفل الموقع (Footer)", multiline: true },
];

function textsFieldHtml(field) {
  const tag = field.multiline ? "textarea" : "input";
  const rows = field.multiline ? ' rows="3"' : "";
  return `
    <div class="panel" style="box-shadow:none; border:1px solid var(--line); padding:16px;">
      <div style="font-weight:700; margin-bottom:10px;">${escapeHtml(field.label)}</div>
      <div class="grid-2">
        <div class="lang-block">
          <div class="lang-tag">عربي</div>
          <${tag} id="t_${field.key}_ar"${rows}></${tag}>
        </div>
        <div class="lang-block">
          <div class="lang-tag">English</div>
          <${tag} id="t_${field.key}_en"${rows}></${tag}>
        </div>
      </div>
    </div>
  `;
}

document.getElementById("textsFields").innerHTML = TEXT_FIELDS.map(textsFieldHtml).join("");

async function loadTexts() {
  const { data } = await api("/api/data");
  const texts = data.texts || {};
  TEXT_FIELDS.forEach((field) => {
    const val = texts[field.key] || { ar: "", en: "" };
    document.getElementById(`t_${field.key}_ar`).value = val.ar || "";
    document.getElementById(`t_${field.key}_en`).value = val.en || "";
  });
}

document.getElementById("textsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const body = {};
    TEXT_FIELDS.forEach((field) => {
      body[field.key] = {
        ar: document.getElementById(`t_${field.key}_ar`).value,
        en: document.getElementById(`t_${field.key}_en`).value,
      };
    });
    await api("/api/data/texts", { method: "PUT", body: JSON.stringify(body) });
    showSuccess("تم حفظ النصوص بنجاح.");
  } catch (err) {
    showError(err.message);
  }
});

/* ---------------- generic collection helpers ---------------- */
let pendingDelete = null;
const confirmModal = document.getElementById("confirmModal");
document.getElementById("confirmCancel").addEventListener("click", () => confirmModal.classList.remove("show"));
document.getElementById("confirmOk").addEventListener("click", async () => {
  if (!pendingDelete) return;
  try {
    await api(`/api/data/${pendingDelete.collection}/${pendingDelete.id}`, { method: "DELETE" });
    confirmModal.classList.remove("show");
    showSuccess("تم الحذف بنجاح.");
    pendingDelete.reload();
  } catch (err) {
    confirmModal.classList.remove("show");
    showError(err.message);
  }
});

function askDelete(collection, id, reload) {
  pendingDelete = { collection, id, reload };
  confirmModal.classList.add("show");
}

const itemModal = document.getElementById("itemModal");
const itemForm = document.getElementById("itemForm");
const itemModalTitle = document.getElementById("itemModalTitle");

function closeItemModal() {
  itemModal.classList.remove("show");
  itemForm.innerHTML = "";
}

itemModal.addEventListener("click", (e) => {
  if (e.target === itemModal) closeItemModal();
});

/* ---------------- practices ---------------- */
async function loadPractices() {
  const { data } = await api("/api/data/practices");
  const list = document.getElementById("practicesList");
  list.innerHTML = data
    .map(
      (item) => `
      <div class="item-card">
        <div class="item-card-head">
          <strong>${escapeHtml(item.title.ar)} / ${escapeHtml(item.title.en)}</strong>
          <div class="item-actions">
            <button class="btn btn-outline" data-edit="${escapeHtml(item.id)}">تعديل</button>
            <button class="btn btn-danger" data-delete="${escapeHtml(item.id)}">حذف</button>
          </div>
        </div>
        <p class="item-meta">${escapeHtml(item.subtitle.ar)}</p>
      </div>
    `,
    )
    .join("") || '<p class="tabs-note">لا توجد خدمات بعد.</p>';

  list.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openPracticeModal(data.find((i) => i.id === btn.dataset.edit))),
  );
  list.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => askDelete("practices", btn.dataset.delete, loadPractices)),
  );
}

function openPracticeModal(item) {
  const isEdit = Boolean(item);
  itemModalTitle.textContent = isEdit ? "تعديل خدمة" : "إضافة خدمة جديدة";
  itemForm.innerHTML = `
    <div class="field">
      <label>أيقونة (اختياري، حسب مكتبة lucide، مثال: scale)</label>
      <input type="text" id="pr_icon" value="${escapeHtml(item?.icon || "briefcase-business")}" />
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">العنوان - عربي</div><input type="text" id="pr_title_ar" value="${escapeHtml(item?.title?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Title - English</div><input type="text" id="pr_title_en" value="${escapeHtml(item?.title?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">وصف مختصر - عربي</div><input type="text" id="pr_subtitle_ar" value="${escapeHtml(item?.subtitle?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Subtitle - English</div><input type="text" id="pr_subtitle_en" value="${escapeHtml(item?.subtitle?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">الوصف التفصيلي - عربي</div><textarea id="pr_desc_ar" rows="3" required>${escapeHtml(item?.desc?.ar)}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Description - English</div><textarea id="pr_desc_en" rows="3" required>${escapeHtml(item?.desc?.en)}</textarea></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">قائمة الخدمات الفرعية - عربي (سطر لكل خدمة)</div><textarea id="pr_services_ar" rows="6">${escapeHtml((item?.services?.ar || []).join("\n"))}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Sub-services - English (one per line)</div><textarea id="pr_services_en" rows="6">${escapeHtml((item?.services?.en || []).join("\n"))}</textarea></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" id="itemCancelBtn">إلغاء</button>
      <button type="submit" class="btn btn-gold">${isEdit ? "حفظ التعديلات" : "إضافة الخدمة"}</button>
    </div>
  `;
  itemForm.querySelector("#itemCancelBtn").addEventListener("click", closeItemModal);
  itemForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      try {
        const body = {
          icon: document.getElementById("pr_icon").value,
          title: { ar: document.getElementById("pr_title_ar").value, en: document.getElementById("pr_title_en").value },
          subtitle: { ar: document.getElementById("pr_subtitle_ar").value, en: document.getElementById("pr_subtitle_en").value },
          desc: { ar: document.getElementById("pr_desc_ar").value, en: document.getElementById("pr_desc_en").value },
          servicesAr: document.getElementById("pr_services_ar").value,
          servicesEn: document.getElementById("pr_services_en").value,
        };
        if (isEdit) {
          await api(`/api/data/practices/${item.id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/api/data/practices", { method: "POST", body: JSON.stringify(body) });
        }
        closeItemModal();
        showSuccess("تم الحفظ بنجاح.");
        loadPractices();
      } catch (err) {
        showError(err.message);
      }
    },
    { once: true },
  );
  itemModal.classList.add("show");
}

document.getElementById("newPracticeBtn").addEventListener("click", () => openPracticeModal(null));

/* ---------------- cases ---------------- */
async function uploadImage(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "same-origin" });
  const result = await res.json();
  if (!result.ok) throw new Error(result.error || "فشل رفع الصورة.");
  return result.path;
}

async function loadCases() {
  const { data } = await api("/api/data/cases");
  const list = document.getElementById("casesList");
  list.innerHTML = data
    .map(
      (item) => `
      <div class="item-card">
        ${item.image ? `<img class="thumb-preview" src="/${escapeHtml(item.image)}" alt="" />` : ""}
        <div class="item-card-head">
          <strong>${escapeHtml(item.title.ar)}</strong>
          <div class="item-actions">
            <button class="btn btn-outline" data-edit="${escapeHtml(item.id)}">تعديل</button>
            <button class="btn btn-danger" data-delete="${escapeHtml(item.id)}">حذف</button>
          </div>
        </div>
        <p class="item-meta">${escapeHtml(item.category.ar)} — ${escapeHtml(item.result.ar || "")}</p>
      </div>
    `,
    )
    .join("") || '<p class="tabs-note">لا توجد قضايا بعد.</p>';

  list.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openCaseModal(data.find((i) => i.id === btn.dataset.edit))),
  );
  list.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => askDelete("cases", btn.dataset.delete, loadCases)),
  );
}

function openCaseModal(item) {
  const isEdit = Boolean(item);
  itemModalTitle.textContent = isEdit ? "تعديل قضية" : "إضافة قضية جديدة";
  itemForm.innerHTML = `
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">عنوان القضية - عربي</div><input type="text" id="cs_title_ar" value="${escapeHtml(item?.title?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Title - English</div><input type="text" id="cs_title_en" value="${escapeHtml(item?.title?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">التصنيف - عربي</div><input type="text" id="cs_category_ar" value="${escapeHtml(item?.category?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Category - English</div><input type="text" id="cs_category_en" value="${escapeHtml(item?.category?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">القيمة / نوع الملف - عربي</div><input type="text" id="cs_amount_ar" value="${escapeHtml(item?.amount?.ar)}" /></div>
      <div class="lang-block"><div class="lang-tag">Amount - English</div><input type="text" id="cs_amount_en" value="${escapeHtml(item?.amount?.en)}" /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">النتيجة - عربي</div><input type="text" id="cs_result_ar" value="${escapeHtml(item?.result?.ar)}" /></div>
      <div class="lang-block"><div class="lang-tag">Result - English</div><input type="text" id="cs_result_en" value="${escapeHtml(item?.result?.en)}" /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">الملخص - عربي</div><textarea id="cs_summary_ar" rows="3" required>${escapeHtml(item?.summary?.ar)}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Summary - English</div><textarea id="cs_summary_en" rows="3" required>${escapeHtml(item?.summary?.en)}</textarea></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">التحدي القانوني - عربي</div><textarea id="cs_challenge_ar" rows="2">${escapeHtml(item?.challenge?.ar)}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Challenge - English</div><textarea id="cs_challenge_en" rows="2">${escapeHtml(item?.challenge?.en)}</textarea></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">الإجراء المتخذ - عربي</div><textarea id="cs_action_ar" rows="2">${escapeHtml(item?.action?.ar)}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Action - English</div><textarea id="cs_action_en" rows="2">${escapeHtml(item?.action?.en)}</textarea></div>
    </div>
    <div class="field">
      <label>مسار ملف القضية (PDF) — اختياري، كما هو موجود في مجلد assets</label>
      <input type="text" id="cs_file" value="${escapeHtml(item?.file || "")}" placeholder="assets/legal-documents/cases/...pdf" />
    </div>
    <div class="field">
      <label>صورة القضية (jpg, png, webp) — اختياري</label>
      <input type="file" id="cs_image_upload" accept="image/jpeg,image/png,image/webp" />
      <input type="hidden" id="cs_image" value="${escapeHtml(item?.image || "")}" />
      ${item?.image ? `<img class="thumb-preview" id="cs_image_preview" src="/${escapeHtml(item.image)}" alt="" />` : '<div id="cs_image_preview"></div>'}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" id="itemCancelBtn">إلغاء</button>
      <button type="submit" class="btn btn-gold">${isEdit ? "حفظ التعديلات" : "إضافة القضية"}</button>
    </div>
  `;
  itemForm.querySelector("#itemCancelBtn").addEventListener("click", closeItemModal);

  itemForm.querySelector("#cs_image_upload").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const uploadedPath = await uploadImage(file);
      document.getElementById("cs_image").value = uploadedPath;
      const previewHolder = document.getElementById("cs_image_preview");
      previewHolder.outerHTML = `<img class="thumb-preview" id="cs_image_preview" src="/${uploadedPath}" alt="" />`;
      showSuccess("تم رفع الصورة، لا تنسَ حفظ القضية.");
    } catch (err) {
      showError(err.message);
    }
  });

  itemForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      try {
        const body = {
          title: { ar: document.getElementById("cs_title_ar").value, en: document.getElementById("cs_title_en").value },
          category: { ar: document.getElementById("cs_category_ar").value, en: document.getElementById("cs_category_en").value },
          amount: { ar: document.getElementById("cs_amount_ar").value, en: document.getElementById("cs_amount_en").value },
          result: { ar: document.getElementById("cs_result_ar").value, en: document.getElementById("cs_result_en").value },
          summary: { ar: document.getElementById("cs_summary_ar").value, en: document.getElementById("cs_summary_en").value },
          challenge: { ar: document.getElementById("cs_challenge_ar").value, en: document.getElementById("cs_challenge_en").value },
          action: { ar: document.getElementById("cs_action_ar").value, en: document.getElementById("cs_action_en").value },
          file: document.getElementById("cs_file").value,
          image: document.getElementById("cs_image").value,
        };
        if (isEdit) {
          await api(`/api/data/cases/${item.id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/api/data/cases", { method: "POST", body: JSON.stringify(body) });
        }
        closeItemModal();
        showSuccess("تم الحفظ بنجاح.");
        loadCases();
      } catch (err) {
        showError(err.message);
      }
    },
    { once: true },
  );
  itemModal.classList.add("show");
}

document.getElementById("newCaseBtn").addEventListener("click", () => openCaseModal(null));

/* ---------------- blog ---------------- */
async function loadBlog() {
  const { data } = await api("/api/data/blog");
  const list = document.getElementById("blogList");
  list.innerHTML = data
    .map(
      (item) => `
      <div class="item-card">
        <div class="item-card-head">
          <strong>${escapeHtml(item.title.ar)}</strong>
          <div class="item-actions">
            <button class="btn btn-outline" data-edit="${escapeHtml(item.id)}">تعديل</button>
            <button class="btn btn-danger" data-delete="${escapeHtml(item.id)}">حذف</button>
          </div>
        </div>
        <p class="item-meta">${escapeHtml(item.category.ar)}</p>
      </div>
    `,
    )
    .join("") || '<p class="tabs-note">لا توجد مقالات بعد.</p>';

  list.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => openBlogModal(data.find((i) => i.id === btn.dataset.edit))),
  );
  list.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => askDelete("blog", btn.dataset.delete, loadBlog)),
  );
}

function openBlogModal(item) {
  const isEdit = Boolean(item);
  itemModalTitle.textContent = isEdit ? "تعديل مقالة" : "إضافة مقالة جديدة";
  itemForm.innerHTML = `
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">العنوان - عربي</div><input type="text" id="bl_title_ar" value="${escapeHtml(item?.title?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Title - English</div><input type="text" id="bl_title_en" value="${escapeHtml(item?.title?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">التصنيف - عربي</div><input type="text" id="bl_category_ar" value="${escapeHtml(item?.category?.ar)}" required /></div>
      <div class="lang-block"><div class="lang-tag">Category - English</div><input type="text" id="bl_category_en" value="${escapeHtml(item?.category?.en)}" required /></div>
    </div>
    <div class="grid-2">
      <div class="lang-block"><div class="lang-tag">الملخص - عربي</div><textarea id="bl_summary_ar" rows="3" required>${escapeHtml(item?.summary?.ar)}</textarea></div>
      <div class="lang-block"><div class="lang-tag">Summary - English</div><textarea id="bl_summary_en" rows="3" required>${escapeHtml(item?.summary?.en)}</textarea></div>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-outline" id="itemCancelBtn">إلغاء</button>
      <button type="submit" class="btn btn-gold">${isEdit ? "حفظ التعديلات" : "إضافة المقالة"}</button>
    </div>
  `;
  itemForm.querySelector("#itemCancelBtn").addEventListener("click", closeItemModal);
  itemForm.addEventListener(
    "submit",
    async (e) => {
      e.preventDefault();
      try {
        const body = {
          title: { ar: document.getElementById("bl_title_ar").value, en: document.getElementById("bl_title_en").value },
          category: { ar: document.getElementById("bl_category_ar").value, en: document.getElementById("bl_category_en").value },
          summary: { ar: document.getElementById("bl_summary_ar").value, en: document.getElementById("bl_summary_en").value },
        };
        if (isEdit) {
          await api(`/api/data/blog/${item.id}`, { method: "PUT", body: JSON.stringify(body) });
        } else {
          await api("/api/data/blog", { method: "POST", body: JSON.stringify(body) });
        }
        closeItemModal();
        showSuccess("تم الحفظ بنجاح.");
        loadBlog();
      } catch (err) {
        showError(err.message);
      }
    },
    { once: true },
  );
  itemModal.classList.add("show");
}

document.getElementById("newBlogBtn").addEventListener("click", () => openBlogModal(null));

/* ---------------- publish ---------------- */
document.getElementById("publishBtn").addEventListener("click", async () => {
  const btn = document.getElementById("publishBtn");
  const logBox = document.getElementById("publishLog");
  btn.disabled = true;
  btn.textContent = "جارٍ النشر...";
  logBox.style.display = "block";
  logBox.textContent = "جارٍ التحقق من التغييرات...";
  try {
    const res = await fetch("/api/publish", { method: "POST", credentials: "same-origin" });
    const result = await res.json();
    const lines = result.log || [result.error || "حدث خطأ غير متوقع."];
    logBox.textContent = lines.join("\n");
    if (result.ok && !result.noChanges) {
      showSuccess("تم الحفظ والنشر بنجاح.");
    } else if (result.noChanges) {
      showSuccess("لا توجد تغييرات جديدة لنشرها.");
    } else {
      showError("حدث خطأ أثناء النشر، راجع السجل بالأسفل.");
    }
  } catch (err) {
    logBox.textContent = err.message;
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "حفظ ونشر التعديلات";
  }
});

/* ---------------- password ---------------- */
document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: document.getElementById("p_current").value,
        newPassword: document.getElementById("p_new").value,
        confirmPassword: document.getElementById("p_confirm").value,
      }),
    });
    document.getElementById("passwordForm").reset();
    showSuccess("تم تحديث كلمة المرور بنجاح.");
  } catch (err) {
    showError(err.message);
  }
});

/* ---------------- refresh (no logout needed) ---------------- */
async function refreshAll() {
  await loadContact();
  await loadTexts();
  await loadPractices();
  await loadCases();
  await loadBlog();
  try {
    const me = await api("/api/me");
    document.getElementById("whoami").textContent = me.username;
  } catch (err) {
    /* redirected already if session expired */
  }
}

document.getElementById("refreshBtn").addEventListener("click", async () => {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  btn.classList.add("is-spinning");
  try {
    await refreshAll();
    showSuccess("تم تحديث البيانات بنجاح.");
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-spinning");
  }
});

/* ---------------- first-login guided tour ---------------- */
const TOUR_STEPS = [
  {
    target: null,
    title: "أهلًا بك 👋",
    body: "هذه جولة سريعة هتشرحلك كل جزء في لوحة التحكم عشان تقدري تتحكمي في الموقع بسهولة تامة. تقدري تتخطيها في أي وقت.",
  },
  {
    target: '[data-section="contact"]',
    title: "بيانات التواصل",
    body: "من هنا تعدّلي رقم الهاتف، واتساب، البريد الإلكتروني، العنوان، وساعات العمل — بتظهر تلقائيًا في كل صفحات الموقع.",
  },
  {
    target: '[data-section="texts"]',
    title: "النصوص التعريفية",
    body: "من هنا تعدّلي نصوص الصفحة الرئيسية، وصفحة \"من نحن\"، وبيانات قيادة المكتب.",
  },
  {
    target: '[data-section="practices"]',
    title: "الخدمات / مجالات الاختصاص",
    body: "من هنا تضيفي أو تعدّلي أو تحذفي خدمات المكتب اللي بتظهر في صفحة الخدمات.",
  },
  {
    target: '[data-section="cases"]',
    title: "القضايا",
    body: "من هنا تضيفي أو تعدّلي القضايا، مع إمكانية رفع صورة لكل قضية.",
  },
  {
    target: '[data-section="blog"]',
    title: "مقالات المدونة",
    body: "من هنا تضيفي مقالات قصيرة تظهر في صفحة المدونة.",
  },
  {
    target: "#refreshBtn",
    title: "زر التحديث",
    body: "لو حد تاني عدّل حاجة، دوسي هنا لتحديث كل البيانات فورًا من غير ما تحتاجي تخرجي وتدخلي تاني.",
  },
  {
    target: "#reportIssueBtn",
    title: "الإبلاغ عن عطل",
    body: "لو حصلت أي مشكلة أو حاجة مش شغالة صح، دوسي هنا وهيفتحلك واتساب مباشرة للتواصل.",
  },
  {
    target: '[data-section="account"]',
    title: "إعدادات الحساب",
    body: "من هنا تقدري تغيّري كلمة المرور في أي وقت.",
  },
  {
    target: '[data-section="publish"]',
    title: "⚠️ الخطوة الأهم: حفظ ونشر التعديلات",
    body: 'أي تعديل تعمليه في أي قسم (تواصل، نصوص، خدمة، قضية، مقالة) بيتحفظ عندك بس، ومش هيظهر على الموقع الحقيقي إلا لما تيجي هنا وتدوسي زر "حفظ ونشر التعديلات". من غير الخطوة دي، أي تعديل مش هيبان لحد.',
  },
];

const TOUR_STORAGE_KEY = "jad_admin_tour_done_v1";
let tourIndex = 0;

function clearTourHighlight() {
  document.querySelectorAll(".tour-highlight").forEach((el) => el.classList.remove("tour-highlight"));
}

function showTourStep(index) {
  clearTourHighlight();
  const step = TOUR_STEPS[index];
  document.getElementById("tourStepCount").textContent = `${index + 1} / ${TOUR_STEPS.length}`;
  document.getElementById("tourTitle").textContent = step.title;
  document.getElementById("tourBody").textContent = step.body;
  document.getElementById("tourBackBtn").style.visibility = index === 0 ? "hidden" : "visible";
  document.getElementById("tourNextBtn").textContent = index === TOUR_STEPS.length - 1 ? "إنهاء الجولة" : "التالي";
  if (step.target) {
    const el = document.querySelector(step.target);
    if (el) el.classList.add("tour-highlight");
  }
}

function startTour() {
  tourIndex = 0;
  showTourStep(tourIndex);
  document.getElementById("tourOverlay").classList.add("show");
}

function endTour() {
  clearTourHighlight();
  document.getElementById("tourOverlay").classList.remove("show");
  localStorage.setItem(TOUR_STORAGE_KEY, "1");
  showReminderBanner();
}

document.getElementById("tourNextBtn").addEventListener("click", () => {
  if (tourIndex >= TOUR_STEPS.length - 1) {
    endTour();
    return;
  }
  tourIndex += 1;
  showTourStep(tourIndex);
});

document.getElementById("tourBackBtn").addEventListener("click", () => {
  if (tourIndex === 0) return;
  tourIndex -= 1;
  showTourStep(tourIndex);
});

document.getElementById("tourSkipBtn").addEventListener("click", endTour);

/* ---------------- publish reminder banner (every login) ---------------- */
function showReminderBanner() {
  const banner = document.getElementById("reminderBanner");
  window.setTimeout(() => banner.classList.add("show"), 400);
}

document.getElementById("reminderClose").addEventListener("click", () => {
  document.getElementById("reminderBanner").classList.remove("show");
});

/* ---------------- initial load ---------------- */
(async () => {
  try {
    await refreshAll();
    if (!localStorage.getItem(TOUR_STORAGE_KEY)) {
      startTour();
    } else {
      showReminderBanner();
    }
  } catch (err) {
    showError(err.message);
  }
})();
