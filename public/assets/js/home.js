/*
  Homepage behaviour. Replaces jQuery + Bootstrap + WOW.js + templatemo-custom.js.

  Deliberately dropped from the old stack:
    - owl carousel init  (this page has no .owl-our-team markup)
    - scrollspy          (it called $("/login"), which Sizzle throws on — the
                          console errored on every single scroll event)
    - jQuery smoothscroll (now CSS scroll-behavior + scroll-padding-block-start)
    - imagesloaded       (loaded but never invoked)
    - the preloader      (it waited for window.load, i.e. the video iframe and
                          every image, delaying a page that was already painted)

  Every visual effect below is an ENHANCEMENT. Two rules hold throughout:
    1. Nothing in this file ever hides content. The reveal pass only ever ADDS
       is-visible, and it runs first — before any effect that could throw.
    2. Each module is wrapped in safe(), so one failure cannot cascade and
       leave the page half-initialised. That cascade is exactly how WOW.js
       used to blank the page permanently.

  Pointer-driven effects (tilt, spotlight, magnetic) feed CSS custom properties
  from real pointer coordinates, so they are direction-agnostic — no RTL
  special-casing needed anywhere in here.
*/
(() => {
  "use strict";

  const mq = (q) => window.matchMedia(q).matches;
  const reduced = mq("(prefers-reduced-motion: reduce)");
  const canHover = mq("(hover: hover) and (pointer: fine)");
  const hasIO = "IntersectionObserver" in window;

  const safe = (label, fn) => {
    try {
      fn();
    } catch (err) {
      if (window.console) console.error("[home] " + label, err);
    }
  };

  /* ------------------------------------------------------ scroll reveal ---
     Runs FIRST, before anything that could throw. CSS keeps .reveal visible
     unless <html> has .js, so the worst case here is a page with no
     animation — never a page with no content. */
  safe("reveal", () => {
    const targets = document.querySelectorAll(".reveal");
    if (!targets.length) return;

    if (reduced || !hasIO) {
      targets.forEach((el) => el.classList.add("is-visible"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target); // reveal once; don't re-animate on scroll up
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
    );

    targets.forEach((el) => io.observe(el));
  });

  /* ------------------------------------------- scroll: header / bar / px ---
     One rAF-throttled passive listener drives all three scroll-linked
     effects. Three separate listeners would each schedule their own frame. */
  safe("scroll", () => {
    const header = document.querySelector(".site-header");
    const bar = document.querySelector(".scroll-progress");
    const toTop = document.querySelector("[data-to-top]");
    const layers = reduced
      ? []
      : Array.prototype.slice.call(document.querySelectorAll(".parallax"));

    if (!header && !bar && !toTop && !layers.length) return;

    let ticking = false;

    const update = () => {
      ticking = false;
      const y = window.scrollY;

      if (header) header.toggleAttribute("data-scrolled", y > 8);
      if (toTop) toTop.toggleAttribute("data-show", y > 600);

      if (bar) {
        const max =
          document.documentElement.scrollHeight - window.innerHeight;
        bar.style.setProperty("--progress", max > 0 ? String(y / max) : "0");
      }

      /* Offset from the element's distance to the viewport centre, so a layer
         sits at its authored position when centred and drifts either way. */
      if (layers.length) {
        const vh = window.innerHeight;
        for (const el of layers) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < -200 || rect.top > vh + 200) continue;
          const speed = parseFloat(el.dataset.speed) || 0.12;
          const centre = rect.top + rect.height / 2 - vh / 2;
          el.style.setProperty("--shift", (-centre * speed).toFixed(1) + "px");
        }
      }
    };

    window.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
      },
      { passive: true }
    );
    window.addEventListener("resize", update, { passive: true });
    update();
  });

  /* ------------------------------------------------------- mobile menu ---
     aria-expanded is the source of truth; CSS keys off it. */
  safe("menu", () => {
    const toggle = document.querySelector(".nav-toggle");
    const nav = document.querySelector("#site-nav");
    if (!toggle || !nav) return;

    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      nav.toggleAttribute("data-open", open);
    };

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    /* Esc closes and returns focus to the trigger, so keyboard users are not
       stranded inside a panel they cannot dismiss. */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        setOpen(false);
        toggle.focus();
      }
    });

    /* Tapping a link closes the panel. */
    nav.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
  });

  /* ---------------------------------------------------- 3D tilt + spotlight ---
     Writes --rx/--ry (rotation) and --px/--py (spotlight centre). Pointer
     coordinates are already direction-agnostic, so RTL needs nothing here.

     Gated on canHover: on touch, pointermove fires during a scroll-drag and
     would leave cards frozen mid-tilt after the finger lifts. */
  safe("tilt", () => {
    if (reduced || !canHover) return;

    const tilters = document.querySelectorAll("[data-tilt]");
    if (!tilters.length) return;

    const MAX = 9; // degrees; past ~12 the text starts to look smeared

    for (const el of tilters) {
      let frame = 0;

      el.addEventListener(
        "pointermove",
        (e) => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const x = (e.clientX - r.left) / r.width; // 0..1
            const y = (e.clientY - r.top) / r.height;
            el.style.setProperty("--ry", ((x - 0.5) * 2 * MAX).toFixed(2) + "deg");
            el.style.setProperty("--rx", ((0.5 - y) * 2 * MAX).toFixed(2) + "deg");
            el.style.setProperty("--px", (x * 100).toFixed(1) + "%");
            el.style.setProperty("--py", (y * 100).toFixed(1) + "%");
          });
        },
        { passive: true }
      );

      /* pointerleave AND pointercancel — cancel fires when the browser takes
         over the pointer (scroll, back-gesture) and no leave event follows. */
      const rest = () => {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
      };
      el.addEventListener("pointerleave", rest);
      el.addEventListener("pointercancel", rest);
    }
  });

  /* ------------------------------------------------------ magnetic buttons ---
     The button drifts a few px toward the cursor. Capped well below the
     button's own padding so the label never leaves its background. */
  safe("magnetic", () => {
    if (reduced || !canHover) return;

    const PULL = 6; // px

    for (const el of document.querySelectorAll("[data-magnetic]")) {
      let frame = 0;

      el.addEventListener(
        "pointermove",
        (e) => {
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return;
            const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
            const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
            el.style.setProperty("--mx", (dx * PULL).toFixed(1) + "px");
            el.style.setProperty("--my", (dy * PULL).toFixed(1) + "px");
          });
        },
        { passive: true }
      );

      const rest = () => {
        if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
        el.style.setProperty("--mx", "0px");
        el.style.setProperty("--my", "0px");
      };
      el.addEventListener("pointerleave", rest);
      el.addEventListener("pointercancel", rest);
      el.addEventListener("blur", rest);
    }
  });

  /* ------------------------------------------------------------- counters ---
     The final figure is written in the HTML, so it is already correct before
     this runs. We only read it, animate up to it, then write it back — a
     failure or a reduced-motion preference leaves the real number on screen. */
  safe("counters", () => {
    const nums = document.querySelectorAll("[data-count]");
    if (!nums.length) return;
    if (reduced || !hasIO) return; // HTML already holds the final value

    const run = (el) => {
      const target = parseInt(el.dataset.count, 10);
      if (!isFinite(target)) return;
      const suffix = el.dataset.suffix || "";
      const DUR = 1400;
      const start = performance.now();

      const step = (now) => {
        const t = Math.min((now - start) / DUR, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        el.textContent = Math.round(target * eased) + suffix;
        if (t < 1) requestAnimationFrame(step);
      };

      el.textContent = "0" + suffix;
      requestAnimationFrame(step);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          run(entry.target);
        }
      },
      { threshold: 0.5 }
    );

    nums.forEach((el) => io.observe(el));
  });

  /* ---------------------------------------------------------- back to top ---
     Uses scrollTo rather than an href="#top" so it can honour reduced motion;
     CSS scroll-behavior: smooth is already disabled there, but being explicit
     costs nothing and keeps the two in step. */
  safe("to-top", () => {
    const btn = document.querySelector("[data-to-top]");
    if (!btn) return;

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
      /* Send focus somewhere sensible instead of leaving it on a button that
         is about to fade out from under the keyboard user. */
      const first = document.querySelector(".site-logo");
      if (first) first.focus({ preventScroll: true });
    });
  });

  /* ------------------------------------------------------------- scrollspy ---
     Marks the nav link whose section is in view. Only same-page "#" links are
     ever considered — the old theme fed every href to jQuery, including
     /login and /logout, and Sizzle throws on those, so it errored on every
     single scroll event. */
  safe("scrollspy", () => {
    if (!hasIO) return;

    const links = new Map();
    for (const a of document.querySelectorAll('.site-nav__link[href^="#"]')) {
      const id = a.getAttribute("href").slice(1);
      if (!id) continue;
      const section = document.getElementById(id);
      if (section) links.set(section, a);
    }
    if (!links.size) return;

    const visible = new Set();

    const paint = () => {
      /* Topmost visible section wins, so overlapping ranges never light two
         links at once. */
      let best = null;
      for (const section of links.keys()) {
        if (!visible.has(section)) continue;
        if (!best || section.offsetTop < best.offsetTop) best = section;
      }
      for (const [section, a] of links) {
        if (section === best) a.setAttribute("aria-current", "true");
        else a.removeAttribute("aria-current");
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        paint();
      },
      /* Top inset clears the sticky header; bottom inset keeps a section from
         counting while it is only just peeking in from below. */
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );

    for (const section of links.keys()) io.observe(section);
  });

  /* ------------------------------------------------- canvas particle field ---
     Hand-written, no library. A drifting point cloud with links drawn between
     near neighbours, plus a soft pull toward the pointer.

     Cost control, in order of how much each one saves:
       - skipped entirely under prefers-reduced-motion (never even sized)
       - paused when the canvas scrolls out of view (IntersectionObserver)
       - paused when the tab is hidden (visibilitychange)
       - devicePixelRatio capped at 2 — a 3x phone would otherwise paint 9x
         the pixels for no visible gain
       - particle count scales with area and hard-caps at 90
       - neighbour search is O(n^2) over that capped count, which is the whole
         reason for the cap

     Purely decorative: the element carries aria-hidden in the markup and
     nothing here reads or writes page content. */
  safe("particles", () => {
    if (reduced) return;

    const canvas = document.querySelector(".hero__canvas");
    if (!canvas || !canvas.getContext) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const LINK = 130; // px, in CSS pixels
    let w = 0;
    let h = 0;
    let dpr = 1;
    let dots = [];
    let frame = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999 };

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      /* setTransform, not scale — scale() compounds on every resize. */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(90, Math.round((w * h) / 14000));
      dots = [];
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.28,
          vy: (Math.random() - 0.5) * 0.28,
          r: Math.random() * 1.8 + 0.9,
        });
      }
    };

    const draw = () => {
      frame = 0;
      ctx.clearRect(0, 0, w, h);

      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;

        /* Wrap rather than bounce — bouncing makes the edges read as walls. */
        if (d.x < -10) d.x = w + 10;
        else if (d.x > w + 10) d.x = -10;
        if (d.y < -10) d.y = h + 10;
        else if (d.y > h + 10) d.y = -10;

        const pdx = pointer.x - d.x;
        const pdy = pointer.y - d.y;
        const pd2 = pdx * pdx + pdy * pdy;
        if (pd2 < 34000 && pd2 > 1) {
          const pull = 0.00024;
          d.x += pdx * pull * 60;
          d.y += pdy * pull * 60;
        }

        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(254, 63, 64, 0.45)";
        ctx.fill();
      }

      /* j = i + 1 so each pair is considered once, not twice. */
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > LINK) continue;
          ctx.beginPath();
          ctx.moveTo(dots[i].x, dots[i].y);
          ctx.lineTo(dots[j].x, dots[j].y);
          ctx.strokeStyle =
            "rgba(3, 164, 237, " + (0.22 * (1 - dist / LINK)).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      if (visible && !document.hidden) frame = requestAnimationFrame(draw);
    };

    const start = () => {
      if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw);
    };

    const stop = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    /* Pointer is tracked on the hero, not the canvas: the canvas has
       pointer-events: none, so it never receives events itself. */
    const hero = canvas.closest(".hero") || canvas.parentElement;
    if (hero && canHover) {
      hero.addEventListener(
        "pointermove",
        (e) => {
          const r = canvas.getBoundingClientRect();
          pointer.x = e.clientX - r.left;
          pointer.y = e.clientY - r.top;
        },
        { passive: true }
      );
      hero.addEventListener("pointerleave", () => {
        pointer.x = -9999;
        pointer.y = -9999;
      });
    }

    let rframe = 0;
    window.addEventListener(
      "resize",
      () => {
        if (rframe) cancelAnimationFrame(rframe);
        rframe = requestAnimationFrame(() => {
          rframe = 0;
          size();
        });
      },
      { passive: true }
    );

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });

    if (hasIO) {
      new IntersectionObserver(
        (entries) => {
          visible = entries[0].isIntersecting;
          if (visible) start();
          else stop();
        },
        { threshold: 0 }
      ).observe(canvas);
    }

    size();
    start();
  });
})();

