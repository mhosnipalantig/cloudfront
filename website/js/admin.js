// Administrator dashboard: statistics, upload, manage photos and categories.
(() => {
  const $ = id => document.getElementById(id);
  const loginView = $("login-view"), dashView = $("dash-view"), logoutBtn = $("logout"), dashNav = $("dash-nav");
  const list = $("admin-list"), statusEl = $("admin-status");
  const editDialog = $("edit-dialog"), editForm = $("edit-form");
  const catDialog = $("cat-dialog"), catEditForm = $("cat-edit-form");
  let photos = [], categories = [];
  let editing = null, renaming = null, query = "";

  const MODE = { local: "Storage: EC2 (local)", s3: "Storage: Amazon S3", cloudfront: "Storage: S3 + CloudFront" };
  const WHERE = { local: "EC2 instance (/var/www/html/photos)", s3: "Amazon S3", cloudfront: "Amazon S3, delivered by CloudFront" };

  function showLogin() { loginView.hidden = false; dashView.hidden = true; logoutBtn.hidden = true; dashNav.hidden = true; }
  function showDash() {
    loginView.hidden = true; dashView.hidden = false; logoutBtn.hidden = false; dashNav.hidden = false;
    Motion.reveal(dashView.querySelectorAll(".panel"), "up");
    refresh();
  }
  let firstStats = true;   // count-up / bar-grow only on the first load, not after every edit

  // Status messages: kind is "ok", "err" or "" (neutral).
  function say(target, text, kind = "") {
    target.textContent = text;
    target.classList.remove("ok", "err");
    if (kind) target.classList.add(kind);
  }
  function fail(e, target = statusEl) { if (e.status === 401) showLogin(); else say(target, e.message, "err"); }

  // ---- login / logout
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button[type=submit]");
    $("login-error").textContent = "";
    btn.disabled = true;
    try { await API.login(f.username.value.trim(), f.password.value); f.reset(); showDash(); }
    catch (err) { $("login-error").textContent = err.message; }
    finally { btn.disabled = false; }
  });
  logoutBtn.addEventListener("click", async () => { await API.logout().catch(() => {}); showLogin(); });

  // ---- section tabs: highlight the section in view
  const tabs = [...dashNav.querySelectorAll("a")];
  if ("IntersectionObserver" in window) {
    const spy = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        tabs.forEach(t => {
          const on = t.getAttribute("href") === `#${e.target.id}`;
          t.classList.toggle("current", on);
          if (on) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current");
        });
      }
    }, { rootMargin: "-30% 0px -60% 0px" });
    document.querySelectorAll("#dash-view > section").forEach(s => spy.observe(s));
  }

  // ---- load everything
  async function refresh() {
    try {
      const [p, c, s] = await Promise.all([API.photos(), API.categories(), API.stats()]);
      photos = p.photos; categories = c.categories;
      renderStats(s); renderCategorySelects(); renderPhotos(); renderCategories();
    } catch (e) { fail(e); }
  }

  // ---- dashboard
  function renderStats(s) {
    const animate = firstStats && Motion.enabled();
    [["st-photos", s.total_photos], ["st-cats", s.total_categories], ["st-feat", s.featured_photos]].forEach(([id, v], k) => {
      if (animate) Motion.countUp($(id), v, { delay: 200 + k * 120 }); else $(id).textContent = v;
    });
    const mb = s.storage_bytes / (1024 * 1024);
    $("st-size").textContent = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(s.storage_bytes / 1024)} KB`;
    $("st-latest").textContent = s.latest_upload
      ? `${s.latest_upload.title} (${new Date(s.latest_upload.uploaded_at).toLocaleString()})` : "No uploads yet";
    $("st-loc").textContent = `${s.photos_with_location} of ${s.total_photos}`;
    $("st-where").textContent = WHERE[s.image_mode] + (s.bucket ? ` – ${s.bucket}` : "");
    $("mode").textContent = MODE[s.image_mode];
    const max = Math.max(1, ...s.per_category.map(c => c.count));
    const width = c => `width:${animate ? 0 : (c.count / max) * 100}%`;
    $("st-bars").replaceChildren(...s.per_category.map(c => el("div", { class: "bar-row" },
      el("span", { class: "bar-label", text: c.name, title: c.name }),
      el("span", { class: "bar-track" }, el("span", { class: "bar-fill", style: width(c), "data-w": (c.count / max) * 100 })),
      el("span", { class: "bar-num", text: String(c.count) }))));
    if (animate) {   // grow bars from zero, one after another
      setTimeout(() => $("st-bars").querySelectorAll(".bar-fill").forEach((b, k) => {
        b.style.transitionDelay = `${k * 70}ms`;
        b.style.width = `${b.dataset.w}%`;
      }), 250);
    }
    firstStats = false;
  }

  function renderCategorySelects() {
    document.querySelectorAll(".cat-select").forEach(sel => {
      const keep = sel.value;
      sel.replaceChildren(el("option", { value: "", text: "Choose a category", disabled: true }),
        ...categories.map(c => el("option", { value: c.name, text: c.name })));
      sel.value = categories.some(c => c.name === keep) ? keep : "";
    });
  }

  // ---- photos
  $("admin-search").addEventListener("input", e => { query = e.target.value.trim(); renderPhotos(); });

  function renderPhotos() {
    const shown = photos.filter(p => photoMatches(p, query));
    $("count").textContent = `(${photos.length})`;
    say(statusEl, !photos.length ? "No photos yet. Upload your first photo above."
      : !shown.length ? `No photos match "${query}".` : "");
    list.replaceChildren(...shown.map(p => el("article", { class: "admin-item" },
      el("div", { class: "admin-thumb" },
        el("img", { src: p.url, alt: p.title, loading: "lazy", decoding: "async" }),
        p.featured ? el("span", { class: "badge-feat" }, icon("star"), document.createTextNode("Featured")) : null),
      el("div", { class: "admin-info" },
        el("strong", { text: p.title, title: p.title }),
        el("span", { class: "meta" }, ...[meta("pin", p.location), meta("tag", p.category)].filter(Boolean)),
        p.description ? el("span", { class: "small clamp", text: p.description }) : null),
      el("div", { class: "admin-actions" },
        el("button", { class: "btn btn-small btn-ghost", onclick: () => toggleFeature(p),
                       "aria-label": `${p.featured ? "Unfeature" : "Feature"} ${p.title}` },
          icon("star"), document.createTextNode(p.featured ? "Unfeature" : "Feature")),
        el("button", { class: "btn btn-small btn-ghost", onclick: () => openEdit(p), "aria-label": `Edit ${p.title}` },
          icon("pencil"), document.createTextNode("Edit")),
        el("button", { class: "btn btn-small btn-danger btn-icon", onclick: () => removePhoto(p),
                       "aria-label": `Delete ${p.title}`, title: "Delete" }, icon("trash"))))));
  }

  // ---- upload: drag-and-drop zone with preview
  const uploadForm = $("upload-form"), drop = $("dropzone"), preview = $("drop-preview"), dropName = $("drop-name");
  const DROP_HINT = dropName.textContent;
  let previewUrl = null;

  function updatePreview() {
    const file = uploadForm.file.files[0];
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    if (!file) { preview.hidden = true; dropName.textContent = DROP_HINT; return; }
    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl; preview.hidden = false;
    dropName.textContent = `${file.name} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    if (!uploadForm.title.value) uploadForm.title.value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 120);
  }
  uploadForm.file.addEventListener("change", updatePreview);
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, () => drop.classList.add("over")));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, () => drop.classList.remove("over")));

  uploadForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, msg = $("upload-msg"), btn = f.querySelector("button[type=submit]");
    const file = f.file.files[0];
    if (file && file.size > 10 * 1024 * 1024) { say(msg, "File is larger than 10 MB.", "err"); return; }
    const data = new FormData(f);
    data.set("featured", f.featured.checked ? "true" : "false");
    btn.disabled = true; btn.classList.add("loading"); say(msg, "Uploading…");
    try {
      await API.upload(data);
      const cat = f.category.value;
      f.reset(); f.category.value = cat; updatePreview();
      say(msg, "Photo uploaded.", "ok");
      refresh();
    } catch (err) { fail(err, msg); }
    finally { btn.disabled = false; btn.classList.remove("loading"); }
  });

  async function toggleFeature(p) {
    try { await API.update(p.id, { featured: !p.featured }); refresh(); } catch (e) { fail(e); }
  }

  function openEdit(p) {
    editing = p;
    editForm.title.value = p.title;
    editForm.location.value = p.location || "";
    editForm.category.value = p.category;
    editForm.description.value = p.description || "";
    editForm.featured.checked = p.featured;
    editDialog.returnValue = "";
    editDialog.showModal();
  }

  editDialog.addEventListener("close", async () => {
    if (editDialog.returnValue !== "save" || !editing) { editing = null; return; }
    const id = editing.id; editing = null;
    try {
      await API.update(id, {
        title: editForm.title.value, location: editForm.location.value, category: editForm.category.value,
        description: editForm.description.value, featured: editForm.featured.checked,
      });
      refresh();
    } catch (e) { fail(e); }
  });

  async function removePhoto(p) {
    if (!confirm(`Delete "${p.title}"? The image file is removed from storage and cannot be recovered.`)) return;
    try { await API.remove(p.id); refresh(); } catch (e) { fail(e); }
  }

  // ---- categories
  function renderCategories() {
    $("cat-list").replaceChildren(...categories.map(c => el("div", { class: "cat-item" },
      icon("folder"),
      el("span", { class: "cat-name", text: c.name, title: c.name }),
      el("span", { class: "muted small", text: `${c.count} photo${c.count === 1 ? "" : "s"}` }),
      el("span", { class: "admin-actions" },
        el("button", { class: "btn btn-small btn-ghost", onclick: () => openRename(c), "aria-label": `Rename ${c.name}` },
          icon("pencil"), document.createTextNode("Rename")),
        el("button", { class: "btn btn-small btn-danger", onclick: () => removeCategory(c), "aria-label": `Delete ${c.name}` },
          icon("trash"), document.createTextNode("Delete"))))));
  }

  $("cat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, msg = $("cat-msg");
    try { await API.addCategory(f.name.value); say(msg, `Added "${f.name.value.trim()}".`, "ok"); f.reset(); refresh(); }
    catch (err) { fail(err, msg); }
  });

  function openRename(c) { renaming = c; catEditForm.name.value = c.name; catDialog.returnValue = ""; catDialog.showModal(); }

  catDialog.addEventListener("close", async () => {
    if (catDialog.returnValue !== "save" || !renaming) { renaming = null; return; }
    const old = renaming.name; renaming = null;
    try { await API.renameCategory(old, catEditForm.name.value); say($("cat-msg"), "Category renamed.", "ok"); refresh(); }
    catch (e) { fail(e, $("cat-msg")); }
  });

  async function removeCategory(c) {
    const note = c.count ? ` Its ${c.count} photo${c.count === 1 ? "" : "s"} will move to "Uncategorized".` : "";
    if (!confirm(`Delete the category "${c.name}"?${note}`)) return;
    try { await API.deleteCategory(c.name); say($("cat-msg"), `Deleted "${c.name}".`, "ok"); refresh(); }
    catch (e) { fail(e, $("cat-msg")); }
  }

  // ---- start
  API.me().then(r => (r.admin ? showDash() : showLogin())).catch(err => {
    showLogin(); $("login-error").textContent = err.message;
  });
})();
