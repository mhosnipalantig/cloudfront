// Visitor gallery: browse collections, view photos in a lightbox.
(() => {
  const grid = document.getElementById("grid");
  const filters = document.getElementById("filters");
  const statusEl = document.getElementById("status");
  const featuredSection = document.getElementById("featured-section");
  const featuredRow = document.getElementById("featured");
  const lb = document.getElementById("lightbox");

  let photos = [];
  let shown = [];
  let active = "All";
  let current = -1;

  function card(p, i, big = false) {
    const img = el("img", { src: p.url, alt: p.title, loading: "lazy" });
    return el("button", { class: big ? "card card-featured" : "card", onclick: () => open(i, big ? photos.filter(x => x.featured) : shown) },
      img,
      el("span", { class: "card-caption" },
        el("strong", { text: p.title }),
        el("span", { text: p.collection })));
  }

  function renderFilters() {
    const names = ["All", ...new Set(photos.map(p => p.collection))];
    filters.replaceChildren(...names.map(n =>
      el("button", {
        class: n === active ? "chip active" : "chip", role: "tab", "aria-selected": String(n === active), text: n,
        onclick: () => { active = n; renderFilters(); renderGrid(); },
      })));
  }

  function renderGrid() {
    shown = active === "All" ? photos : photos.filter(p => p.collection === active);
    grid.replaceChildren(...shown.map((p, i) => card(p, i)));
    statusEl.textContent = shown.length ? "" : (photos.length ? "No photos in this collection yet." :
      "No photos yet. The administrator can upload photos from the Admin page.");
  }

  function renderFeatured() {
    const feat = photos.filter(p => p.featured);
    featuredSection.hidden = feat.length === 0;
    featuredRow.replaceChildren(...feat.slice(0, 6).map((p, i) => card(p, i, true)));
  }

  // ---- lightbox
  let lbList = [];
  function open(i, list) {
    lbList = list; current = i; show();
    lb.hidden = false; document.body.classList.add("no-scroll");
    lb.querySelector(".lb-close").focus();
  }
  function show() {
    const p = lbList[current];
    document.getElementById("lb-img").src = p.url;
    document.getElementById("lb-img").alt = p.title;
    document.getElementById("lb-title").textContent = p.title;
    document.getElementById("lb-meta").textContent =
      `${p.collection} · ${new Date(p.uploaded_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`;
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
      const data = await API.photos();
      photos = data.photos;
      renderFilters(); renderGrid(); renderFeatured();
    } catch (e) {
      statusEl.textContent = e.message;
    }
    API.health().then(h => {
      const where = { local: "Images served from Amazon EC2", s3: "Images served from Amazon S3", cloudfront: "Images delivered by Amazon CloudFront" }[h.image_mode];
      document.getElementById("mode-badge").textContent = `${where} (${h.region})`;
    }).catch(() => {});
  }
  load();
})();
