/*
  Assessment flow behaviour — loaded by quiz-paper.ejs only.

  Two jobs: the countdown on a timed paper, and an unanswered-question warning
  before submit. Everything else on these pages is CSS or plain HTML.

  This replaces public/startQuizNew/js/script.js (a CodingNepal demo engine
  that threw on load because it dereferenced `.buttons .restart`, an element
  the markup never contained, and read a questions.js that is not on disk) and
  public/show answer/script.js (a zero-byte file).

  Loaded with `defer`, so the DOM is parsed before this runs.
*/
(function () {
  "use strict";

  /* ------------------------------------------------------------- timer ----
     The old page inlined this in the template and read its starting value out
     of a module-level `let d` in the router — one variable shared by every
     student on the server. Two students taking a quiz at once decremented the
     same counter, and a student opening a paper saw whatever was left of
     someone else's attempt. The deadline is now computed per attempt, stored
     on the student's own degree record, and rendered into data-seconds. */
  var timer = document.querySelector("[data-timer]");
  var form = document.querySelector("[data-paper-form]");

  if (timer && form) {
    var clock = timer.querySelector("[data-clock]");
    var bar = timer.querySelector("[data-bar]");
    var total = Number(timer.getAttribute("data-total")) || 0;
    var left = Number(timer.getAttribute("data-seconds")) || 0;

    /* Anchor to the wall clock rather than counting setInterval ticks. A
       background tab throttles timers to roughly once a minute, so a tick
       count drifts badly — the student would see far more time than they
       have, then be cut off without warning. */
    var endsAt = Date.now() + left * 1000;
    var submitted = false;

    var pad = function (n) {
      return n < 10 ? "0" + n : String(n);
    };

    var expire = function () {
      if (submitted) return;
      submitted = true;
      clock.textContent = "00:00:00";
      /* Submit what they have. The old page stopped the clock and did nothing
         else, so a student who ran out of time simply sat on a dead page and
         lost every answer unless they happened to press the button. */
      form.submit();
    };

    var tick = function () {
      var secs = Math.max(0, Math.round((endsAt - Date.now()) / 1000));

      var h = Math.floor(secs / 3600);
      var m = Math.floor((secs % 3600) / 60);
      var s = secs % 60;
      clock.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);

      if (bar && total > 0) {
        bar.style.inlineSize = (secs / total) * 100 + "%";
      }

      /* Last minute, or the last 10% on a short paper. */
      timer.classList.toggle(
        "paper__timer--low",
        secs <= Math.max(60, total * 0.1)
      );

      if (secs <= 0) {
        clearInterval(handle);
        expire();
      }
    };

    tick();
    var handle = setInterval(tick, 1000);
  }

  /* --------------------------------------------------- unanswered warning --
     Advisory only. It never prevents submission: a student may deliberately
     leave a question blank, and blocking them would be worse than a wrong
     answer. It just makes "I thought I answered that one" less likely.

     Not `required` on the inputs either — that WOULD block submission, and on
     a timed paper the auto-submit above has to succeed regardless. */
  if (form) {
    var questions = Array.prototype.slice.call(
      form.querySelectorAll("[data-question]")
    );
    var counter = form.querySelector("[data-answered]");
    var warn = form.querySelector("[data-warn]");
    var confirmed = false;

    var unanswered = function () {
      return questions.filter(function (q) {
        return !q.querySelector("input[type=radio]:checked");
      });
    };

    var refresh = function () {
      var done = questions.length - unanswered().length;
      if (counter) counter.textContent = String(done);
      /* Clear the flags as soon as a blank question is filled in, rather than
         leaving the page marked up until the next submit attempt. */
      if (warn && !warn.hidden && unanswered().length === 0) {
        warn.hidden = true;
        questions.forEach(function (q) {
          q.classList.remove("is-missing");
        });
      }
    };

    form.addEventListener("change", refresh);
    refresh();

    form.addEventListener("submit", function (e) {
      var blanks = unanswered();
      if (blanks.length === 0 || confirmed) return;

      e.preventDefault();
      confirmed = true; /* a second press goes through */

      questions.forEach(function (q) {
        q.classList.remove("is-missing");
      });
      blanks.forEach(function (q) {
        q.classList.add("is-missing");
      });

      if (warn) {
        warn.hidden = false;
        warn.querySelector("[data-warn-count]").textContent = String(
          blanks.length
        );
      }

      /* Take them to the first blank question so the warning is actionable. */
      blanks[0].scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "center"
      });
    });
  }
})();
