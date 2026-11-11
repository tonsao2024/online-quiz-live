/* หน้าผู้จัด — เปิดห้อง / คุมเกม / เฉลย / กระดานคะแนน */
(function () {
  const { $, $$, toast, esc, fmt, param } = U;

  let roomId = param("room");
  const quizParam = param("quiz");
  let pin = "";
  let snap = null;
  let offset = 0;
  let pollInt = null;
  let tickInt = null;
  let statsInt = null;
  let channel = null;
  let renderedKey = "";
  let autoRevealedKey = "";
  let busy = false;
  const COLOR = ["c1", "c2", "c3", "c4", "c5", "c6"];

  const show = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  (async function boot() {
    const user = await API.currentUser().catch(() => null);
    if (!user) { location.replace("index.html#host"); return; }
    $("#btn-logout").classList.remove("hidden");
    $("#btn-logout").addEventListener("click", async () => { await API.signOut(); location.href = "index.html"; });

    if (roomId) { startRun(); return; }

    if (quizParam) {
      try {
        const r = await API.createRoom(quizParam, false);
        roomId = r.room_id;
        history.replaceState({}, "", "host.html?room=" + roomId);
        startRun();
      } catch (e) { toast(e.message, "err", 4000); showPick(); }
      return;
    }
    showPick();
  })();

  async function showPick() {
    show("s-pick");
    const list = $("#pick-list");
    list.innerHTML = '<div class="loader"></div>';
    try {
      const quizzes = await API.listQuizzes();
      if (!quizzes.length) {
        list.innerHTML = '<p class="muted small">ยังไม่มีชุดข้อสอบ — <a href="admin.html" style="color:#b8a6ff">ไปสร้างชุดแรก</a></p>';
        return;
      }
      list.innerHTML = quizzes.map((q) =>
        '<div class="quiz-card"><div class="row"><div class="quiz-emoji">' + esc((q.title || "?").trim().charAt(0)) + "</div>" +
        '<div><div style="font-weight:800">' + esc(q.title) + "</div>" +
        '<div class="tiny muted">' + q.question_count + " ข้อ</div></div></div>" +
        '<button class="btn btn-primary btn-block" data-quiz="' + q.id + '">เปิดห้องเล่นสด</button></div>'
      ).join("");
      $$("[data-quiz]", list).forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "กำลังเปิดห้อง…";
        try {
          const r = await API.createRoom(b.dataset.quiz, false);
          location.href = "host.html?room=" + r.room_id;
        } catch (e) { toast(e.message, "err"); b.disabled = false; b.textContent = "เปิดห้องเล่นสด"; }
      }));
    } catch (e) {
      list.innerHTML = '<p class="muted small">โหลดรายการไม่สำเร็จ: ' + esc(e.message) + "</p>";
    }
  }

  /* ------------------------------------------------------------------ */
  /* run loop                                                           */
  /* ------------------------------------------------------------------ */
  function startRun() {
    bindActions();
    pollInt = setInterval(fetchSnapshot, 2000);
    tickInt = setInterval(tickTimer, 120);
    fetchSnapshot();
  }

  async function fetchSnapshot() {
    try {
      const s = await API.hostSnapshot(roomId);
      if (s.error) throw Object.assign(new Error(s.error), { code: s.error });
      snap = s;
      pin = s.pin;
      if (s.server_now) offset = new Date(s.server_now).getTime() - Date.now();
      if (!channel) channel = API.subscribeRoom(pin, () => { });
      render();
    } catch (e) {
      if (e.code === "forbidden" || e.message === "forbidden") {
        toast("คุณไม่มีสิทธิ์ในห้องนี้", "err"); setTimeout(() => location.href = "admin.html", 1200);
      } else if (e.code === "room_not_found") {
        toast("ไม่พบห้องนี้", "err"); setTimeout(() => location.href = "admin.html", 1200);
      } else console.warn(e);
    }
  }

  function broadcast() { if (channel) channel.send(); }

  /* ------------------------------------------------------------------ */
  /* render                                                             */
  /* ------------------------------------------------------------------ */
  function render() {
    if (!snap) return;
    $("#top-pin").textContent = snap.pin;
    $("#top-pin").classList.remove("hidden");
    $("#top-quiz").textContent = snap.quiz_title;
    $("#top-quiz").classList.remove("hidden");

    const st = snap.status;
    const pill = $("#top-status");
    pill.classList.remove("hidden");
    const label = { lobby: "รอผู้เข้าร่วม", question: "กำลังถาม", reveal: "เฉลย", leaderboard: "กระดานคะแนน", ended: "จบเกม" }[st] || st;
    pill.className = "pill " + (st === "lobby" ? "pill-warn" : st === "ended" ? "" : "pill-live");
    pill.innerHTML = (st === "lobby" || st === "ended" ? "" : '<i class="dot"></i>') + label;

    const key = st + ":" + snap.current_index + ":" + (snap.question ? snap.question.id : "");
    const changed = key !== renderedKey;

    if (st === "lobby") { if (changed) { renderLobby(); show("s-lobby"); } updateLobby(); }
    else if (st === "question") { if (changed) { renderQuestion(); show("s-question"); } updateQuestion(); }
    else if (st === "reveal") { if (changed) { renderReveal(); show("s-reveal"); } }
    else if (st === "leaderboard") { if (changed) { renderLb(); show("s-lb"); } }
    else if (st === "ended") { if (changed) { renderEnded(); show("s-ended"); } }

    if (changed) {
      renderedKey = key;
      if (st === "question") startStatsPolling();
      else stopStatsPolling();
      if (st === "reveal" || st === "ended") stopStatsPolling();
    }
  }

  /* ---------- lobby ---------- */
  function renderLobby() {
    $("#pin-big").textContent = pin;
    const url = U.joinUrl(pin);
    $("#joinurl").textContent = U.publicUrl() + "  ·  PIN " + pin;
    $("#qr").innerHTML = U.qrSvg(url);
    $("#lobby-quiz").textContent = snap.quiz_title + " · " + snap.question_count + " ข้อ";
    $("#chk-late").checked = !!snap.allow_late;
  }
  function updateLobby() {
    const players = snap.players || [];
    $("#lobby-count").textContent = players.length + " คน";
    $("#lobby-count2").textContent = players.length + " คน";
    const grid = $("#players");
    if (!players.length) {
      grid.className = "players-grid empty";
      grid.textContent = "ยังไม่มีใครเข้าห้อง — แชร์ PIN ให้ผู้เข้าอบรม";
    } else {
      grid.className = "players-grid";
      grid.innerHTML = players.map((p) =>
        '<div class="player-chip"><span class="av">' + esc(U.initials(p.nickname)) + '</span>' +
        '<span class="nm">' + esc(p.nickname) + "</span></div>").join("");
    }
    $("#btn-start").disabled = players.length === 0;
  }

  /* ---------- question ---------- */
  function renderQuestion() {
    const q = snap.question;
    if (!q) return;
    $("#q-idx").textContent = "ข้อ " + (q.index + 1) + " / " + snap.question_count;
    $("#h-prompt").innerHTML = esc(q.prompt) +
      (q.image_url ? '<img class="qimg" src="' + esc(q.image_url) + '" alt="" style="margin-top:14px">' : "");
    $("#h-answers").innerHTML = q.options.map((opt, i) =>
      '<div class="host-ans ' + COLOR[i % 6] + '"><span class="sh">' + U.shapes(i) + '</span><span>' + esc(opt) + "</span></div>"
    ).join("");
    $("#q-points").textContent = "ให้ " + fmt(q.points) + " คะแนน · " + q.time_limit + " วินาที";
    $("#answered-n").textContent = "0";
    $("#answered-bar").style.width = "0%";
  }

  function updateQuestion() {
    const total = snap.player_count || 0;
    const answered = snap.answered || 0;
    $("#answered-n").textContent = answered + (total ? " / " + total : "");
    $("#answered-bar").style.width = (total ? Math.min(100, (answered / total) * 100) : 0) + "%";
  }

  /* ---------- reveal ---------- */
  function renderReveal() {
    const q = snap.question;
    if (!q) return;
    const correct = snap.correct_index;
    $("#r-title").textContent = "เฉลยข้อ " + (q.index + 1) + " / " + snap.question_count;
    $("#r-prompt").textContent = q.prompt;
    $("#r-answers").innerHTML = q.options.map((opt, i) =>
      '<div class="host-ans ' + COLOR[i % 6] + (i === correct ? " is-correct" : " not-correct") + '">' +
      '<span class="sh">' + U.shapes(i) + "</span><span>" + esc(opt) + "</span>" +
      (i === correct ? '<span style="margin-left:auto">✓</span>' : "") + "</div>"
    ).join("");

    const dist = snap.distribution || {};
    const counts = q.options.map((_, i) => Number(dist[String(i)] || 0));
    const max = Math.max(1, ...counts);
    $("#r-bars").innerHTML = q.options.map((opt, i) =>
      '<div class="bar-row"><div>' +
      '<div class="bar-name">' + U.shapes(i) + " " + esc(opt) + "</div>" +
      '<div class="bar-wrap"><div class="bar-fill ' + COLOR[i % 6] + '" ' +
      'style="width:' + (counts[i] / max * 100) + '%;background:var(--a' + ((i % 6) + 1) + ')"></div></div>' +
      "</div>" +
      '<div class="n">' + counts[i] + "</div></div>"
    ).join("");
    $("#r-stat").textContent = "ตอบถูก " + (snap.correct || 0) + " / " + (snap.answered || 0) + " คน";
    $("#r-count").textContent = (snap.player_count || 0) + " คนในห้อง";
    $("#btn-next").textContent = (q.index + 1 >= snap.question_count) ? "จบเกม →" : "ข้อต่อไป →";
  }

  /* ---------- leaderboard / end ---------- */
  function renderLb() {
    renderRows($("#h-lb"), (snap.players || []).slice(0, 10));
    $("#lb-count").textContent = (snap.players || []).length + " คน";
    const last = snap.current_index + 1 >= snap.question_count;
    $("#btn-next2").textContent = last ? "จบเกม →" : "ข้อต่อไป →";
  }

  function renderEnded() {
    renderRows($("#end-lb"), (snap.players || []).slice(0, 10));
    $("#end-total").textContent = (snap.players || []).length + " คน";
  }

  function renderRows(el, rows) {
    if (!rows.length) { el.innerHTML = '<p class="muted small tc">ยังไม่มีผู้เล่น</p>'; return; }
    el.innerHTML = rows.map((p, i) => {
      const cls = i === 0 ? "t1" : i === 1 ? "t2" : i === 2 ? "t3" : "";
      return '<div class="res-row">' +
        '<div class="rank ' + cls + '">' + (i + 1) + "</div>" +
        '<div style="flex:1; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + esc(p.nickname) + "</div>" +
        '<div class="tiny muted">ถูก ' + p.correct_count + " ข้อ</div>" +
        '<div class="mono" style="font-weight:800; min-width:64px; text-align:right">' + fmt(p.score) + "</div></div>";
    }).join("");
  }

  /* ---------- timer / stats ---------- */
  function tickTimer() {
    if (!snap || snap.status !== "question" || !snap.question_ends_at) return;
    const left = Math.max(0, new Date(snap.question_ends_at).getTime() - (Date.now() + offset));
    $("#host-timer").textContent = Math.ceil(left / 1000);
    $("#host-timer").style.color = left < 5000 ? "#ff8fa0" : "";
    if (left <= 0 && $("#chk-auto").checked) {
      const key = "auto:" + snap.current_index;
      if (autoRevealedKey !== key) { autoRevealedKey = key; doReveal(); }
    }
  }

  function startStatsPolling() {
    stopStatsPolling();
    statsInt = setInterval(async () => {
      if (!snap || snap.status !== "question" || !snap.question) return;
      try {
        const s = await API.hostStats(roomId, snap.question.id);
        if (s.error) return;
        snap.answered = s.answered;
        snap.correct = s.correct;
        snap.distribution = s.distribution;
        updateQuestion();
      } catch (e) { /* เงียบไว้ */ }
    }, 1200);
  }
  function stopStatsPolling() { if (statsInt) { clearInterval(statsInt); statsInt = null; } }

  /* ------------------------------------------------------------------ */
  /* actions                                                            */
  /* ------------------------------------------------------------------ */
  function bindActions() {
    $("#btn-start").addEventListener("click", () => next());
    $("#btn-reveal").addEventListener("click", doReveal);
    $("#btn-next").addEventListener("click", () => next());
    $("#btn-next2").addEventListener("click", () => next());
    $("#btn-lb").addEventListener("click", async () => {
      await API.setStatus(roomId, "leaderboard"); broadcast(); fetchSnapshot();
    });
    $("#btn-finish").addEventListener("click", async () => {
      await API.setStatus(roomId, "ended"); broadcast(); fetchSnapshot();
    });
    $("#btn-again").addEventListener("click", async () => {
      try {
        const r = await API.createRoom(snap.quiz_id, false);
        location.href = "host.html?room=" + r.room_id;
      } catch (e) { toast(e.message, "err"); }
    });
    $("#btn-copy").addEventListener("click", async () => {
      const url = U.joinUrl(pin);
      try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว", "ok"); }
      catch (e) { prompt("คัดลอกลิงก์นี้:", url); }
    });
    $("#btn-open").addEventListener("click", () => window.open(U.joinUrl(pin), "_blank"));
    $("#chk-late").addEventListener("change", async (e) => {
      try { await API.setAllowLate(roomId, e.target.checked); toast(e.target.checked ? "เปิดให้เข้าห้องกลางเกม" : "ปิดการเข้าห้องกลางเกม", "ok", 1800); }
      catch (err) { toast(err.message, "err"); }
    });

    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        if (busy) return;
        if (snap.status === "lobby") next();
        else if (snap.status === "question") doReveal();
        else if (snap.status === "reveal" || snap.status === "leaderboard") next();
      }
    });
  }

  async function doReveal() {
    if (busy || !snap || snap.status !== "question") return;
    busy = true;
    try {
      await API.setStatus(roomId, "reveal");
      broadcast();
      await fetchSnapshot();
    } catch (e) { toast(e.message, "err"); }
    busy = false;
  }

  async function next() {
    if (busy) return;
    busy = true;
    try {
      const r = await API.nextQuestion(roomId);
      if (r.error) throw Object.assign(new Error(r.error), { code: r.error });
      broadcast();
      await fetchSnapshot();
      if (r.finished) { show("s-ended"); renderEnded(); }
    } catch (e) { toast(e.message, "err", 3500); }
    busy = false;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fetchSnapshot();
  });

  window.addEventListener("beforeunload", () => {
    if (channel) channel.close();
  });
})();
