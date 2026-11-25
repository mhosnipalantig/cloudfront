// Visitor gallery: featured photos, categories, search and photo details.
(() => {
  const grid = document.getElementById("grid");
  const filters = document.getElementById("filters");
  const statusEl = document.getElementById("status");
  const searchEl = document.getElementById("search");
  const featuredSection = document.getElementById("featured-section");
  const featuredRow = document.getElementById("featured");
  const toolbar = document.querySelector(".toolbar");
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  let photos = [];
  let categories = [];
  let shown = [];
  let active = "All";
  let query = "";

  // ---- scroll reveal (skipped when the visitor prefers reduced motion)
  const revealer = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("in");
      revealer.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -40px 0px" }) : null;

  function reveal(nodes) {
    if (!revealer || reduceMotion.matches) return;
    nodes.forEach((n, i) => {
      n.classList.add("reveal");
      n.style.transitionDelay = `${Math.min(i % 8, 7) * 45}ms`;
      revealer.observe(n);
    });
  }

  function card(p, i, list, big = false) {
    const img = el("img", { src: p.url, alt: p.title, loading: big && i === 0 ? "eager" : "lazy", decoding: "async", "data-loading": "" });
    img.addEventListener("load", () => img.removeAttribute("data-loading"), { once: true });
    img.addEventListener("error", () => img.removeAttribute("data-loading"), { once: true });
    return el("button", { class: big ? "card card-featured" : "card", onclick: e => open(i, list, e.currentTarget),
                          "aria-label": `View ${p.title}` },
      img,
      el("span", { class: "card-caption" },
        el("strong", { text: p.title }),
        el("span", { text: [p.location, p.category].filter(Boolean).join(" · ") })));
  }

  function renderFilters() {
    const visible = categories.filter(c => c.count > 0);
    const items = [{ name: "All", count: photos.length }, ...visible];
    filters.replaceChildren(...items.map(c =>
      el("button", {
        class: c.name === active ? "chip active" : "chip", role: "tab", "aria-selected": String(c.name === active),
        onclick: () => { active = c.name; renderFilters(); renderGrid(); },
      }, document.createTextNode(c.name), el("span", { class: "count", text: String(c.count) }))));
  }

  function empty(title, text) {
    return el("div", { class: "empty" }, icon("image"), el("strong", { text: title }), el("span", { text }));
  }

  function renderGrid() {
    grid.removeAttribute("aria-busy");
    shown = photos.filter(p => (active === "All" || p.category === active) && photoMatches(p, query));
    if (shown.length) {
      const cards = shown.map((p, i) => card(p, i, shown));
      grid.replaceChildren(...cards);
      reveal(cards);
      statusEl.textContent = query ? `${shown.length} photo${shown.length > 1 ? "s" : ""} found` : "";
      return;
    }
    statusEl.textContent = "";
    if (!photos.length) grid.replaceChildren(empty("No photos yet", "The administrator can upload photos from the Admin page."));
    else if (query) grid.replaceChildren(empty("No matches", `No photos match "${query}". Try a different word or category.`));
    else grid.replaceChildren(empty("Nothing here yet", "No photos in this category yet."));
  }

  function renderFeatured() {
    const feat = photos.filter(p => p.featured).slice(0, 5);
    featuredSection.hidden = feat.length === 0;
    featuredRow.replaceChildren(...feat.map((p, i) => card(p, i, feat, true)));
  }

  let timer;
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = searchEl.value.trim(); renderGrid(); }, 150);
  });

  // toolbar gets a bottom border once it sticks under the header
  if (revealer) {
    const sentinel = el("div", { "aria-hidden": "true" });
    toolbar.before(sentinel);
    new IntersectionObserver(([e]) => toolbar.classList.toggle("stuck", !e.isIntersecting),
      { rootMargin: `-${parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64}px 0px 0px 0px` })
      .observe(sentinel);
  }

  // ---- photo details (lightbox)
  let lbList = [], current = -1, opener = null;
  function open(i, list, from) {
    lbList = list; current = i; opener = from || null;
    show(false);
    lb.hidden = false; document.body.classList.add("no-scroll");
    lb.querySelector(".lb-close").focus();
  }
  function show(animate = true) {
    const p = lbList[current];
    const apply = () => {
      lbImg.src = p.url; lbImg.alt = p.title;
      document.getElementById("lb-title").textContent = p.title;
      const date = new Date(p.uploaded_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      document.getElementById("lb-meta").replaceChildren(
        ...[meta("pin", p.location), meta("tag", p.category), meta("calendar", date)].filter(Boolean));
      document.getElementById("lb-desc").textContent = p.description || "";
      document.getElementById("lb-count").textContent = lbList.length > 1 ? `${current + 1} / ${lbList.length}` : "";
      lb.querySelectorAll(".lb-nav").forEach(b => { b.hidden = lbList.length < 2; });
      lbImg.classList.remove("swap");
    };
    if (!animate || reduceMotion.matches) return apply();
    lbImg.classList.add("swap");
    setTimeout(apply, 150);
  }
  function close() {
    lb.hidden = true; document.body.classList.remove("no-scroll");
    if (opener && document.contains(opener)) opener.focus();
  }
  function step(d) { current = (current + d + lbList.length) % lbList.length; show(); }

  lb.querySelector(".lb-close").addEventListener("click", close);
  lb.querySelector(".lb-prev").addEventListener("click", () => step(-1));
  lb.querySelector(".lb-next").addEventListener("click", () => step(1));
  lb.addEventListener("click", e => { if (e.target === lb || e.target.tagName === "FIGURE") close(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowLeft" && lbList.length > 1) step(-1);
    else if (e.key === "ArrowRight" && lbList.length > 1) step(1);
    else if (e.key === "Tab") {           // keep keyboard focus inside the dialog
      const f = [...lb.querySelectorAll("button:not([hidden])")];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // swipe left/right on touch screens
  let touchX = null;
  lb.addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", e => {
    if (touchX == null || lbList.length < 2) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
    touchX = null;
  });

  // ---- load
  async function load() {
    try {
      const [p, c] = await Promise.all([API.photos(), API.categories()]);
      photos = p.photos; categories = c.categories;
      document.getElementById("hs-photos").textContent = photos.length;
      document.getElementById("hs-cats").textContent = categories.filter(x => x.count > 0).length;
      renderFilters(); renderGrid(); renderFeatured();
    } catch (e) {
      grid.removeAttribute("aria-busy");
      grid.replaceChildren(empty("Could not load photos", e.message));
      statusEl.textContent = "";
    }
    API.health().then(h => {
      const where = { local: "Images served from Amazon EC2", s3: "Images served from Amazon S3",
                      cloudfront: "Images delivered by Amazon CloudFront from Amazon S3" }[h.image_mode];
      document.getElementById("mode-badge").textContent = `${where} · ${h.region}`;
      const CITY = { "ap-northeast-1": "Tokyo", "ap-northeast-3": "Osaka", "ap-southeast-1": "Singapore",
                     "us-east-1": "N. Virginia", "us-west-2": "Oregon", "eu-west-1": "Ireland" };
      if (h.region) document.getElementById("hs-region").textContent = CITY[h.region] || h.region;
    }).catch(() => {});
  }
  load();
})();
