/* ===========================================================
   flashcards.js — French Pronounce flashcard maker
   - Paste or upload French words
   - Auto-translate to English (free MyMemory API, best effort)
   - Guess le/la gender from word endings
   - Swipeable cards with pronunciation + a spelling drill
   Everything runs in the browser; the deck lives in localStorage.
   =========================================================== */

(function () {
  "use strict";

  // ---------- element handles ----------
  var $ = function (id) { return document.getElementById(id); };
  var inputPanel = $("inputPanel"), deckPanel = $("deckPanel");
  var pasteBox = $("pasteBox"), csvFile = $("csvFile"), createBtn = $("createBtn");
  var autoTranslateCb = $("autoTranslate"), guessGenderCb = $("guessGender");
  var inputMsg = $("inputMsg"), translateStatus = $("translateStatus"), progressEl = $("progress");
  var cardsMode = $("cardsMode"), spellMode = $("spellMode");
  var cardEl = $("card"), cardArticle = $("cardArticle"), cardFrench = $("cardFrench"),
      cardEnglish = $("cardEnglish"), cardSpeak = $("cardSpeak");
  var prevBtn = $("prevBtn"), nextBtn = $("nextBtn"), flipBtn = $("flipBtn");
  var shuffleBtn = $("shuffleBtn"), restartBtn = $("restartBtn");
  var spellEnglish = $("spellEnglish"), spellInput = $("spellInput"), spellHear = $("spellHear"),
      spellCheck = $("spellCheck"), spellSkip = $("spellSkip"),
      spellFeedback = $("spellFeedback"), spellScore = $("spellScore");

  // ---------- state ----------
  var deck = [];          // [{fr, en, userEn, gender, genderSource}]
  var idx = 0;
  var flipped = false;
  var mode = "cards";
  var translating = false;
  var autoTranslateOn = true, guessGenderOn = true;

  // ---------- speech ----------
  var frVoice = null;
  function pickVoice() {
    var v = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    frVoice = null;
    for (var i = 0; i < v.length; i++) {
      if (v[i].lang && v[i].lang.toLowerCase().indexOf("fr") === 0) { frVoice = v[i]; break; }
    }
    if (v.length && !frVoice) { var w = $("voiceWarning"); if (w) w.hidden = false; }
  }
  if ("speechSynthesis" in window) { speechSynthesis.onvoiceschanged = pickVoice; pickVoice(); }
  function speak(t) {
    if (!("speechSynthesis" in window) || !t) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t);
    u.lang = "fr-FR";
    if (frVoice) u.voice = frVoice;
    speechSynthesis.speak(u);
  }

  // ---------- helpers ----------
  function decodeEntities(s) {
    var t = document.createElement("textarea");
    t.innerHTML = s;
    return t.value;
  }
  function norm(s) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }
  function stripAccents(s) { return norm(s).normalize("NFD").replace(/[̀-ͯ]/g, ""); }

  function splitCSVLine(line) {
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim().replace(/^"|"$/g, ""); });
  }

  // Guess grammatical gender from the word ending. Approximate!
  var FEM_ENDINGS = ["tion","sion","aison","ison","ité","té","tié","ée","ande","ance","ence",
                     "ette","elle","esse","ère","ere","ie","ine","ure","ude","euse"];
  var MASC_ENDINGS = ["age","ment","eau","isme","ail","ier","in","on","eur","oir","ou","al","if","er","o"];
  function guessGender(word) {
    var w = word.toLowerCase();
    if (w.indexOf(" ") !== -1 || w.length < 2) return null; // phrases: skip
    var i;
    for (i = 0; i < FEM_ENDINGS.length; i++) if (w.slice(-FEM_ENDINGS[i].length) === FEM_ENDINGS[i]) return "f";
    for (i = 0; i < MASC_ENDINGS.length; i++) if (w.slice(-MASC_ENDINGS[i].length) === MASC_ENDINGS[i]) return "m";
    return null;
  }

  // Detect and strip a leading article, returning {base, gender}
  function stripArticle(fr) {
    var m = fr.match(/^(l['’]|le |la |les |un |une |des |du )\s*/i);
    if (!m) return { base: fr, gender: null };
    var art = m[1].trim().toLowerCase().replace("’", "'");
    var base = fr.slice(m[0].length).trim();
    var gender = null;
    if (art === "le" || art === "un" || art === "du") gender = "m";
    else if (art === "la" || art === "une") gender = "f";
    // l', les, des => plural/elided, gender unknown
    return { base: base || fr, gender: gender };
  }

  function isHeaderLine(fr) {
    var w = norm(fr);
    return w === "french" || w === "word" || w === "mot" || w === "words" || w === "français";
  }

  // Build card objects from pasted/CSV text
  function buildCards(text) {
    var lines = text.split(/\r?\n/);
    var seen = {}, cards = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      var parts;
      if (line.indexOf("\t") !== -1) parts = line.split("\t");
      else if (line.indexOf("=") !== -1) parts = line.split("=");
      else if (/ - | – /.test(line)) parts = line.split(/ - | – /);
      else if (line.indexOf(",") !== -1) parts = splitCSVLine(line);
      else parts = [line];
      parts = parts.map(function (s) { return s.trim(); });

      var fr = parts[0];
      if (!fr) continue;
      var en = parts[1] || "";
      var genderCol = (parts[2] || "").trim().toLowerCase();

      if (isHeaderLine(fr)) continue; // skip a CSV header row

      // pull gender/base out of a leading article
      var sa = stripArticle(fr);
      fr = sa.base;
      var gender = null, genderSource = null;

      if (genderCol) {
        if (genderCol[0] === "m") { gender = "m"; genderSource = "user"; }
        else if (genderCol[0] === "f") { gender = "f"; genderSource = "user"; }
      }
      if (!gender && sa.gender) { gender = sa.gender; genderSource = "user"; }
      if (!gender && guessGenderOn) {
        var g = guessGender(fr);
        if (g) { gender = g; genderSource = "guess"; }
      }

      var key = fr.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;

      cards.push({ fr: fr, en: en, userEn: !!en, gender: gender, genderSource: genderSource });
      if (cards.length >= 1000) break; // safety cap
    }
    return cards;
  }

  // ---------- article display ----------
  function articleInfo(card) {
    if (!card.gender) return { text: "", est: false };
    // if it's clearly a verb ("to ...") and gender was only guessed, don't show an article
    if (card.genderSource === "guess" && card.en && /^to\s/i.test(card.en.trim())) {
      return { text: "", est: false };
    }
    var startsVowel = /^[aeiouyàâäéèêëîïôöûü]/i.test(card.fr) || /^h/i.test(card.fr);
    var def, indef;
    if (card.gender === "m") { def = startsVowel ? "l'" : "le"; indef = "un"; }
    else { def = startsVowel ? "l'" : "la"; indef = "une"; }
    return { text: def + " · " + indef, est: card.genderSource === "guess" };
  }

  // ---------- translation (MyMemory, best effort) ----------
  function translateWord(fr) {
    var cacheKey = "fp_tr_" + fr.toLowerCase();
    try { var c = localStorage.getItem(cacheKey); if (c !== null) return Promise.resolve(c); } catch (e) {}
    var url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(fr) +
              "&langpair=fr|en&de=frenchpronounce70@gmail.com";
    return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
      var en = (data && data.responseData && data.responseData.translatedText) || "";
      if (/MYMEMORY WARNING|YOU USED ALL|INVALID|QUOTA/i.test(en)) { var err = new Error("limit"); throw err; }
      en = decodeEntities(en).trim();
      try { localStorage.setItem(cacheKey, en); } catch (e2) {}
      return en;
    });
  }

  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

  function runTranslations() {
    var pending = deck.filter(function (c) { return !c.en; });
    if (!autoTranslateOn || pending.length === 0) { translateStatus.hidden = true; return; }
    translating = true;
    translateStatus.hidden = false;
    var total = pending.length, done = 0, failed = 0, stop = false;
    var update = function () {
      translateStatus.textContent = "Translating " + done + " / " + total +
        (failed ? (" · " + failed + " failed") : "");
    };
    update();
    var queue = pending.slice();
    var worker = function () {
      return (function loop() {
        if (!queue.length || stop) return Promise.resolve();
        var c = queue.shift();
        return translateWord(c.fr).then(function (en) {
          c.en = en;
        }).catch(function (e) {
          failed++;
          if (e && e.message === "limit") stop = true;
        }).then(function () {
          done++; update();
          if (deck[idx] === c && mode === "cards") render();
          saveDeck();
          return sleep(140);
        }).then(loop);
      })();
    };
    var workers = [];
    for (var i = 0; i < 4; i++) workers.push(worker());
    Promise.all(workers).then(function () {
      translating = false;
      saveDeck();
      if (stop) {
        translateStatus.hidden = false;
        translateStatus.textContent = "Auto-translate hit its free daily limit. Some meanings are blank — " +
          "you can type your own English next to a word, or try again later.";
      } else if (failed) {
        translateStatus.hidden = false;
        translateStatus.textContent = failed + " word(s) couldn’t be translated.";
      } else {
        translateStatus.hidden = true;
      }
    });
  }

  // ---------- persistence ----------
  function saveDeck() { try { localStorage.setItem("fp_deck", JSON.stringify(deck)); } catch (e) {} }
  function loadDeck() {
    try { var s = localStorage.getItem("fp_deck"); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }

  // ---------- card rendering ----------
  function render() {
    if (!deck.length) return;
    if (idx < 0) idx = 0;
    if (idx >= deck.length) idx = deck.length - 1;
    var c = deck[idx];
    var ai = articleInfo(c);
    cardArticle.textContent = ai.text + (ai.est ? "  ?" : "");
    cardArticle.classList.toggle("is-est", ai.est);
    cardArticle.title = ai.est ? "Gender estimated from the word ending — may be wrong" : "";
    cardFrench.textContent = c.fr;
    cardEnglish.textContent = c.en ? c.en : (translating ? "translating…" : "— (no translation)");
    flipped = false;
    cardEl.classList.remove("flipped");
    progressEl.textContent = (idx + 1) + " / " + deck.length;
  }

  function flip() { flipped = !flipped; cardEl.classList.toggle("flipped", flipped); }

  var suppressClick = false;
  function animateSwap(dir, changeFn) {
    cardEl.style.transition = "transform .16s ease, opacity .16s ease";
    cardEl.style.transform = "translateX(" + (dir < 0 ? -40 : 40) + "px)";
    cardEl.style.opacity = "0";
    setTimeout(function () {
      changeFn();
      render();
      cardEl.style.transition = "none";
      cardEl.style.transform = "translateX(" + (dir < 0 ? 40 : -40) + "px)";
      requestAnimationFrame(function () {
        cardEl.style.transition = "transform .16s ease, opacity .16s ease";
        cardEl.style.transform = "translateX(0)";
        cardEl.style.opacity = "1";
      });
    }, 150);
  }
  function next() { if (deck.length) animateSwap(-1, function () { idx = (idx + 1) % deck.length; }); }
  function prev() { if (deck.length) animateSwap(1, function () { idx = (idx - 1 + deck.length) % deck.length; }); }

  // ---------- panels ----------
  function showDeck() {
    inputPanel.hidden = true;
    deckPanel.hidden = false;
  }
  function showInput() {
    deckPanel.hidden = true;
    inputPanel.hidden = false;
  }

  function setMode(m) {
    mode = m;
    var pills = document.querySelectorAll(".fc-modes .pill");
    for (var i = 0; i < pills.length; i++) pills[i].classList.toggle("active", pills[i].getAttribute("data-mode") === m);
    cardsMode.hidden = (m !== "cards");
    spellMode.hidden = (m !== "spell");
    progressEl.hidden = (m !== "cards"); // the "3 / 8" counter is only for Cards
    if (m === "cards") render();
    else spellStart();
  }

  // ---------- spelling drill ----------
  var sIdx = 0, sScore = 0, sTotal = 0, sAnswered = false;
  function spellStart() { sIdx = 0; sScore = 0; sTotal = 0; nextSpell(); }
  function nextSpell() {
    sAnswered = false;
    spellInput.value = "";
    spellFeedback.hidden = true;
    spellCheck.textContent = "Check";
    if (sIdx >= deck.length) { finishSpell(); return; }
    var c = deck[sIdx];
    spellEnglish.textContent = c.en ? c.en : "(no meaning — use “Hear it”)";
    spellScore.textContent = sTotal ? ("Score: " + sScore + " / " + sTotal) : ("0 / " + deck.length);
    spellInput.disabled = false;
    spellInput.focus();
  }
  function fb(msg, cls) {
    spellFeedback.hidden = false;
    spellFeedback.textContent = msg;
    spellFeedback.className = "fc-spell__feedback " + cls;
  }
  function checkSpell() {
    if (sIdx >= deck.length) { spellStart(); return; }
    if (sAnswered) { sIdx++; nextSpell(); return; }
    var c = deck[sIdx];
    var guess = norm(spellInput.value);
    if (!guess) return;
    sTotal++;
    if (guess === norm(c.fr)) { sScore++; fb("✅ Correct!", "ok"); }
    else if (stripAccents(guess) === stripAccents(c.fr)) { fb("➖ Almost — mind the accents: " + c.fr, "warn"); }
    else { fb("❌ Answer: " + c.fr, "bad"); }
    sAnswered = true;
    spellCheck.textContent = "Next →";
    spellScore.textContent = "Score: " + sScore + " / " + sTotal;
  }
  function skipSpell() {
    if (sIdx >= deck.length) return;
    var c = deck[sIdx];
    if (!sAnswered) { sTotal++; }
    fb("Answer: " + c.fr, "bad");
    sAnswered = true;
    spellCheck.textContent = "Next →";
  }
  function finishSpell() {
    spellEnglish.textContent = "All done! 🎉";
    spellInput.value = "";
    spellInput.disabled = true;
    fb("Final score: " + sScore + " / " + sTotal, sScore >= sTotal / 2 ? "ok" : "warn");
    spellCheck.textContent = "Restart";
    spellScore.textContent = "";
  }

  // ---------- events ----------
  createBtn.addEventListener("click", function () {
    autoTranslateOn = autoTranslateCb.checked;
    guessGenderOn = guessGenderCb.checked;
    var cards = buildCards(pasteBox.value || "");
    if (!cards.length) {
      inputMsg.hidden = false;
      inputMsg.textContent = "Please paste at least one French word first.";
      return;
    }
    inputMsg.hidden = true;
    deck = cards; idx = 0;
    saveDeck();
    showDeck();
    setMode("cards");
    runTranslations();
  });

  csvFile.addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      pasteBox.value = String(reader.result || "");
      inputMsg.hidden = false;
      inputMsg.textContent = "Loaded “" + f.name + "”. Review the words above, then press Create flashcards.";
    };
    reader.readAsText(f);
  });

  cardSpeak.addEventListener("click", function (e) { e.stopPropagation(); if (deck[idx]) speak(deck[idx].fr); });
  flipBtn.addEventListener("click", flip);
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  shuffleBtn.addEventListener("click", function () {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    idx = 0; saveDeck();
    if (mode === "cards") render(); else spellStart();
  });
  restartBtn.addEventListener("click", function () {
    deck = []; idx = 0; saveDeck();
    pasteBox.value = "";
    showInput();
  });

  // card tap / swipe
  cardEl.addEventListener("click", function () { if (suppressClick) return; flip(); });
  var tsx = 0, tsy = 0;
  cardEl.addEventListener("touchstart", function (e) { var t = e.touches[0]; tsx = t.clientX; tsy = t.clientY; }, { passive: true });
  cardEl.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0], dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next(); else prev();
      suppressClick = true; setTimeout(function () { suppressClick = false; }, 400);
    }
  }, { passive: true });

  // mode pills
  var modePills = document.querySelectorAll(".fc-modes .pill");
  for (var i = 0; i < modePills.length; i++) {
    modePills[i].addEventListener("click", function () { setMode(this.getAttribute("data-mode")); });
  }

  // spelling events
  spellHear.addEventListener("click", function () { if (deck[sIdx]) speak(deck[sIdx].fr); });
  spellCheck.addEventListener("click", checkSpell);
  spellSkip.addEventListener("click", skipSpell);
  spellInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); checkSpell(); } });

  // keyboard nav (cards mode)
  document.addEventListener("keydown", function (e) {
    if (deckPanel.hidden || mode !== "cards") return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === " ") { e.preventDefault(); flip(); }
  });

  // ---------- init: restore a saved deck if present ----------
  var saved = loadDeck();
  if (saved && saved.length) {
    deck = saved; idx = 0;
    showDeck();
    setMode("cards");
    runTranslations(); // fill any that are still missing
  }
})();
