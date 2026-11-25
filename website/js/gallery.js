// Visitor gallery: featured photos, categories, search and photo details.
(() => {
  const grid = document.getElementById("grid");
  const filters = document.getElementById("filters");
  const statusEl = document.getElementById("status");
  const searchEl = document.getElementById("search");
  const featuredSection = document.getElementById("featured-section");
  const featuredRow = document.getElementById("featured");
  const lb = document.getElementById("lightbox");

  let photos = [];
  let shown = [];
  let active = "All";
  let query = "";

  function card(p, i, list, big = false) {
    return el("button", { class: big ? "card card-featured" : "card", onclick: () => open(i, list),
                          "aria-label": `View ${p.title}` },
      el("img", { src: p.url, alt: p.title, loading: "lazy" }),
      el("span", { class: "card-caption" },
        el("strong", { text: p.title }),
        el("span", { text: [p.location, p.category].filter(Boolean).join(" · ") })));
  }

  function renderFilters(categories) {
    const names = ["All", ...categories.filter(c => c.count > 0).map(c => c.name)];
    filters.replaceChildren(...names.map(n =>
      el("button", {
        class: n === active ? "chip active" : "chip", role: "tab", "aria-selected": String(n === active), text: n,
        onclick: () => { active = n; renderFilters(categories); renderGrid(); },
      })));
  }

  function renderGrid() {
    shown = photos.filter(p => (active === "All" || p.category === active) && photoMatches(p, query));
    grid.replaceChildren(...shown.map((p, i) => card(p, i, shown)));
    if (shown.length) statusEl.textContent = query ? `${shown.length} photo${shown.length > 1 ? "s" : ""} found` : "";
    else if (!photos.length) statusEl.textContent = "No photos yet. The administrator can upload photos from the Admin page.";
    else if (query) statusEl.textContent = `No photos match "${query}".`;
    else statusEl.textContent = "No photos in this category yet.";
  }

  function renderFeatured() {
    const feat = photos.filter(p => p.featured).slice(0, 6);
    featuredSection.hidden = feat.length === 0;
    featuredRow.replaceChildren(...feat.map((p, i) => card(p, i, feat, true)));
  }

  let timer;
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = searchEl.value.trim(); renderGrid(); }, 150);
  });

  // ---- photo details (lightbox)
  let lbList = [], current = -1;
  function open(i, list) {
    lbList = list; current = i; show();
    lb.hidden = false; document.body.classList.add("no-scroll");
    lb.querySelector(".lb-close").focus();
  }
  function show() {
    const p = lbList[current];
    const img = document.getElementById("lb-img");
    img.src = p.url; img.alt = p.title;
    document.getElementById("lb-title").textContent = p.title;
    const date = new Date(p.uploaded_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    document.getElementById("lb-meta").textContent =
      [p.location ? `📍 ${p.location}` : null, p.category, date].filter(Boolean).join(" · ");
    document.getElementById("lb-desc").textContent = p.description || "";
  }
  function close() { lb.hidden = true; document.body.classList.remove("no-scroll"); }
  function step(d) { current = (current + d + lbList.length) % lbList.length; show(); }

  lb.querySelector(".lb-close").addEventListener("click", close);
  lb.querySelector(".lb-prev").addEventListener("click", () => step(-1));
  lb.querySelector(".lb-next").addEventListener("click", () => step(1));
  lb.addEventListener("click", e => { if (e.target === lb) close(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  // ---- load
  async function load() {
    try {
      const [p, c] = await Promise.all([API.photos(), API.categories()]);
      photos = p.photos;
      renderFilters(c.categories); renderGrid(); renderFeatured();
    } catch (e) {
      statusEl.textContent = e.message;
    }
    API.health().then(h => {
      const where = { local: "Images served from Amazon EC2", s3: "Images served from Amazon S3",
                      cloudfront: "Images delivered by Amazon CloudFront from Amazon S3" }[h.image_mode];
      document.getElementById("mode-badge").textContent = `${where} (${h.region})`;
    }).catch(() => {});
  }
  load();
})();
