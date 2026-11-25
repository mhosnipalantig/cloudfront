// Small helper for calling the GlobeFrame backend.
const API = (() => {
  const base = (window.GLOBEFRAME && window.GLOBEFRAME.API_BASE) || "/api";

  async function request(path, { method = "GET", json, form } = {}) {
    const opts = { method, credentials: "same-origin", headers: { "X-Requested-With": "GlobeFrame" } };
    if (json !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(json);
    } else if (form) {
      opts.body = form;
    }
    let res;
    try {
      res = await fetch(base + path, opts);
    } catch (e) {
      throw new Error("Cannot reach the server. Is the GlobeFrame backend running?");
    }
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON response */ }
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    health: () => request("/health"),
    photos: () => request("/photos"),
    collections: () => request("/collections"),
    me: () => request("/me"),
    login: (username, password) => request("/login", { method: "POST", json: { username, password } }),
    logout: () => request("/logout", { method: "POST" }),
    upload: (formData) => request("/photos", { method: "POST", form: formData }),
    update: (id, fields) => request(`/photos/${encodeURIComponent(id)}`, { method: "PATCH", json: fields }),
    remove: (id) => request(`/photos/${encodeURIComponent(id)}`, { method: "DELETE" }),
  };
})();

// Build DOM elements safely (text is never parsed as HTML).
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}
