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

  const enc = encodeURIComponent;
  return {
    health: () => request("/health"),
    photos: () => request("/photos"),
    categories: () => request("/categories"),
    stats: () => request("/stats"),
    me: () => request("/me"),
    login: (username, password) => request("/login", { method: "POST", json: { username, password } }),
    logout: () => request("/logout", { method: "POST" }),
    upload: (formData) => request("/photos", { method: "POST", form: formData }),
    update: (id, fields) => request(`/photos/${enc(id)}`, { method: "PATCH", json: fields }),
    remove: (id) => request(`/photos/${enc(id)}`, { method: "DELETE" }),
    addCategory: (name) => request("/categories", { method: "POST", json: { name } }),
    renameCategory: (name, newName) => request(`/categories/${enc(name)}`, { method: "PATCH", json: { name: newName } }),
    deleteCategory: (name) => request(`/categories/${enc(name)}`, { method: "DELETE" }),
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

// SVG icon from the page's <symbol id="i-NAME"> sprite.
function icon(name, cls = "icon") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// Icon + text pair, e.g. meta("pin", "Kyoto, Japan").
function meta(name, text) {
  return text ? el("span", {}, icon(name), document.createTextNode(text)) : null;
}

// Case-insensitive search across title, location, category and description.
function photoMatches(p, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return [p.title, p.location, p.category, p.description].some(v => (v || "").toLowerCase().includes(q));
}
