/* ===========================================================
   app.js — shared interactivity for French Pronounce
   Used by every page. Loaded with <script src="/app.js" defer>.
   The content itself lives in each page's HTML (so it's crawlable);
   this file just makes the tiles clickable.
   =========================================================== */

(function () {
  "use strict";

  var currentRate = 1;
  var frVoice = null;

  function warn(msg) {
    var el = document.getElementById("voiceWarning");
    if (!el) return;
    el.hidden = false;
    if (msg) el.textContent = msg;
  }

  function pickVoice() {
    var voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    frVoice = null;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].lang && voices[i].lang.toLowerCase().indexOf("fr") === 0) {
        frVoice = voices[i];
        break;
      }
    }
    if (voices.length && !frVoice) warn();
  }

  if ("speechSynthesis" in window) {
    speechSynthesis.onvoiceschanged = pickVoice;
    pickVoice();
  } else {
    warn("Your browser doesn’t support speech playback. Try Chrome, Edge, or Safari.");
  }

  var lastTile = null;
  function speak(text, tileEl) {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "fr-FR";
    if (frVoice) u.voice = frVoice;
    u.rate = currentRate;
    if (lastTile) lastTile.classList.remove("speaking");
    if (tileEl) {
      tileEl.classList.add("speaking");
      lastTile = tileEl;
      u.onend = function () { tileEl.classList.remove("speaking"); };
    }
    speechSynthesis.speak(u);
  }

  // Wire up every element that has data-say
  var sayEls = document.querySelectorAll("[data-say]");
  for (var i = 0; i < sayEls.length; i++) {
    (function (el) {
      el.addEventListener("click", function () {
        speak(el.getAttribute("data-say"), el.closest(".tile"));
      });
    })(sayEls[i]);
  }

  // Tabs
  var tabs = document.querySelectorAll(".tab");
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener("click", function () {
      var allTabs = document.querySelectorAll(".tab");
      for (var k = 0; k < allTabs.length; k++) allTabs[k].classList.remove("active");
      var panels = document.querySelectorAll(".panel");
      for (var p = 0; p < panels.length; p++) panels[p].classList.remove("active");
      this.classList.add("active");
      var target = document.getElementById(this.getAttribute("data-panel"));
      if (target) target.classList.add("active");
    });
  }

  // Speed buttons
  var pills = document.querySelectorAll(".pill");
  for (var s = 0; s < pills.length; s++) {
    pills[s].addEventListener("click", function () {
      var allPills = document.querySelectorAll(".pill");
      for (var k = 0; k < allPills.length; k++) allPills[k].classList.remove("active");
      this.classList.add("active");
      currentRate = parseFloat(this.getAttribute("data-rate"));
    });
  }
})();
