// Visitor gallery: hero, featured photos, categories, search and photo details.
(() => {
  const grid = document.getElementById("grid");
  const filters = document.getElementById("filters");
  const statusEl = document.getElementById("status");
  const searchEl = document.getElementById("search");
  const featuredSection = document.getElementById("featured-section");
  const featuredRow = document.getElementById("featured");
  const toolbar = document.querySelector(".toolbar");
  const hero = document.querySelector(".hero");
  const heroImg = document.getElementById("hero-img");
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const motion = Motion.enabled();

  let photos = [];
  let categories = [];
  let shown = [];
  let active = "All";
  let query = "";

  // ================================================================ hero motion
  const wordmark = document.querySelector(".wordmark");
  wordmark.setAttribute("aria-label", "GlobeFrame");
  if (motion) Motion.splitChars(wordmark);
  Motion.fontsReady().then(() => requestAnimationFrame(() => hero.classList.add("play")));

  Motion.progressBar(document.getElementById("progress"));
  Motion.magnetic(document.querySelector(".cta"));

  if (motion) {
    // scroll parallax: --hp = how far the hero has scrolled out (0..1)
    Motion.onScroll(y => {
      const h = hero.offsetHeight || 1;
      hero.style.setProperty("--hp", Math.min(1, Math.max(0, y / h)).toFixed(4));
    });
    // pointer parallax on the cover photo (desktop only)
    if (window.matchMedia("(hover: hover)").matches) {
      hero.addEventListener("pointermove", e => {
        const r = hero.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        heroImg.style.translate = `${(-x * 18).toFixed(1)}px ${(-y * 12).toFixed(1)}px`;
      });
      hero.addEventListener("pointerleave", () => { heroImg.style.translate = "0 0"; });
    }
  }

  // hero cover: the first featured photo (or newest), with a small credit chip
  function renderHero() {
    const cover = photos.find(p => p.featured) || photos[0];
    if (!cover) return;
    heroImg.addEventListener("load", () => requestAnimationFrame(() => heroImg.classList.add("in")), { once: true });
    heroImg.src = cover.url;
    heroImg.hidden = false;
    const credit = document.getElementById("hero-credit");
    credit.replaceChildren(icon("pin"), document.createTextNode([cover.title, cover.location].filter(Boolean).join(" — ")));
    credit.hidden = false;
  }

  // ================================================================ cards & lists
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
        onclick: () => { if (active === c.name) return; active = c.name; renderFilters(); renderGrid(true); },
      }, document.createTextNode(c.name), el("span", { class: "count", text: String(c.count) }))));
  }

  function empty(title, text) {
    return el("div", { class: "empty" }, icon("image"), el("strong", { text: title }), el("span", { text }));
  }

  // first render: cards rise in as they scroll into view; later renders (filter/search) pop in
  let firstGrid = true;
  function renderGrid(changed = false) {
    grid.removeAttribute("aria-busy");
    shown = photos.filter(p => (active === "All" || p.category === active) && photoMatches(p, query));
    if (shown.length) {
      const cards = shown.map((p, i) => card(p, i, shown));
      grid.replaceChildren(...cards);
      if (firstGrid || !changed) Motion.reveal(cards, "card", { max: 7 });
      else Motion.popIn(cards);
      firstGrid = false;
      statusEl.textContent = query ? `${shown.length} photo${shown.length > 1 ? "s" : ""} found` : "";
      return;
    }
    statusEl.textContent = "";
    let box;
    if (!photos.length) box = empty("No photos yet", "The administrator can upload photos from the Admin page.");
    else if (query) box = empty("No matches", `No photos match "${query}". Try a different word or category.`);
    else box = empty("Nothing here yet", "No photos in this category yet.");
    grid.replaceChildren(box);
    Motion.popIn([box]);
  }

  function renderFeatured() {
    const feat = photos.filter(p => p.featured).slice(0, 5);
    featuredSection.hidden = feat.length === 0;
    const cards = feat.map((p, i) => card(p, i, feat, true));
    featuredRow.replaceChildren(...cards);
    Motion.reveal(cards, "tile", { step: 1.5 });
  }

  let timer;
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = searchEl.value.trim(); renderGrid(true); }, 180);
  });

  // toolbar gets a bottom border once it sticks to the top of the viewport
  if ("IntersectionObserver" in window) {
    const sentinel = el("div", { "aria-hidden": "true" });
    toolbar.before(sentinel);
    const top = parseFloat(getComputedStyle(toolbar).top) || 0;
    new IntersectionObserver(([e]) => toolbar.classList.toggle("stuck", !e.isIntersecting && e.boundingClientRect.top < 1),
      { rootMargin: `-${top}px 0px 0px 0px` }).observe(sentinel);
  }

  // section reveals declared in the HTML, plus the "How it works" cards
  Motion.reveal(document.querySelectorAll(".about-grid article"), "up");
  Motion.reveal([toolbar.querySelector(".section-title")], "clip");
  Motion.observe();

  // ================================================================ lightbox
  let lbList = [], current = -1, opener = null;

  // Run fn when an animation ends, or after `ms` at the latest: the UI must never wait
  // on an animation that a throttled tab is slow to finish.
  function after(anim, ms, fn) {
    let done = false;
    const once = () => { if (!done) { done = true; fn(); } };
    if (anim) anim.finished.then(once, once);
    setTimeout(once, ms);
  }

  // Animate the lightbox image from (or back to) the card's on-screen rectangle.
  function flip(fromEl, reverse = false) {
    const card = fromEl && fromEl.querySelector("img");
    if (!motion || !card || !lbImg.animate) return null;
    const a = card.getBoundingClientRect(), b = lbImg.getBoundingClientRect();
    if (!a.width || !b.width || a.bottom < 0 || a.top > innerHeight) return null;
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const s = Math.max(a.width / b.width, a.height / b.height);
    const frames = [{ transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.6 }, { transform: "none", opacity: 1 }];
    return lbImg.animate(reverse ? frames.reverse() : frames,
      { duration: reverse ? 380 : 560, easing: Motion.EASE, fill: reverse ? "forwards" : "none" });
  }

  function fillCaption(p) {
    const date = new Date(p.uploaded_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    document.getElementById("lb-title").textContent = p.title;
    document.getElementById("lb-meta").replaceChildren(
      ...[meta("pin", p.location), meta("tag", p.category), meta("calendar", date)].filter(Boolean));
    document.getElementById("lb-desc").textContent = p.description || "";
    document.getElementById("lb-count").textContent = lbList.length > 1 ? `${current + 1} / ${lbList.length}` : "";
    lb.querySelectorAll(".lb-nav").forEach(b => { b.hidden = lbList.length < 2; });
  }

  async function open(i, list, from) {
    lbList = list; current = i; opener = from || null;
    const p = lbList[current];
    lbImg.src = p.url; lbImg.alt = p.title;
    fillCaption(p);
    lb.hidden = false; document.body.classList.add("no-scroll");
    lb.querySelector(".lb-close").focus();
    try { await lbImg.decode(); } catch (_) { /* show anyway */ }
    flip(opener);
  }

  function step(d) {
    current = (current + d + lbList.length) % lbList.length;
    const p = lbList[current];
    if (!motion) { lbImg.src = p.url; lbImg.alt = p.title; fillCaption(p); return; }
    const out = lbImg.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-d * 40}px)` }],
      { duration: 180, easing: "ease-in", fill: "forwards" });
    after(out, 220, async () => {
      lbImg.src = p.url; lbImg.alt = p.title; fillCaption(p);
      try { await lbImg.decode(); } catch (_) { /* ignore */ }
      out.cancel();
      lbImg.animate([{ opacity: 0, transform: `translateX(${d * 40}px)` }, { opacity: 1, transform: "none" }],
        { duration: 420, easing: Motion.EASE });
      lb.querySelectorAll("figcaption > *").forEach((n, k) =>
        n.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }],
          { duration: 500, delay: 60 + k * 50, easing: Motion.EASE, fill: "backwards" }));
    });
  }

  function close() {
    // the card for the photo now showing (may differ from the opener after next/prev)
    const box = opener && opener.parentElement;
    const target = box && document.contains(box) && box.children.length === lbList.length ? box.children[current] : null;
    const done = () => {
      lb.hidden = true; document.body.classList.remove("no-scroll");
      lbImg.getAnimations().forEach(a => a.cancel());
      const back = target || opener;
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
    const anim = target ? flip(target, true) : null;
    if (anim) {
      lb.animate([{ backgroundColor: "rgba(6,11,20,0.96)" }, { backgroundColor: "rgba(6,11,20,0)" }], { duration: 380, easing: Motion.EASE });
      after(anim, 420, done);
    } else if (motion && lb.animate) {
      after(lb.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-in" }), 240, done);
    } else done();
  }

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

  // ================================================================ load
  async function load() {
    try {
      const [p, c] = await Promise.all([API.photos(), API.categories()]);
      photos = p.photos; categories = c.categories;
      Motion.countUp(document.getElementById("hs-photos"), photos.length, { delay: 600 });
      Motion.countUp(document.getElementById("hs-cats"), categories.filter(x => x.count > 0).length, { delay: 700 });
      renderHero(); renderFilters(); renderGrid(); renderFeatured();
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
