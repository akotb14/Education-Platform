/*
  Assessment flow behaviour — loaded by quiz-paper.ejs only.

  Four jobs: the countdown on a timed paper, the question navigation pad, the
  answered tally, and the submit confirmation. Everything else on these pages is
  CSS or plain HTML.

  This replaces public/startQuizNew/js/script.js (a CodingNepal demo engine
  that threw on load because it dereferenced `.buttons .restart`, an element
  the markup never contained, and read a questions.js that is not on disk) and
  public/show answer/script.js (a zero-byte file).

  Loaded with `defer`, so the DOM is parsed before this runs.

  NOTHING HERE IS A SECURITY CONTROL. The countdown is a courtesy: it renders a
  deadline the server already stored on this student's own attempt record, and
  the server compares that deadline against the moment the answers actually
  arrive (util/attemptTime.js). Clearing this interval in the console, moving the
  machine clock, or reloading the page changes what is on screen and nothing
  about what is enforced — a submission past the deadline is recorded as late.
*/
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* --------------------------------------------------- the bar's height ----
     ONE measured number for how tall the assessment bar is, published as
     --abar-h on <html> and read by three things that each used to guess:

       .q's scroll-margin-block-start   was a flat 8rem
       html's scroll-padding           was --header-h + --sp-4, sized for the
                                       site header, not for this bar
       the observer's rootMargin       was a flat -140px

     The three disagreed with each other and none matched the real bar, which is
     a different height on an untimed paper (no progress hairline), on a
     single-question paper (no pad row), and under 560px where the first row
     wraps to two lines.

     THIS IS NOT REPOSITIONING THE HEADER. The bar's placement is pure CSS
     sticky and no code here writes to its style, its position or its offsets —
     the brief's "do not use JavaScript to repeatedly reposition the header"
     stands. What is computed is how far to hold the CONTENT clear of it, which
     is the other half of the same requirement: nothing hidden underneath.

     Measured on load and on resize only. Not on scroll: the bar's height does
     not change when the page scrolls, and a per-frame write to a custom property
     that every .q reads would invalidate layout on every frame. */
  var abar = document.querySelector("[data-abar]");

  var syncBarHeight = function () {
    if (!abar) return;
    /* getBoundingClientRect over offsetHeight: it is fractional, so a bar that
       lands on 92.5px does not round to 92 and leave half a pixel of a question
       showing under the border. */
    var h = Math.ceil(abar.getBoundingClientRect().height);
    if (h > 0) {
      document.documentElement.style.setProperty("--abar-h", h + "px");
    }
  };

  syncBarHeight();

  if (abar && "ResizeObserver" in window) {
    /* Covers everything that can change the height without a resize event: the
       pad's scrollbar appearing, a webfont swapping in, the phone's address bar
       collapsing. The CSS fallback (8rem) holds until this first fires. */
    new ResizeObserver(syncBarHeight).observe(abar);
  } else {
    window.addEventListener("resize", syncBarHeight);
  }

  var scrollTo = function (el) {
    el.scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      /* "start", not "center": every .q carries a scroll-margin-block-start
         sized for the sticky assessment bar, and that margin only applies to
         the start edge. Centring would ignore it and could put the question
         under the bar on a tall card. */
      block: "start"
    });
  };

  var form = document.querySelector("[data-paper-form]");
  var questions = form
    ? Array.prototype.slice.call(form.querySelectorAll("[data-question]"))
    : [];

  /* Is this question answered? An essay counts when something has been typed —
     it has no radios at all, and without this branch every written question
     stays permanently in the blank count and the warning fires on a finished
     paper. Used by the pad, the tally and the confirmation alike, so the three
     can never disagree about what "answered" means. */
  var isAnswered = function (q) {
    var written = q.querySelector("[data-written]");
    if (written) return written.value.trim() !== "";
    return !!q.querySelector("input[type=radio]:checked");
  };

  /* ------------------------------------------------------------- timer ----
     The old page inlined this in the template and read its starting value out
     of a module-level `let d` in the router — one variable shared by every
     student on the server. Two students taking a quiz at once decremented the
     same counter, and a student opening a paper saw whatever was left of
     someone else's attempt. The deadline is now computed per attempt, stored
     on the student's own degree record, and rendered into data-seconds. */
  var timer = document.querySelector("[data-timer]");

  if (timer && form) {
    var clock = timer.querySelector("[data-clock]");
    var bar = document.querySelector("[data-bar]");
    /* The live region is a sibling of the timer, not a child: the timer itself
       is aria-live="off" because a region that changes every second is read
       continuously and makes the page unusable with a screen reader. State
       changes are announced here instead, once each. */
    var say = document.querySelector("[data-timer-say]");
    var total = Number(timer.getAttribute("data-total")) || 0;
    var left = Number(timer.getAttribute("data-seconds")) || 0;

    /* Anchor to the wall clock rather than counting setInterval ticks. A
       background tab throttles timers to roughly once a minute, so a tick
       count drifts badly — the student would see far more time than they
       have, then be cut off without warning. */
    var endsAt = Date.now() + left * 1000;
    var submitted = false;
    var state = "";

    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };

    var expire = function () {
      if (submitted) return;
      submitted = true;
      clock.textContent = "00:00";
      /* Submit what they have, and do it with form.submit() rather than by
         clicking the button: submit() does not fire the submit event, so it
         bypasses the confirmation below. At zero there is nothing to confirm.

         The old page stopped the clock and did nothing else, so a student who
         ran out of time sat on a dead page and lost every answer unless they
         happened to press the button. */
      form.submit();
    };

    /* THE THREE STATES the brief asks for. There was one before (--low, at the
       last minute), so a paper went from "plenty of time" straight to red.

         normal  quiet, and deliberately so — a clock that shouts for twenty
                 minutes stops being read
         low     last quarter of the allowance, floor 5 minutes: "keep an eye
                 on it"
         crit    last minute, or the last tenth on a short paper

       Thresholds are fractions of the allowance with an absolute floor, so a
       ten-minute quiz and a three-hour exam both warn at a useful moment: a
       flat 60s would be most of a short paper's remaining time, and a flat
       quarter of a three-hour exam is 45 minutes of red. */
    var stateFor = function (secs) {
      if (secs <= Math.max(60, total * 0.1)) return "crit";
      if (secs <= Math.max(300, total * 0.25)) return "low";
      return "";
    };

    var SAY = {
      low: "تنبيه: الوقت المتبقي أقل من الربع.",
      crit: "تحذير: الوقت المتبقي أقل من دقيقة."
    };

    var setState = function (next) {
      if (next === state) return;
      state = next;

      timer.classList.toggle("abar__timer--low", next === "low");
      timer.classList.toggle("abar__timer--crit", next === "crit");
      if (bar) {
        bar.classList.toggle("abar__bar--low", next === "low");
        bar.classList.toggle("abar__bar--crit", next === "crit");
      }

      /* Announced once on entry, so the state is not carried by colour alone.
         The digits are always present too — three signals, none of them
         load-bearing on its own. */
      if (say && SAY[next]) say.textContent = SAY[next];
    };

    var tick = function () {
      var secs = Math.max(0, Math.round((endsAt - Date.now()) / 1000));

      var h = Math.floor(secs / 3600);
      var m = Math.floor((secs % 3600) / 60);
      var s = secs % 60;
      /* MM:SS under an hour, H:MM:SS over it. The old format was always
         HH:MM:SS, so a twenty-minute quiz read "00:19:44" — three of its eight
         characters carrying no information, on the one element that has to be
         legible at a glance. */
      clock.textContent = h > 0
        ? h + ":" + pad(m) + ":" + pad(s)
        : pad(m) + ":" + pad(s);

      if (bar && total > 0) {
        bar.style.inlineSize = (secs / total) * 100 + "%";
      }

      setState(stateFor(secs));

      if (secs <= 0) {
        clearInterval(handle);
        expire();
      }
    };

    tick();
    var handle = setInterval(tick, 1000);
  }

  /* ------------------------------------------------- navigation and tally --
     The pad in the assessment bar, "السؤال N من M", and the answered count in
     the foot. There was no question navigation on this page before — only the
     count, at the bottom of a long paper — so this is the "many questions"
     case rather than a second copy of something that already existed.

     The pad is only rendered when there is more than one question; every
     lookup below is guarded because of that. */
  if (form && questions.length) {
    var counter = form.querySelector("[data-answered]");
    var answeredBar = form.querySelector("[data-answered-bar]");
    var warn = form.querySelector("[data-warn]");
    var posNow = document.querySelector("[data-qnow]");
    var jumps = Array.prototype.slice.call(
      document.querySelectorAll("[data-qjump]")
    );

    var current = 0;

    var unanswered = function () {
      return questions.filter(function (q) {
        return !isAnswered(q);
      });
    };

    /* Paint the pad: answered, current, or untouched. The state also goes into
       each button's own .sr-only span as words — a pad of twenty numbered chips
       tells a screen reader nothing on its own, and aria-current alone does not
       convey "answered". */
    var paintNav = function () {
      jumps.forEach(function (btn, i) {
        var q = questions[i];
        if (!q) return;

        var done = isAnswered(q);
        var now = i === current;

        btn.classList.toggle("qnav__item--done", done);
        btn.classList.toggle("qnav__item--now", now);

        if (now) {
          btn.setAttribute("aria-current", "true");
        } else {
          btn.removeAttribute("aria-current");
        }

        var label = btn.querySelector("[data-qjump-state]");
        if (label) {
          label.textContent =
            (done ? "تم الإجابة" : "بدون إجابة") + (now ? " — السؤال الحالي" : "");
        }
      });

      /* Declared below with the step buttons; hoisted, and guarded there on the
         buttons existing, so calling it from here is safe on a paper with no
         pad. */
      syncSteps();
    };

    var setCurrent = function (i) {
      if (i === current) return;
      current = i;
      if (posNow) posNow.textContent = String(i + 1);
      questions.forEach(function (q, n) {
        q.classList.toggle("is-current", n === i);
      });
      paintNav();
    };

    var refresh = function () {
      var blanks = unanswered();
      var done = questions.length - blanks.length;

      if (counter) counter.textContent = String(done);
      if (answeredBar) {
        answeredBar.style.inlineSize =
          (done / questions.length) * 100 + "%";
      }

      /* Clear the flags as soon as the last blank is filled in, rather than
         leaving the page marked up until the next submit attempt. */
      if (warn && !warn.hidden && blanks.length === 0) {
        warn.hidden = true;
        questions.forEach(function (q) {
          q.classList.remove("is-missing");
        });
      }

      paintNav();
    };

    form.addEventListener("change", refresh);
    /* A textarea fires `change` only on blur, so the written questions would
       not update the counter until focus left them. `input` covers typing;
       both are wired because `change` is what the radios fire. */
    form.addEventListener("input", refresh);

    /* A DELIBERATE JUMP OUTRANKS THE OBSERVER, and without this it did not.

       The observer below derives the current question from what is on screen.
       A jump does two things — sets the current question, then scrolls to it —
       and the scroll ANIMATES, because scroll-behavior is smooth. So the
       observer fired part-way through the animation, saw that the question the
       student was leaving was still inside its root margin, and set `current`
       straight back.

       Measured, before this lock: clicking chip 2 left `data-qnow` reading 1
       with the marker and the pad's --now chip still on question 1; next needed
       two presses per question (2, 2, 3, 3, 4, 4 …); next never disabled on the
       last question and prev stayed disabled on the first. The bar's geometry
       was never affected — this was the state inside it being wrong.

       A token counter rather than a boolean, so a second jump made during the
       first one's animation supersedes it instead of having its lock released
       early by the older poll. Released when the scroll position has held for
       three frames — the same test as "the animation has ended" — with a 1.2s
       ceiling so a jump interrupted by the student's own wheel can never leave
       the observer switched off. Not a fixed timeout: a smooth scroll's duration
       depends on the distance.

       Deliberately NOT the `scrollend` event, which Safari does not have.

       Nothing here touches the bar: the bar is sticky, it is already at the top
       of the viewport, and scrolling the page cannot move it. */
    var navLock = 0;

    var lockNav = function () {
      var token = ++navLock;
      var last = null;
      var same = 0;
      var t0 = Date.now();

      var tick = function () {
        /* A newer jump owns the lock now; let its own poll release it. */
        if (token !== navLock) return;

        var y = Math.round(window.pageYOffset);
        same = y === last ? same + 1 : 0;
        last = y;

        /* The 150ms floor closes a race, it is not padding. A smooth scroll does
           not move on the frame it is requested — it starts on a later one — so
           polling for "held three frames" from the instant of the request can see
           the ORIGIN held three times and release the lock before the scroll has
           begun, which is the whole thing the lock exists to prevent. The same
           race in the verification harness made one assertion pass at two
           viewports and fail at the third. A press that does not move the page at
           all (jumping to the question already at the top) therefore holds the
           lock for 150ms, which no one can perceive and nothing depends on. */
        if ((same >= 3 && Date.now() - t0 > 150) || Date.now() - t0 > 1200) {
          navLock = 0;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    /* A jump sets the current question and scrolls to it. */
    jumps.forEach(function (btn, i) {
      btn.addEventListener("click", function () {
        var q = questions[i];
        if (!q) return;
        lockNav();
        setCurrent(i);
        scrollTo(q);
      });
    });

    /* ------------------------------------------------------ previous / next --
       A step through the paper for a student who does not want to aim at a 34px
       chip, and the only navigation that works on a long paper where the chip
       for question 14 is off the end of the pad's scroll.

       Both are disabled at the ends rather than wrapping: `disabled` is a real
       state a screen reader announces and Tab skips, so a keyboard student is
       never sent to a control that does nothing. Kept in step with the current
       question by syncSteps, which paintNav calls — so the buttons update from a
       scroll as well as from a click.

       They scroll, exactly as a chip does. Nothing here writes to the bar. */
    var prevBtn = document.querySelector("[data-qprev]");
    var nextBtn = document.querySelector("[data-qnext]");

    var syncSteps = function () {
      if (prevBtn) prevBtn.disabled = current <= 0;
      if (nextBtn) nextBtn.disabled = current >= questions.length - 1;
    };

    var step = function (delta) {
      var i = current + delta;
      if (i < 0 || i >= questions.length) return;
      /* Same lock as a chip, for the same reason — see lockNav above. This is
         the path where the symptom was most visible: without it, next advanced
         `current` and the observer put it straight back, so the student pressed
         next twice for every question. */
      lockNav();
      setCurrent(i);
      scrollTo(questions[i]);
    };

    if (prevBtn) {
      prevBtn.addEventListener("click", function () {
        step(-1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function () {
        step(1);
      });
    }

    /* Which question is the student looking at? An IntersectionObserver rather
       than a scroll handler: the callback fires only when a question crosses
       the line, instead of on every scroll frame.

       rootMargin lifts the top of the observed area clear of the sticky bar
       (which would otherwise mean the "visible" question is the one hidden
       behind it) and pulls the bottom up, so the current question is the one in
       the upper part of the viewport rather than whichever last touched the
       fold.

       The top inset is the MEASURED bar height, not the -140px guess that used
       to be here — same number the scroll offsets use, so "the question under
       the bar" means the same thing to the observer as it does to a pad jump. */
    if ("IntersectionObserver" in window) {
      var seen = new WeakMap();
      var barH = abar ? Math.ceil(abar.getBoundingClientRect().height) : 0;
      var io = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            seen.set(e.target, e.isIntersecting);
          });
          /* A jump in progress owns `current`. The entries are still recorded
             above, so when the lock lifts the map is already up to date and the
             next real scroll is judged on current facts — only the write is
             skipped, not the bookkeeping. */
          if (navLock) return;

          /* The first question in document order that is on screen — reading
             order, so scrolling up and scrolling down agree on the answer. */
          for (var i = 0; i < questions.length; i++) {
            if (seen.get(questions[i])) {
              setCurrent(i);
              return;
            }
          }
        },
        { rootMargin: -(barH || 140) + "px 0px -55% 0px", threshold: 0 }
      );
      questions.forEach(function (q) {
        io.observe(q);
      });
    }

    /* First paint. setCurrent(0) would return early — `current` is already 0 —
       so the initial state is painted directly. */
    if (posNow) posNow.textContent = "1";
    questions[0].classList.add("is-current");
    refresh();

    /* ------------------------------------------------- submit confirmation --
       Handing in is irreversible: one attempt, no re-entry. So it asks, on both
       paths — with blanks it says how many, and with everything answered it
       still confirms.

       WHAT THIS REPLACES: the first press used to preventDefault() and set a
       flag, and the student had to press the same button again. Nothing said a
       second press was needed, and with every question answered there was no
       confirmation at all.

       Still not `required` on any input: that would block submission, and the
       timed auto-submit above has to succeed with blanks. This handler is
       bypassed by form.submit() at zero for the same reason. */
    var dlg = document.querySelector("[data-confirm]");
    var dlgText = dlg ? dlg.querySelector("[data-confirm-text]") : null;
    var yes = dlg ? dlg.querySelector("[data-confirm-yes]") : null;
    var no = dlg ? dlg.querySelector("[data-confirm-no]") : null;
    var opener = null;

    var closeDlg = function () {
      if (!dlg || dlg.hidden) return;
      dlg.hidden = true;
      /* Focus goes back where it came from, or the student is left at the top
         of the document with no idea where they were. */
      if (opener && document.contains(opener)) opener.focus();
    };

    if (dlg && dlgText && yes && no) {
      form.addEventListener("submit", function (e) {
        /* Not open yet — open it and hold the submit. Once the student agrees,
           form.submit() is called directly, which does not fire this event.

           NO BODY SCROLL LOCK. The obvious way to stop the page scrolling behind
           an overlay is overflow:hidden on <body>, and it is the wrong move here:
           it removes the scrollbar, the viewport gets ~15px wider, and every
           centred max-width block on the page — the bar's own inner row included
           — shifts sideways as the dialog opens. That is precisely the "header
           dimensions and position must remain stable when opening/closing the
           submit confirmation modal" case. The overlay is position:fixed and
           covers the page, so there is nothing to click behind it anyway. */
        e.preventDefault();

        var blanks = unanswered();

        questions.forEach(function (q) {
          q.classList.remove("is-missing");
        });

        if (blanks.length) {
          blanks.forEach(function (q) {
            q.classList.add("is-missing");
          });
          /* The wordings live on the element in the template, so the Arabic
             stays with the rest of the page's Arabic. */
          dlgText.textContent = (
            dlg.getAttribute("data-msg-blanks") || ""
          ).replace("{n}", String(blanks.length));
        } else {
          dlgText.textContent = dlg.getAttribute("data-msg-all") || "";
        }

        opener = document.activeElement;
        dlg.hidden = false;
        /* Cancel is focused, not submit: the safe option should be the one an
           absent-minded Enter press takes. */
        no.focus();
      });

      yes.addEventListener("click", function () {
        dlg.hidden = true;
        form.submit();
      });

      no.addEventListener("click", function () {
        var blanks = unanswered();
        closeDlg();

        /* Cancelling with blanks left is the case the foot warning is for: it
           says how many and the questions stay flagged, so the student can act
           on it after the dialog is gone. */
        if (blanks.length && warn) {
          warn.hidden = false;
          var wc = warn.querySelector("[data-warn-count]");
          if (wc) wc.textContent = String(blanks.length);
        }
        if (blanks.length) scrollTo(blanks[0]);
      });

      dlg.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeDlg();
      });

      /* A click on the backdrop cancels, same as pressing "back to review".
         Guarded on the target being the overlay itself so a click inside the
         panel does not close it. */
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeDlg();
      });
    }
  }
})();
