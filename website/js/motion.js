// GlobeFrame motion helpers: scroll reveals, text splitting, count-ups, parallax.
// Everything is progressive: without JS (or with prefers-reduced-motion) content
// renders in its final state, because the hidden "before" states only apply under
// the html.motion class that this file adds.
const Motion = (() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const enabled = () => !reduce.matches && "IntersectionObserver" in window;
  const root = document.documentElement;
  if (enabled()) root.classList.add("motion");

  const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";   // ease-out-expo

  // ---- scroll reveal: elements with [data-reveal] get .in when they enter the viewport
  const io = enabled() ? new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const n = e.target;
      n.classList.add("in");
      io.unobserve(n);
      // drop the stagger delay afterwards so later hover transitions aren't delayed
      setTimeout(() => n.style.setProperty("--i", 0), 1600);
    }
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }) : null;

  function observe(scope = document) {
    if (!io) return;
    scope.querySelectorAll("[data-reveal]:not(.in)").forEach(n => io.observe(n));
  }

  // Give nodes a reveal type and a stagger index (--i) used for transition-delay.
  function reveal(nodes, type = "up", { step = 1, max = 10 } = {}) {
    if (!io) return;
    [...nodes].forEach((n, i) => {
      n.dataset.reveal = type;
      n.style.setProperty("--i", Math.min(i * step, max));
      io.observe(n);
    });
  }

  // Replay a short "pop in" animation on freshly rendered nodes (e.g. after filtering).
  function popIn(nodes, max = 12) {
    if (!enabled()) return;
    [...nodes].forEach((n, i) => {
      n.classList.add("in");
      if (i >= max) return;
      n.animate([{ opacity: 0, transform: "translateY(14px) scale(0.97)" }, { opacity: 1, transform: "none" }],
        { duration: 520, delay: i * 40, easing: EASE, fill: "backwards" });
    });
  }

  // ---- split text into spans (each with --i) for staggered letter animations
  function splitChars(el) {
    const text = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE);
    let i = 0;
    for (const node of text) {
      const frag = document.createDocumentFragment();
      for (const ch of node.textContent) {
        const s = document.createElement("span");
        s.className = "char";
        s.setAttribute("aria-hidden", "true");
        s.textContent = ch;
        s.style.setProperty("--i", i++);
        frag.append(s);
      }
      node.replaceWith(frag);
    }
    return i;
  }

  // ---- animated number (keeps non-numeric values like "Tokyo" untouched)
  function countUp(el, to, { duration = 1400, delay = 0 } = {}) {
    const target = Number(to);
    if (!enabled() || !Number.isFinite(target)) { el.textContent = to; return; }
    const start = performance.now() + delay;
    const ease = t => 1 - Math.pow(1 - t, 4);
    el.textContent = "0";
    function tick(now) {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      el.textContent = Math.round(ease(t) * target);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ---- one rAF-throttled scroll loop shared by everything that reacts to scroll
  const scrollFns = [];
  let ticking = false;
  function onScroll(fn) {
    scrollFns.push(fn);
    fn(window.scrollY);
  }
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; const y = window.scrollY; scrollFns.forEach(f => f(y)); });
  }, { passive: true });

  // ---- scroll progress bar (element with id="progress")
  function progressBar(bar) {
    if (!bar) return;
    onScroll(y => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    });
  }

  // ---- element gently follows the pointer ("magnetic" button)
  function magnetic(el, strength = 0.25) {
    if (!enabled() || !window.matchMedia("(hover: hover)").matches) return;
    el.addEventListener("pointermove", e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * strength;
      const y = (e.clientY - r.top - r.height / 2) * strength;
      el.style.translate = `${x}px ${y}px`;
    });
    el.addEventListener("pointerleave", () => { el.style.translate = "0 0"; });
  }

  // Wait for web fonts (bounded) so letter animations don't jump when fonts swap in.
  function fontsReady(timeout = 900) {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, timeout))]);
  }

  return { enabled, EASE, observe, reveal, popIn, splitChars, countUp, onScroll, progressBar, magnetic, fontsReady };
})();
