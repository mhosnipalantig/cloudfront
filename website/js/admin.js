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
  function showDash() { loginView.hidden = true; dashView.hidden = false; logoutBtn.hidden = false; dashNav.hidden = false; refresh(); }
  function fail(e, target = statusEl) { if (e.status === 401) showLogin(); else target.textContent = e.message; }

  // ---- login / logout
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    $("login-error").textContent = "";
    try { await API.login(f.username.value.trim(), f.password.value); f.reset(); showDash(); }
    catch (err) { $("login-error").textContent = err.message; }
  });
  logoutBtn.addEventListener("click", async () => { await API.logout().catch(() => {}); showLogin(); });

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
    $("st-photos").textContent = s.total_photos;
    $("st-cats").textContent = s.total_categories;
    $("st-feat").textContent = s.featured_photos;
    const mb = s.storage_bytes / (1024 * 1024);
    $("st-size").textContent = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(s.storage_bytes / 1024)} KB`;
    $("st-latest").textContent = s.latest_upload
      ? `${s.latest_upload.title} (${new Date(s.latest_upload.uploaded_at).toLocaleString()})` : "No uploads yet";
    $("st-loc").textContent = `${s.photos_with_location} of ${s.total_photos}`;
    $("st-where").textContent = WHERE[s.image_mode] + (s.bucket ? ` – ${s.bucket}` : "");
    $("mode").textContent = MODE[s.image_mode];
    const max = Math.max(1, ...s.per_category.map(c => c.count));
    $("st-bars").replaceChildren(...s.per_category.map(c => el("div", { class: "bar-row" },
      el("span", { class: "bar-label", text: c.name }),
      el("span", { class: "bar-track" }, el("span", { class: "bar-fill", style: `width:${(c.count / max) * 100}%` })),
      el("span", { class: "bar-num", text: String(c.count) }))));
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
    statusEl.textContent = !photos.length ? "No photos yet. Upload your first photo above."
      : !shown.length ? `No photos match "${query}".` : "";
    list.replaceChildren(...shown.map(p => el("article", { class: "admin-item" },
      el("img", { src: p.url, alt: p.title, loading: "lazy" }),
      el("div", { class: "admin-info" },
        el("strong", { text: p.title }),
        el("span", { class: "muted small", text: [p.location ? `📍 ${p.location}` : null, p.category, p.featured ? "★ Featured" : null].filter(Boolean).join(" · ") }),
        p.description ? el("span", { class: "small clamp", text: p.description }) : null),
      el("div", { class: "admin-actions" },
        el("button", { class: "btn btn-small btn-ghost", text: p.featured ? "Unfeature" : "Feature", onclick: () => toggleFeature(p) }),
        el("button", { class: "btn btn-small btn-ghost", text: "Edit", onclick: () => openEdit(p) }),
        el("button", { class: "btn btn-small btn-danger", text: "Delete", onclick: () => removePhoto(p) })))));
  }

  $("upload-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, msg = $("upload-msg"), btn = f.querySelector("button[type=submit]");
    const file = f.file.files[0];
    if (file && file.size > 10 * 1024 * 1024) { msg.textContent = "File is larger than 10 MB."; return; }
    const data = new FormData(f);
    data.set("featured", f.featured.checked ? "true" : "false");
    btn.disabled = true; msg.textContent = "Uploading…";
    try {
      await API.upload(data);
      const cat = f.category.value;
      f.reset(); f.category.value = cat;
      msg.textContent = "Uploaded ✓";
      refresh();
    } catch (err) { fail(err, msg); }
    finally { btn.disabled = false; }
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
      el("span", { class: "cat-name", text: c.name }),
      el("span", { class: "muted small", text: `${c.count} photo${c.count === 1 ? "" : "s"}` }),
      el("span", { class: "admin-actions" },
        el("button", { class: "btn btn-small btn-ghost", text: "Rename", onclick: () => openRename(c) }),
        el("button", { class: "btn btn-small btn-danger", text: "Delete", onclick: () => removeCategory(c) })))));
  }

  $("cat-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target, msg = $("cat-msg");
    try { await API.addCategory(f.name.value); msg.textContent = `Added "${f.name.value.trim()}" ✓`; f.reset(); refresh(); }
    catch (err) { fail(err, msg); }
  });

  function openRename(c) { renaming = c; catEditForm.name.value = c.name; catDialog.returnValue = ""; catDialog.showModal(); }

  catDialog.addEventListener("close", async () => {
    if (catDialog.returnValue !== "save" || !renaming) { renaming = null; return; }
    const old = renaming.name; renaming = null;
    try { await API.renameCategory(old, catEditForm.name.value); $("cat-msg").textContent = "Category renamed ✓"; refresh(); }
    catch (e) { fail(e, $("cat-msg")); }
  });

  async function removeCategory(c) {
    const note = c.count ? ` Its ${c.count} photo${c.count === 1 ? "" : "s"} will move to "Uncategorized".` : "";
    if (!confirm(`Delete the category "${c.name}"?${note}`)) return;
    try { await API.deleteCategory(c.name); $("cat-msg").textContent = `Deleted "${c.name}" ✓`; refresh(); }
    catch (e) { fail(e, $("cat-msg")); }
  }

  // ---- start
  API.me().then(r => (r.admin ? showDash() : showLogin())).catch(err => {
    showLogin(); $("login-error").textContent = err.message;
  });
})();
