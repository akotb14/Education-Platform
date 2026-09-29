/*
  Admin console behaviour. Vanilla, no dependencies, loaded with `defer`.

  WHAT THIS REPLACES
  public/admin/dashboard/assets/js/main.js (22 lines), left on disk untouched.
  That file:
    · attached the highlight class on `mouseover`, so the sidebar's "current
      page" indicator actually followed the mouse pointer and, on a touch
      screen, stuck to whatever was tapped last. The real current page is now
      marked server-side with aria-current, which also announces it.
    · did `toggle.onclick = ...` against a bare <div class="toggle">, so the
      menu could not be opened from the keyboard at all.
    · dereferenced `document.querySelector(".toggle")` with no null check. On
      any admin page whose markup lacked that div the script threw on load —
      and since it was a blocking <script> at the end of <body> with no defer,
      the throw killed everything after it.
    · had no Escape handler, no focus management, and no way to close the
      drawer other than hitting the toggle again.

  Everything here is null-guarded, so this file is safe to load on an admin
  page that has no sidebar or no reveal targets.
*/
(function () {
  "use strict";

  var side = document.querySelector("[data-side]");
  var scrim = document.querySelector("[data-side-scrim]");
  var toggle = document.querySelector("[data-side-toggle]");

  /* ------------------------------------------------------------- drawer --- */
  /* aria-expanded on the button is the single source of truth for open state,
     so the DOM and the accessibility tree can never disagree. */
  function isOpen() {
    return !!toggle && toggle.getAttribute("aria-expanded") === "true";
  }

  function setOpen(open) {
    if (!toggle || !side) return;

    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    side.classList.toggle("is-open", open);
    if (scrim) scrim.classList.toggle("is-open", open);

    /* Stops the page behind the drawer scrolling on iOS. Only while the
       drawer is a drawer — above 992px it is a static column. */
    document.body.style.overflow = open ? "hidden" : "";

    if (open) {
      var first = side.querySelector("a, button");
      if (first) first.focus();
    }
  }

  if (toggle && side) {
    toggle.addEventListener("click", function () {
      setOpen(!isOpen());
    });

    if (scrim) {
      scrim.addEventListener("click", function () {
        setOpen(false);
        toggle.focus();
      });
    }

    /* Escape closes and returns focus to the trigger — otherwise focus is left
       inside a hidden drawer, which is a keyboard trap. */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    /* Following a link inside the drawer navigates away; leave the body scroll
       lock off so a cached back-navigation doesn't restore a frozen page. */
    side.addEventListener("click", function (e) {
      if (e.target.closest("a")) document.body.style.overflow = "";
    });

    /* Crossing into the desktop layout while the drawer is open would leave
       aria-expanded="true" on a button that is now display:none. */
    var wide = window.matchMedia("(min-width: 992px)");
    var onWide = function (mq) {
      if (mq.matches && isOpen()) setOpen(false);
    };
    if (wide.addEventListener) {
      wide.addEventListener("change", onWide);
    } else if (wide.addListener) {
      wide.addListener(onWide);
    }
  }

  /* ------------------------------------------------------------ confirm --- */
  /* Delete forms carry data-confirm="…". Progressive enhancement on purpose:
     with JS off or broken the form still submits, it just doesn't ask first —
     the safety that matters (POST + CSRF + the isAdmin guard) is server-side.
     Delegated from the document so it also covers rows added later.

     The old pages had no confirmation at all, and delete was a GET link. */
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;

    var message = form.getAttribute("data-confirm");
    if (!message) return;

    if (!window.confirm(message)) {
      e.preventDefault();
      return;
    }

    /* Double-submit guard: a slow round trip invites a second click, and each
       click is another delete request. */
    var btn = form.querySelector("button[type='submit'], button:not([type])");
    if (btn) {
      btn.disabled = true;
      /* If the navigation is cancelled (back button, blocked request) the
         button would otherwise stay dead forever. */
      window.setTimeout(function () {
        btn.disabled = false;
      }, 8000);
    }
  });

  /* ----------------------------------------------------- question builder --- */
  /* The repeating question editor on the add-homework / quiz / exam form.

     NOTE ON PLACEMENT: this sits above the reveal block on purpose. That block
     ends with `if (!targets.length) return;`, which returns out of this whole
     IIFE — anything written after it silently does not run on a page with no
     .reveal elements.

     Everything here is an enhancement. The server renders one question block
     (or, after a validation error, the ones that were submitted), and that
     form submits and saves on its own; this only adds and removes blocks. */
  (function questionBuilder() {
    var wrap = document.querySelector("[data-qbuilder]");
    if (!wrap) return;

    var list = wrap.querySelector("[data-qlist]");
    var tpl = wrap.querySelector("[data-qtemplate]");
    var addBtn = wrap.querySelector("[data-qadd]");
    if (!list || !tpl || !addBtn) return;

    var form = wrap.closest("form");
    var live = form ? form.querySelector("[data-qlive]") : null;
    var max = parseInt(wrap.getAttribute("data-max"), 10) || 50;

    /* Name attributes are indexed, and the index only ever has to be unique —
       the server skips gaps, so removing block 2 of 5 leaves 0,1,3,4 and that
       is fine. Seeding from the highest index already on the page keeps a
       re-rendered form (which may already hold 20 blocks) from colliding. */
    var nextIndex = 0;
    (function seed() {
      var fields = list.querySelectorAll("[name^='q_']");
      for (var i = 0; i < fields.length; i++) {
        var m = /^q_(\d+)_/.exec(fields[i].getAttribute("name") || "");
        if (m && Number(m[1]) >= nextIndex) nextIndex = Number(m[1]) + 1;
      }
    })();

    function cards() {
      return list.querySelectorAll("[data-qcard]");
    }

    /* The visible number is position, not the name index — those diverge as
       soon as anything is removed, and position is what the student sees. */
    function renumber() {
      var all = cards();
      for (var i = 0; i < all.length; i++) {
        var labels = all[i].querySelectorAll("[data-qno]");
        for (var j = 0; j < labels.length; j++) {
          labels[j].textContent = String(i + 1);
        }
        var rm = all[i].querySelector("[data-qremove]");
        /* Never let the last one go: a form with zero questions cannot be
           submitted, and an empty list with an add button is a dead end. */
        if (rm) rm.disabled = all.length < 2;
      }

      var counters = form
        ? form.querySelectorAll("[data-qcount]")
        : wrap.querySelectorAll("[data-qcount]");
      for (var k = 0; k < counters.length; k++) {
        counters[k].textContent = String(all.length);
      }

      addBtn.disabled = all.length >= max;
    }

    function announce(msg) {
      if (live) live.textContent = msg;
    }

    addBtn.addEventListener("click", function () {
      var all = cards();
      if (all.length >= max) return;

      /* importNode over innerHTML: the template's markup is parsed once by the
         browser, and cloning it keeps the file inputs and radios as real
         elements rather than re-parsing a string on every click. */
      var frag = tpl.content
        ? document.importNode(tpl.content, true)
        : null;
      if (!frag) return;

      var idx = nextIndex++;

      /* __I__ appears in name, id and for. Rewriting the attributes rather
         than the serialised HTML avoids touching any user-typed value. */
      var nodes = frag.querySelectorAll("[name], [id], [for]");
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        ["name", "id", "for"].forEach(function (attr) {
          var v = el.getAttribute(attr);
          if (v && v.indexOf("__I__") !== -1) {
            el.setAttribute(attr, v.split("__I__").join(String(idx)));
          }
        });
      }

      var card = frag.querySelector("[data-qcard]");
      list.appendChild(frag);
      renumber();

      /* The clone arrives with the server's default type applied. It still
         has to be initialised: without this its option add/remove buttons
         keep whatever disabled state the template was rendered with. */
      if (card) {
        applyType(card);
        var boxes = card.querySelectorAll("[data-qchoices]");
        for (var b = 0; b < boxes.length; b++) renumberOptions(boxes[b]);
      }

      if (card) {
        var first = card.querySelector("textarea, input[type='text']");
        if (first) first.focus();
        if (card.scrollIntoView) {
          card.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
      announce("تمت إضافة سؤال. عدد الأسئلة الآن " + cards().length + ".");
    });

    /* Delegated so it covers blocks added after load. */
    list.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-qremove]");
      if (!btn || btn.disabled) return;

      var card = btn.closest("[data-qcard]");
      if (!card || cards().length < 2) return;

      /* Only ask when there is something to lose. Confirming the removal of a
         block the admin just added and never typed in is pure friction. */
      var typed = false;
      var vals = card.querySelectorAll("textarea, input[type='text']");
      for (var i = 0; i < vals.length; i++) {
        if (vals[i].value.trim() !== "") {
          typed = true;
          break;
        }
      }
      if (typed && !window.confirm("حذف هذا السؤال وما كُتب فيه؟")) return;

      /* Move focus before the element holding it leaves the document, or the
         browser drops focus to <body> and a keyboard user loses their place. */
      var all = cards();
      var pos = Array.prototype.indexOf.call(all, card);
      var neighbour = all[pos + 1] || all[pos - 1];

      card.parentNode.removeChild(card);
      renumber();

      if (neighbour) {
        var target = neighbour.querySelector("[data-qremove]");
        if (target && !target.disabled) target.focus();
        else {
          var alt = neighbour.querySelector("textarea, input[type='text']");
          if (alt) alt.focus();
        }
      } else {
        addBtn.focus();
      }
      announce("تم حذف السؤال. عدد الأسئلة الآن " + cards().length + ".");
    });

    /* Highlight the row holding the answer key. CSS also does this with
       :has(), so this is only the fallback for browsers without it — both
       are decoration, the checked radio is the actual state. */
    list.addEventListener("change", function (e) {
      var radio = e.target;
      if (!radio || radio.type !== "radio" || !radio.name) return;
      /* _tf as well as _correct: True/False marks its answer the same way. */
      if (radio.name.indexOf("_correct") === -1 && radio.name.indexOf("_tf") === -1) return;

      /* Scoped to the group the radio belongs to, not the whole card — a card
         holds both the multiple-choice rows and the True/False rows, and
         clearing across both would strip the highlight from the group the
         admin is not looking at. */
      var group = radio.closest("[data-qfields]") || radio.closest("[data-qcard]");
      if (!group) return;

      var rows = group.querySelectorAll("[data-qchoice]");
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].querySelector("input[type='radio']");
        rows[i].classList.toggle("qchoice--correct", !!(r && r.checked));
      }
    });

    /* ------------------------------------------------ question types --- */
    /* Each card holds one <fieldset data-qfields="…"> per type, of which
       exactly one is active. Rendered correct by the server, so this only
       ever flips an already-consistent state — which is what makes the form
       work with JavaScript off.

       DISABLED, NOT JUST HIDDEN. The choice boxes and the answer radio carry
       `required`, and a required control that is display:none makes the
       browser refuse to submit on an element it cannot focus: Chrome logs
       "An invalid form control with name='…' is not focusable" and the save
       button does nothing at all, with no message anywhere. disabled exempts
       a control from validation AND drops it from the submission, so the
       server never sees fields belonging to a type the admin switched away
       from either. */
    function cardType(card) {
      var sel = card.querySelector("[data-qtype]");
      return sel ? sel.value : "mcq";
    }

    function applyType(card) {
      var type = cardType(card);

      var groups = card.querySelectorAll("[data-qfields]");
      for (var i = 0; i < groups.length; i++) {
        var on = groups[i].getAttribute("data-qfields") === type;
        groups[i].hidden = !on;
        /* Setting it on the <fieldset> cascades to every control inside,
           which is why the groups are fieldsets and not divs. */
        groups[i].disabled = !on;
      }

      var hints = card.querySelectorAll("[data-qhint]");
      for (var h = 0; h < hints.length; h++) {
        hints[h].hidden = hints[h].getAttribute("data-qhint") !== type;
      }
    }

    list.addEventListener("change", function (e) {
      var sel = e.target;
      if (!sel || !sel.hasAttribute || !sel.hasAttribute("data-qtype")) return;
      var card = sel.closest("[data-qcard]");
      if (card) applyType(card);
    });

    /* ---------------------------------------------- option repeater --- */
    function optionRows(box) {
      return box.querySelectorAll("[data-qchoice]");
    }

    /* Renumber option rows CONTIGUOUSLY, unlike question blocks.
       Question blocks deliberately leave gaps — their name indices only have
       to be unique, and renumbering them would mean rewriting every field in
       the form on every removal. Option rows are different: the server reads
       them in ascending index order, so a freed index reused by a new row
       would place that row first in the saved paper while it sits last on
       screen. The list is at most six inputs, so rewriting it is cheap, and
       keeping index == position means the order the admin sees is the order
       the student gets. */
    function renumberOptions(box) {
      var rows = optionRows(box);
      var min = parseInt(box.getAttribute("data-qmin"), 10) || 2;
      var max = parseInt(box.getAttribute("data-qmax"), 10) || 6;

      /* Read the question index off the type select: its name is exactly
         q_<i>_type, so the capture cannot be thrown off by an index that is
         itself underscore-laden (the <template> renders i as "__I__"). */
      var card = box.closest("[data-qcard]");
      var typeSel = card ? card.querySelector("[data-qtype]") : null;
      var m = /^q_(.+)_type$/.exec(typeSel ? typeSel.getAttribute("name") || "" : "");
      var qIdx = m ? m[1] : null;

      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].querySelector(".qchoice__text");
        var radio = rows[i].querySelector(".qchoice__radio");

        if (qIdx !== null && text) {
          text.name = "q_" + qIdx + "_a" + i;
          text.id = "q_" + qIdx + "_a" + i;
        }
        if (qIdx !== null && radio) {
          /* value is the answer key. Rewriting it while leaving `checked`
             alone is what keeps the marked option marked as rows shift. */
          radio.value = String(i);
          radio.id = "q_" + qIdx + "_c" + i;
          radio.setAttribute("aria-label", "الاختيار " + (i + 1) + " هو الإجابة الصحيحة");
        }

        var label = rows[i].querySelector("[data-qchoiceno]");
        if (label) label.textContent = String(i + 1);

        var lbl = rows[i].querySelector(".qchoice__label");
        if (lbl && text) lbl.setAttribute("for", text.id);

        var rm = rows[i].querySelector("[data-qchoiceremove]");
        if (rm) rm.disabled = rows.length <= min;
      }

      var add = box.querySelector("[data-qchoiceadd]");
      if (add) add.disabled = rows.length >= max;
    }

    list.addEventListener("click", function (e) {
      var add = e.target.closest("[data-qchoiceadd]");
      if (add) {
        if (add.disabled) return;
        var box = add.closest("[data-qchoices]");
        var card = add.closest("[data-qcard]");
        if (!box || !card) return;

        var rows = optionRows(box);
        var max = parseInt(box.getAttribute("data-qmax"), 10) || 6;
        if (rows.length >= max) return;

        /* Clone the last row rather than build markup here: the same reason
           the question template is server-rendered — a hand-written copy
           drifts from the real one the first time a field changes. Naming is
           left to renumberOptions, which owns index == position. */
        var last = rows[rows.length - 1];
        if (!last) return;
        var row = last.cloneNode(true);

        var text = row.querySelector(".qchoice__text");
        if (text) text.value = "";
        var radio = row.querySelector(".qchoice__radio");
        if (radio) radio.checked = false;
        row.classList.remove("qchoice--correct");

        last.parentNode.insertBefore(row, add);
        renumberOptions(box);
        if (text) text.focus();
        announce("تمت إضافة اختيار. عدد الاختيارات الآن " + optionRows(box).length + ".");
        return;
      }

      var rm = e.target.closest("[data-qchoiceremove]");
      if (!rm || rm.disabled) return;

      var rbox = rm.closest("[data-qchoices]");
      var rrow = rm.closest("[data-qchoice]");
      if (!rbox || !rrow) return;

      var min = parseInt(rbox.getAttribute("data-qmin"), 10) || 2;
      if (optionRows(rbox).length <= min) return;

      var val = rrow.querySelector(".qchoice__text");
      if (val && val.value.trim() !== "" && !window.confirm("حذف هذا الاختيار؟")) return;

      /* Removing the row holding the answer key leaves q_<i>_correct with no
         checked radio at all. That is the right outcome — silently promoting
         another option to "correct" would publish an answer key nobody
         chose — and the field is `required`, so the browser stops the admin
         at the question rather than letting it save unmarked. */
      var wasCorrect = rrow.querySelector(".qchoice__radio");
      var lost = !!(wasCorrect && wasCorrect.checked);

      var siblings = optionRows(rbox);
      var at = Array.prototype.indexOf.call(siblings, rrow);
      var next = siblings[at + 1] || siblings[at - 1];

      rrow.parentNode.removeChild(rrow);
      renumberOptions(rbox);

      if (next) {
        var focusTarget = next.querySelector(".qchoice__text");
        if (focusTarget) focusTarget.focus();
      }
      announce(
        lost
          ? "تم حذف الاختيار الصحيح. علّم الإجابة الصحيحة من جديد."
          : "تم حذف الاختيار. عدد الاختيارات الآن " + optionRows(rbox).length + "."
      );
    });

    /* Two identical choices make the paper ambiguous: the answer key is stored
       as text, so a student picking either one is marked correct. Caught here
       as well as on the server, because catching it after a redirect means
       re-reading a form of twenty questions to find the pair. */
    if (form) {
      form.addEventListener("submit", function (e) {
        var all = cards();
        for (var i = 0; i < all.length; i++) {
          /* MULTIPLE CHOICE ONLY. Every True/False question shares the same
             two option strings by design, so an unscoped check would fire on
             the second one the admin adds and block a perfectly valid form. */
          if (cardType(all[i]) !== "mcq") continue;

          var boxes = all[i].querySelectorAll(".qchoice__text");
          var seen = {};
          for (var j = 0; j < boxes.length; j++) {
            var v = boxes[j].value.trim();
            if (!v) continue;
            if (seen[v]) {
              e.preventDefault();
              announce("");
              window.alert(
                "السؤال " + (i + 1) + ": الاختيار «" + v + "» مكرر. " +
                "اجعل كل اختيار مختلفًا عن غيره."
              );
              boxes[j].focus();
              return;
            }
            seen[v] = true;
          }
        }
      });
    }

    renumber();

    /* Bring every server-rendered card into a known state — including the
       option add/remove buttons, whose disabled state depends on how many
       rows came back from the server. */
    (function initCards() {
      var all = cards();
      for (var i = 0; i < all.length; i++) {
        applyType(all[i]);
        var boxes = all[i].querySelectorAll("[data-qchoices]");
        for (var b = 0; b < boxes.length; b++) renumberOptions(boxes[b]);
      }
    })();
  })();

  /* ------------------------------------------------------------- reveal --- */
  /* CSS hides .reveal only under `.js`, so if this file 404s or throws before
     here the content is simply visible. When reduced motion is requested or
     IntersectionObserver is missing, everything is revealed at once rather
     than left hidden — failing open, not closed. */
  var targets = document.querySelectorAll(".reveal");
  if (!targets.length) return;

  var reduced =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function revealAll() {
    for (var i = 0; i < targets.length; i++) {
      targets[i].classList.add("is-visible");
    }
  }

  if (reduced || !("IntersectionObserver" in window)) {
    revealAll();
    return;
  }

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        io.unobserve(entry.target); /* don't re-animate on scroll-up */
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
  );

  for (var j = 0; j < targets.length; j++) {
    io.observe(targets[j]);
  }

  /* A stat card that is already in view on load with the sticky topbar over it
     can miss its first callback in some browsers; nudge after paint. */
  requestAnimationFrame(function () {
    for (var k = 0; k < targets.length; k++) {
      var r = targets[k].getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        targets[k].classList.add("is-visible");
        io.unobserve(targets[k]);
      }
    }
  });
})();
