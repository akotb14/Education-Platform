/*
  Login / join page behaviour.  Replaces "Log in mervat/app.js" (11 lines that
  toggled a .sign-up-mode class) and the FontAwesome kit scripts.

  Everything here is an ENHANCEMENT:
    - The tab switch is pure CSS (:checked on two radios), so the panes still
      work with this file absent or erroring.
    - Native `required` stays in the markup. novalidate is added HERE, at
      runtime, so a no-JS page keeps the browser's own validation instead of
      losing validation altogether.
    - Each module is wrapped in safe(), so one failure cannot cascade.

  Nothing in this file hides content and nothing here participates in the form's
  wire format — the join discriminator is a hidden input in the markup, never
  set from JS.
*/
(() => {
  "use strict";

  const mq = (q) => window.matchMedia(q).matches;
  const reduced = mq("(prefers-reduced-motion: reduce)");
  const canHover = mq("(hover: hover) and (pointer: fine)");

  const safe = (label, fn) => {
    try {
      fn();
    } catch (err) {
      if (window.console) console.error("[auth] " + label, err);
    }
  };

  /* ------------------------------------------------------ password toggle ---
     aria-pressed is the source of truth; CSS swaps the icon off it. */
  safe("password", () => {
    for (const btn of document.querySelectorAll("[data-pw-toggle]")) {
      const input = document.getElementById(btn.getAttribute("aria-controls"));
      if (!input) continue;

      btn.addEventListener("click", () => {
        const show = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(show));
        input.type = show ? "text" : "password";
        btn.setAttribute(
          "aria-label",
          show ? "إخفاء كلمة السر" : "إظهار كلمة السر"
        );
        /* Keep the caret where it was; switching type resets it in some
           browsers, which feels like the field cleared itself. */
        const pos = input.value.length;
        try {
          input.setSelectionRange(pos, pos);
        } catch (e) {
          /* setSelectionRange throws on some input types — not worth guarding
             per-browser, and losing the caret position is cosmetic. */
        }
        input.focus({ preventScroll: true });
      });
    }
  });

  /* ----------------------------------------------------------- validation ---
     Arabic messages in place of the browser's English popups.

     Deliberately permissive where a strict rule could lock out a real user:
       - The LOGIN phone and password are required-only. Existing accounts were
         created by hand over several years, so their stored formats are unknown
         and a format rule here would deny access to valid students.
       - The JOIN phone IS format-checked: that row is new data the centre has
         to dial, and a typo there means nobody can be reached. */
  safe("validate", () => {
    const RULES = {
      required: {
        test: (v) => v.trim().length > 0,
        msg: "هذا الحقل مطلوب",
      },
      name: {
        test: (v) => v.trim().split(/\s+/).filter(Boolean).length >= 2,
        msg: "اكتب الاسم بالكامل — الاسم الأول واسم العائلة على الأقل",
      },
      phone: {
        /* Strip spaces, dashes and Arabic-Indic digits before testing, so a
           number pasted as "٠١١٢ ٢٨٣ ٩٣١٠" is accepted rather than rejected. */
        test: (v) => /^01\d{9}$/.test(normalizeDigits(v)),
        msg: "رقم الهاتف يجب أن يكون ١١ رقمًا ويبدأ بـ 01",
      },
      choose: {
        test: (v) => v !== "",
        msg: "اختر أحد الخيارات من القائمة",
      },
    };

    const AR_DIGITS = /[٠-٩۰-۹]/g;
    function normalizeDigits(v) {
      return v
        .replace(AR_DIGITS, (d) => {
          const c = d.charCodeAt(0);
          return String(c >= 0x06f0 ? c - 0x06f0 : c - 0x0660);
        })
        .replace(/[\s\-()]/g, "");
    }

    const forms = document.querySelectorAll("[data-validate-form]");
    if (!forms.length) return;

    const fieldOf = (input) => input.closest(".field");

    const check = (input) => {
      const names = (input.dataset.rules || "required").split(/\s+/);
      for (const n of names) {
        const rule = RULES[n];
        if (rule && !rule.test(input.value)) return rule.msg;
      }
      return "";
    };

    const paint = (input, msg) => {
      const field = fieldOf(input);
      if (!field) return;
      const slot = field.querySelector(".field__error");
      if (msg) {
        field.setAttribute("data-invalid", "");
        field.removeAttribute("data-valid");
        input.setAttribute("aria-invalid", "true");
        if (slot) slot.textContent = msg;
      } else {
        field.removeAttribute("data-invalid");
        input.removeAttribute("aria-invalid");
        if (input.value.trim()) field.setAttribute("data-valid", "");
        else field.removeAttribute("data-valid");
        if (slot) slot.textContent = "";
      }
    };

    for (const form of forms) {
      /* Only now that we know this module runs do we take validation over from
         the browser. */
      form.setAttribute("novalidate", "");

      const inputs = form.querySelectorAll("[data-rules]");

      for (const input of inputs) {
        /* Validate on blur, then live once the field has been touched — so we
           never scold someone mid-way through their first attempt. */
        input.addEventListener("blur", () => {
          input.dataset.touched = "1";
          paint(input, check(input));
        });

        const live = () => {
          if (input.dataset.touched) paint(input, check(input));
        };
        input.addEventListener("input", live);
        input.addEventListener("change", () => {
          input.dataset.touched = "1";
          paint(input, check(input));
        });
      }

      let submitting = false;

      form.addEventListener("submit", (e) => {
        /* Guard against a double submit without ever DISABLING the button:
           a disabled submitter is dropped from the entry list in some
           browsers, and on the join form that would take the hidden
           discriminator's branch away. Visual busy state only. */
        if (submitting) {
          e.preventDefault();
          return;
        }

        let first = null;
        for (const input of inputs) {
          const msg = check(input);
          input.dataset.touched = "1";
          paint(input, msg);
          if (msg && !first) first = input;
        }

        if (first) {
          e.preventDefault();
          first.focus({ preventScroll: false });
          return;
        }

        submitting = true;
        const btn = form.querySelector("[data-submit]");
        if (btn) btn.setAttribute("data-busy", "");
      });
    }
  });

  /* ----------------------------------------------------------- tab + hash ---
     The radios already drive the panes in CSS. This only syncs the URL so
     /login#join opens on the join tab and the choice survives a reload. */
  safe("tabs", () => {
    const login = document.getElementById("tab-login");
    const join = document.getElementById("tab-join");
    if (!login || !join) return;

    if (location.hash === "#join") join.checked = true;

    const sync = (hash) => {
      if (location.hash !== hash) {
        history.replaceState(null, "", hash || location.pathname);
      }
    };

    login.addEventListener("change", () => login.checked && sync(""));
    join.addEventListener("change", () => join.checked && sync("#join"));

    /* Covers back/forward and an externally shared /login#join URL. The in-page
       cross-pane switches are <label for> elements, so they never touch the
       hash and do not rely on this. */
    window.addEventListener("hashchange", () => {
      if (location.hash === "#join") join.checked = true;
      else if (!location.hash) login.checked = true;
    });
  });

  /* ------------------------------------------------------- orb parallax ---
     Writes --ox/--oy on the brand panel from the pointer. Both default to 0 in
     CSS, so the orbs sit at their authored positions without this.

     Pointer coordinates are direction-agnostic, so RTL needs nothing here. */
  safe("orbs", () => {
    if (reduced || !canHover) return;

    const panel = document.querySelector(".auth__brand");
    if (!panel) return;

    const orbs = panel.querySelectorAll(".orb");
    if (!orbs.length) return;

    let frame = 0;

    panel.addEventListener(
      "pointermove",
      (e) => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const r = panel.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          let i = 0;
          for (const orb of orbs) {
            /* Alternate the sign so the two orbs separate instead of moving as
               one block. */
            const depth = i % 2 === 0 ? 26 : -18;
            orb.style.setProperty("--ox", (dx * depth).toFixed(1) + "px");
            orb.style.setProperty("--oy", (dy * depth).toFixed(1) + "px");
            i++;
          }
        });
      },
      { passive: true }
    );

    const rest = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      for (const orb of orbs) {
        orb.style.setProperty("--ox", "0px");
        orb.style.setProperty("--oy", "0px");
      }
    };
    panel.addEventListener("pointerleave", rest);
    panel.addEventListener("pointercancel", rest);
  });

  /* ------------------------------------------------------ magnetic buttons ---
     Drifts a few px toward the cursor. Capped well under the button's own
     padding so the label never leaves its background. */
  safe("magnetic", () => {
    if (reduced || !canHover) return;

    const PULL = 5;

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

  /* --------------------------------------------------------------- alerts ---
     Move focus to a server-rendered alert so a screen reader announces the
     failure instead of silently re-reading the form. */
  safe("alerts", () => {
    const alert = document.querySelector("[data-autofocus-alert]");
    if (alert) alert.focus({ preventScroll: false });
  });
})();
