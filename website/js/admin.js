// Administrator dashboard: log in, upload, edit, feature and remove photos.
(() => {
  const $ = id => document.getElementById(id);
  const loginView = $("login-view"), dashView = $("dash-view"), logoutBtn = $("logout");
  const list = $("admin-list"), statusEl = $("admin-status");
  const dialog = $("edit-dialog"), editForm = $("edit-form");
  let photos = [];
  let editing = null;

  function showLogin() { loginView.hidden = false; dashView.hidden = true; logoutBtn.hidden = true; }
  function showDash() { loginView.hidden = true; dashView.hidden = false; logoutBtn.hidden = false; refresh(); }

  function handleAuthError(e) {
    if (e.status === 401) { showLogin(); return true; }
    return false;
  }

  // ---- login / logout
  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    $("login-error").textContent = "";
    try {
      await API.login(f.username.value.trim(), f.password.value);
      f.reset();
      showDash();
    } catch (err) {
      $("login-error").textContent = err.message;
    }
  });
  logoutBtn.addEventListener("click", async () => { await API.logout().catch(() => {}); showLogin(); });

  // ---- list
  async function refresh() {
    try {
      const [p, c, h] = await Promise.all([API.photos(), API.collections(), API.health()]);
      photos = p.photos;
      $("collection-list").replaceChildren(...c.collections.map(n => el("option", { value: n })));
      $("mode").textContent = { local: "Storage: EC2 (local)", s3: "Storage: Amazon S3", cloudfront: "Storage: S3 + CloudFront" }[h.image_mode];
      render();
    } catch (e) {
      if (!handleAuthError(e)) statusEl.textContent = e.message;
    }
  }

  function render() {
    $("count").textContent = `(${photos.length})`;
    statusEl.textContent = photos.length ? "" : "No photos yet. Upload your first photo above.";
    list.replaceChildren(...photos.map(p => el("article", { class: "admin-item" },
      el("img", { src: p.url, alt: p.title, loading: "lazy" }),
      el("div", { class: "admin-info" },
        el("strong", { text: p.title }),
        el("span", { class: "muted small", text: `${p.collection}${p.featured ? " · ★ Featured" : ""}` }),
        p.description ? el("span", { class: "small clamp", text: p.description }) : null),
      el("div", { class: "admin-actions" },
        el("button", { class: "btn btn-small btn-ghost", text: p.featured ? "Unfeature" : "Feature", onclick: () => toggleFeature(p) }),
        el("button", { class: "btn btn-small btn-ghost", text: "Edit", onclick: () => openEdit(p) }),
        el("button", { class: "btn btn-small btn-danger", text: "Remove", onclick: () => remove(p) })),
    )));
  }

  // ---- upload
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
      f.reset(); msg.textContent = "Uploaded ✓";
      refresh();
    } catch (err) {
      if (!handleAuthError(err)) msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ---- edit / feature / remove
  async function toggleFeature(p) {
    try { await API.update(p.id, { featured: !p.featured }); refresh(); }
    catch (e) { if (!handleAuthError(e)) statusEl.textContent = e.message; }
  }

  function openEdit(p) {
    editing = p;
    editForm.title.value = p.title;
    editForm.collection.value = p.collection;
    editForm.description.value = p.description || "";
    editForm.featured.checked = p.featured;
    dialog.showModal();
  }

  dialog.addEventListener("close", async () => {
    if (dialog.returnValue !== "save" || !editing) return;
    try {
      await API.update(editing.id, {
        title: editForm.title.value, collection: editForm.collection.value,
        description: editForm.description.value, featured: editForm.featured.checked,
      });
      refresh();
    } catch (e) { if (!handleAuthError(e)) statusEl.textContent = e.message; }
    editing = null;
  });

  async function remove(p) {
    if (!confirm(`Remove "${p.title}" from the gallery? This deletes the image file.`)) return;
    try { await API.remove(p.id); refresh(); }
    catch (e) { if (!handleAuthError(e)) statusEl.textContent = e.message; }
  }

  // ---- start
  API.me().then(r => (r.admin ? showDash() : showLogin())).catch(err => {
    showLogin(); $("login-error").textContent = err.message;
  });
})();
