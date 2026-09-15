/* ===========================================================
   flashcards.js — French Pronounce flashcard maker
   One merged flow per card: see the English → spell the French →
   reveal the word with pronunciation and instant feedback → next.
   - Paste or upload French words
   - Auto-translate to English (free MyMemory API, best effort)
   - Guess le/la gender from word endings
   Everything runs in the browser; the deck lives in localStorage.
   =========================================================== */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var inputPanel = $("inputPanel"), deckPanel = $("deckPanel");
  var pasteBox = $("pasteBox"), csvFile = $("csvFile"), createBtn = $("createBtn");
  var autoTranslateCb = $("autoTranslate"), guessGenderCb = $("guessGender");
  var inputMsg = $("inputMsg"), translateStatus = $("translateStatus");
  var progressEl = $("progress"), scoreEl = $("score");
  var cardEl = $("card"), stageQ = $("stageQ"), stageA = $("stageA");
  var cardEnglish = $("cardEnglish"), hearHint = $("hearHint"), spellInput = $("spellInput");
  var checkBtn = $("checkBtn"), revealBtn = $("revealBtn");
  var cardArticle = $("cardArticle"), cardFrench = $("cardFrench"),
      cardEnglishSm = $("cardEnglishSm"), cardSpeak = $("cardSpeak"), cardFeedback = $("cardFeedback"),
      backBtn = $("backBtn");
  var prevBtn = $("prevBtn"), nextBtn = $("nextBtn");
  var shuffleBtn = $("shuffleBtn"), restartBtn = $("restartBtn");

  // ---------- state ----------
  var deck = [];   // [{fr, en, userEn, gender, genderSource, _scored, _correct}]
  var idx = 0;
  var stage = "q"; // "q" | "a"
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
  function decodeEntities(s) { var t = document.createElement("textarea"); t.innerHTML = s; return t.value; }
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

  var FEM_ENDINGS = ["tion","sion","aison","ison","ité","té","tié","ée","ande","ance","ence",
                     "ette","elle","esse","ère","ere","ie","ine","ure","ude","euse"];
  var MASC_ENDINGS = ["age","ment","eau","isme","ail","ier","in","on","eur","oir","ou","al","if","er","o"];
  function guessGender(word) {
    var w = word.toLowerCase();
    if (w.indexOf(" ") !== -1 || w.length < 2) return null;
    var i;
    for (i = 0; i < FEM_ENDINGS.length; i++) if (w.slice(-FEM_ENDINGS[i].length) === FEM_ENDINGS[i]) return "f";
    for (i = 0; i < MASC_ENDINGS.length; i++) if (w.slice(-MASC_ENDINGS[i].length) === MASC_ENDINGS[i]) return "m";
    return null;
  }

  function stripArticle(fr) {
    var m = fr.match(/^(l['’]|le |la |les |un |une |des |du )\s*/i);
    if (!m) return { base: fr, gender: null };
    var art = m[1].trim().toLowerCase().replace("’", "'");
    var base = fr.slice(m[0].length).trim();
    var gender = null;
    if (art === "le" || art === "un" || art === "du") gender = "m";
    else if (art === "la" || art === "une") gender = "f";
    return { base: base || fr, gender: gender };
  }

  function isHeaderLine(fr) {
    var w = norm(fr);
    return w === "french" || w === "word" || w === "mot" || w === "words" || w === "français";
  }

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
      if (isHeaderLine(fr)) continue;

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
      if (cards.length >= 1000) break;
    }
    return cards;
  }

  function articleInfo(card) {
    if (!card.gender) return { text: "", est: false };
    if (card.genderSource === "guess" && card.en && /^to\s/i.test(card.en.trim())) return { text: "", est: false };
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
      if (/MYMEMORY WARNING|YOU USED ALL|INVALID|QUOTA/i.test(en)) throw new Error("limit");
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
      translateStatus.textContent = "Translating " + done + " / " + total + (failed ? (" · " + failed + " failed") : "");
    };
    update();
    var queue = pending.slice();
    var worker = function () {
      return (function loop() {
        if (!queue.length || stop) return Promise.resolve();
        var c = queue.shift();
        return translateWord(c.fr).then(function (en) { c.en = en; })
          .catch(function (e) { failed++; if (e && e.message === "limit") stop = true; })
          .then(function () {
            done++; update();
            if (deck[idx] === c) refreshTexts();
            saveDeck();
            return sleep(140);
          }).then(loop);
      })();
    };
    var workers = [];
    for (var i = 0; i < 4; i++) workers.push(worker());
    Promise.all(workers).then(function () {
      translating = false; saveDeck();
      if (stop) {
        translateStatus.hidden = false;
        translateStatus.textContent = "Auto-translate hit its free daily limit. Some meanings are blank — " +
          "you can type your own English next to a word, or try again later.";
      } else if (failed) {
        translateStatus.hidden = false;
        translateStatus.textContent = failed + " word(s) couldn’t be translated.";
      } else { translateStatus.hidden = true; }
    });
  }

  // ---------- persistence ----------
  function saveDeck() { try { localStorage.setItem("fp_deck", JSON.stringify(deck)); } catch (e) {} }
  function loadDeck() { try { var s = localStorage.getItem("fp_deck"); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

  // ---------- rendering ----------
  function promptText(card) { return card.en ? card.en : "🔊 listen and spell"; }

  function refreshTexts() {
    // update the current card's texts without disturbing the input/stage
    var c = deck[idx];
    if (!c) return;
    cardEnglish.textContent = promptText(c);
    cardEnglishSm.textContent = c.en || "";
  }

  function updateScore() {
    var attempted = 0, correct = 0;
    for (var i = 0; i < deck.length; i++) { if (deck[i]._scored) { attempted++; if (deck[i]._correct) correct++; } }
    scoreEl.textContent = attempted ? ("Score: " + correct + " / " + attempted) : "";
  }

  function showStage(s) {
    stage = s;
    stageQ.hidden = (s !== "q");
    stageA.hidden = (s !== "a");
  }

  function renderCard() {
    if (!deck.length) return;
    if (idx < 0) idx = 0;
    if (idx >= deck.length) idx = deck.length - 1;
    var c = deck[idx];

    // question stage
    cardEnglish.textContent = promptText(c);
    spellInput.value = "";
    checkBtn.textContent = "Check";

    // answer stage (pre-filled so reveal is instant)
    var ai = articleInfo(c);
    cardArticle.textContent = ai.text + (ai.est ? "  ?" : "");
    cardArticle.classList.toggle("is-est", ai.est);
    cardArticle.title = ai.est ? "Gender estimated from the word ending — may be wrong" : "";
    cardFrench.textContent = c.fr;
    cardEnglishSm.textContent = c.en || "";
    cardFeedback.textContent = "";
    cardFeedback.className = "fc-card__feedback";

    showStage("q");
    progressEl.textContent = (idx + 1) + " / " + deck.length;
    updateScore();
  }

  function grade() {
    var c = deck[idx];
    var guess = norm(spellInput.value);
    var exact = guess && guess === norm(c.fr);
    var accentOnly = guess && !exact && stripAccents(guess) === stripAccents(c.fr);

    if (!c._scored && guess) { c._scored = true; c._correct = !!exact; saveDeck(); }

    if (!guess) { cardFeedback.textContent = "You didn’t type an answer — the word was:"; cardFeedback.className = "fc-card__feedback bad"; }
    else if (exact) { cardFeedback.textContent = "✅ Correct!"; cardFeedback.className = "fc-card__feedback ok"; }
    else if (accentOnly) { cardFeedback.textContent = "➖ Almost — mind the accents."; cardFeedback.className = "fc-card__feedback warn"; }
    else { cardFeedback.textContent = "❌ Not quite — the answer:"; cardFeedback.className = "fc-card__feedback bad"; }

    showStage("a");
    updateScore();
  }

  function reveal() {
    var c = deck[idx];
    if (!c._scored) { cardFeedback.textContent = ""; cardFeedback.className = "fc-card__feedback"; }
    showStage("a");
  }

  // Return from the reveal to the spelling input for the same card
  function backToSpelling() {
    checkBtn.textContent = "Check";
    showStage("q");
    spellInput.focus();
  }

  // ---------- navigation ----------
  var suppressClick = false;
  function animateSwap(dir, changeFn) {
    cardEl.style.transition = "transform .16s ease, opacity .16s ease";
    cardEl.style.transform = "translateX(" + (dir < 0 ? -40 : 40) + "px)";
    cardEl.style.opacity = "0";
    setTimeout(function () {
      changeFn(); renderCard();
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
  function showDeck() { inputPanel.hidden = true; deckPanel.hidden = false; }
  function showInput() { deckPanel.hidden = true; inputPanel.hidden = false; }

  // ---------- events ----------
  createBtn.addEventListener("click", function () {
    autoTranslateOn = autoTranslateCb.checked;
    guessGenderOn = guessGenderCb.checked;
    var cards = buildCards(pasteBox.value || "");
    if (!cards.length) { inputMsg.hidden = false; inputMsg.textContent = "Please paste at least one French word first."; return; }
    inputMsg.hidden = true;
    deck = cards; idx = 0;
    saveDeck(); showDeck(); renderCard(); runTranslations();
    spellInput.focus();
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

  checkBtn.addEventListener("click", function () {
    if (stage === "a") { next(); return; } // acts as "Next" once revealed
    grade();
  });
  revealBtn.addEventListener("click", reveal);
  backBtn.addEventListener("click", backToSpelling);
  hearHint.addEventListener("click", function () { if (deck[idx]) speak(deck[idx].fr); });
  cardSpeak.addEventListener("click", function () { if (deck[idx]) speak(deck[idx].fr); });
  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", prev);

  spellInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); if (stage === "q") grade(); else next(); }
  });

  shuffleBtn.addEventListener("click", function () {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    idx = 0; saveDeck(); renderCard(); spellInput.focus();
  });
  restartBtn.addEventListener("click", function () {
    deck = []; idx = 0; saveDeck(); pasteBox.value = ""; showInput();
  });

  // swipe on the card
  var tsx = 0, tsy = 0;
  cardEl.addEventListener("touchstart", function (e) { var t = e.touches[0]; tsx = t.clientX; tsy = t.clientY; }, { passive: true });
  cardEl.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0], dx = t.clientX - tsx, dy = t.clientY - tsy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next(); else prev();
    }
  }, { passive: true });

  // keyboard: arrows move between cards (but not while typing in the input)
  document.addEventListener("keydown", function (e) {
    if (deckPanel.hidden) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
  });

  // ---------- init ----------
  var saved = loadDeck();
  if (saved && saved.length) {
    deck = saved; idx = 0;
    showDeck(); renderCard(); runTranslations();
  }
})();
