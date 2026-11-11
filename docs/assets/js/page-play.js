/* หน้าผู้เล่น — เข้าห้อง / ตอบคำถาม / ดูเฉลยและอันดับ */
(function () {
  const { $, $$, toast, esc, fmt, param } = U;
  const pin = String(param("pin") || "").replace(/\D/g, "").slice(0, 6);
  const STORE = "onlive.player." + pin;
  const NICK_KEY = "onlive.nickname";

  let token = null;
  let state = null;
  let player = null;
  let answeredQid = null;
  let lastAnswer = null;
  let offset = 0;             // เวลาเซิร์ฟเวอร์ - เวลามือถือ (ms)
  let timerInt = null;
  let pollInt = null;
  let channel = null;
  let syncTimer = null;
  let timerQid = null;
  let lbQid = null;
  let wakeLock = null;

  const show = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
  const setScore = (n) => {
    const el = $("#myscore");
    if (n == null) return;
    el.style.display = "";
    el.textContent = fmt(n) + " คะแนน";
  };

  if (pin.length !== 6) { $("#err-text").textContent = "ลิงก์ไม่ถูกต้อง — ต้องมี PIN 6 หลัก"; show("s-error"); return; }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  $("#pin-label").textContent = pin;
  $("#nick").value = localStorage.getItem(NICK_KEY) || "";

  const saved = readStore();
  if (saved && saved.token) {
    token = saved.token;
    $("#who").textContent = saved.nickname || "";
    sync();
  } else {
    show("s-join");
    setTimeout(() => $("#nick").focus(), 250);
  }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { return null; }
  }
  function writeStore(v) {
    try { localStorage.setItem(STORE, JSON.stringify(v)); } catch (e) { }
  }
  function clearStore() { try { localStorage.removeItem(STORE); } catch (e) { } }

  /* ------------------------------------------------------------------ */
  /* join                                                               */
  /* ------------------------------------------------------------------ */
  $("#btn-join").addEventListener("click", join);
  $("#nick").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });

  async function join() {
    const nick = $("#nick").value.trim().replace(/\s+/g, " ");
    if (!nick) { toast("กรุณาใส่ชื่อเล่น", "err"); $("#nick").focus(); return; }
    const btn = $("#btn-join");
    btn.disabled = true; btn.textContent = "กำลังเข้าห้อง…";
    try {
      const r = await API.joinRoom(pin, nick);
      token = r.token;
      writeStore({ token: r.token, nickname: r.nickname, pin });
      localStorage.setItem(NICK_KEY, r.nickname);
      $("#who").textContent = r.nickname;
      await sync();
      startPolling();
      subscribe();
    } catch (e) {
      toast(e.message, "err", 4200);
      btn.disabled = false; btn.textContent = "เข้าร่วมเกม";
    }
  }

  /* ------------------------------------------------------------------ */
  /* sync + routing                                                     */
  /* ------------------------------------------------------------------ */
  function queueSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, 220);
  }

  async function sync() {
    if (!token) return;
    try {
      const r = await API.resume(token);
      player = r.player;
      state = r.state;
      if (state && state.server_now) offset = new Date(state.server_now).getTime() - Date.now();
      setScore(player.score);
      $("#who").textContent = player.nickname;
      route(r.answered_current);
    } catch (e) {
      if (e.code === "player_not_found" || e.code === "room_not_found") {
        clearStore();
        $("#err-text").textContent = e.code === "room_not_found"
          ? "ห้องนี้ปิดไปแล้ว" : "ไม่พบข้อมูลผู้เล่น กรุณาเข้าห้องใหม่";
        show("s-error");
        stopAll();
      } else {
        console.warn(e);
      }
    }
  }

  function route(answeredFromServer) {
    if (!state) return;
    const st = state.status;

    if (st === "lobby") {
      show("s-lobby");
      $("#lobby-count").textContent = st.player_count + " คนในห้อง";
      $("#lobby-title").textContent = "เข้าห้องแล้ว!";
      return;
    }

    if (st === "question") {
      const q = state.question;
      if (!q) { show("s-lobby"); return; }
      if (answeredFromServer || answeredQid === q.id) {
        show("s-answered");
        if (lastAnswer) {
          $("#ans-points").textContent = (lastAnswer.points > 0 ? "+" : "") + fmt(lastAnswer.points);
          $("#ans-score").textContent = fmt(lastAnswer.score) + " คะแนน";
        }
        return;
      }
      if (timerQid !== q.id) { timerQid = q.id; answeredQid = null; lastAnswer = null; renderQuestion(); }
      show("s-question");
      return;
    }

    if (st === "reveal") { renderReveal(); show("s-reveal"); return; }

    if (st === "leaderboard") {
      show("s-leaderboard");
      if (lbQid !== state.current_index) { lbQid = state.current_index; loadLeaderboard(); }
      return;
    }

    if (st === "ended") { renderEnded(); show("s-ended"); stopAll(); return; }
  }

  /* ------------------------------------------------------------------ */
  /* question screen                                                    */
  /* ------------------------------------------------------------------ */
  function renderQuestion() {
    const q = state.question;
    $("#q-index").textContent = "ข้อ " + (q.index + 1) + " / " + state.question_count;
    $("#q-prompt").innerHTML = esc(q.prompt) +
      (q.image_url ? '<img class="qimg" src="' + esc(q.image_url) + '" alt="">' : "");

    const box = $("#q-answers");
    const n = q.options.length;
    box.className = "answers" + (n === 2 ? " count-2" : n === 3 ? " count-3" : "");
    box.innerHTML = q.options.map((opt, i) =>
      '<button class="ans c' + (i + 1) + '" data-i="' + i + '">' +
      '<span class="shape">' + U.shapes(i) + "</span>" +
      '<span class="lbl">' + esc(opt) + "</span></button>"
    ).join("");
    $$(".ans", box).forEach((b) => b.addEventListener("click", () => choose(+b.dataset.i)));

    startTimer(q);
    requestWakeLock();
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { } }
  }

  function startTimer(q) {
    stopTimer();
    const total = (q.time_limit || 20) * 1000;
    const endsAt = state.question_ends_at ? new Date(state.question_ends_at).getTime() : Date.now() + total;
    const ring = $("#ring");
    const num = $("#tnum");
    const tick = () => {
      const left = Math.max(0, endsAt - (Date.now() + offset));
      num.textContent = Math.ceil(left / 1000);
      const frac = Math.max(0, Math.min(1, left / total));
      ring.setAttribute("stroke-dashoffset", String(226.2 * (1 - frac)));
      if (left <= 0) {
        stopTimer();
        $$(".ans").forEach((b) => { b.disabled = true; b.classList.add("dim"); });
        if (!answeredQid) {
          toast("หมดเวลาข้อนี้แล้ว", "err", 2000);
          queueSync();
        }
      }
    };
    tick();
    timerInt = setInterval(tick, 100);
  }
  function stopTimer() { if (timerInt) { clearInterval(timerInt); timerInt = null; } }

  async function choose(i) {
    if (answeredQid) return;
    const q = state.question;
    answeredQid = q.id;
    stopTimer();
    const btns = $$("#q-answers .ans");
    btns.forEach((b, ix) => {
      b.disabled = true;
      if (ix === i) b.classList.add("chosen");
      else b.classList.add("dim");
    });
    if (navigator.vibrate) { try { navigator.vibrate(28); } catch (e) { } }

    try {
      const r = await API.submitAnswer(token, q.id, i);
      lastAnswer = r;
      setScore(r.score);
      $("#ans-points").textContent = (r.points > 0 ? "+" : "") + fmt(r.points);
      $("#ans-score").textContent = fmt(r.score) + " คะแนน";
      show("s-answered");
    } catch (e) {
      if (e.code === "already_answered") { show("s-answered"); }
      else if (e.code === "time_up" || e.code === "not_open") { toast("หมดเวลาข้อนี้แล้ว", "err"); queueSync(); }
      else { toast(e.message, "err", 4000); answeredQid = null; }
    }
  }

  /* ------------------------------------------------------------------ */
  /* reveal / leaderboard / end                                         */
  /* ------------------------------------------------------------------ */
  function renderReveal() {
    const q = state.question;
    const correct = q && state.correct_index != null ? state.correct_index : null;
    const truth = q && correct != null ? q.options[correct] : "";
    let right = null;
    if (lastAnswer && typeof lastAnswer.is_correct === "boolean") right = lastAnswer.is_correct;

    const icon = $("#reveal-icon");
    icon.className = "verdict " + (right === true ? "ok" : right === false ? "no" : "none");
    const title = $("#reveal-title");
    title.textContent = right === true ? "ถูกต้อง!" : right === false ? "ยังไม่ถูก" : "เฉลย";
    title.style.color = right === true ? "var(--a4)" : right === false ? "var(--a1)" : "var(--ink)";
    $("#reveal-truth").innerHTML = truth
      ? 'คำตอบที่ถูกคือ <b style="color:var(--ok)">' + esc(truth) + "</b>"
      : "";
    if (lastAnswer) {
      $("#reveal-score").textContent = "+" + fmt(lastAnswer.points) + " → " + fmt(lastAnswer.score) + " คะแนน";
    } else if (player) {
      $("#reveal-score").textContent = fmt(player.score) + " คะแนน";
    }
    if (player) $("#reveal-rank").textContent = "อันดับ " + player.rank;
  }

  async function loadLeaderboard() {
    try {
      const r = await API.leaderboard(pin, 10);
      $("#lb-total").textContent = r.total + " คน";
      renderList($("#lb-list"), r.players, player && player.nickname);
    } catch (e) { console.warn(e); }
  }

  function renderList(el, rows, me) {
    if (!rows || !rows.length) { el.innerHTML = '<p class="muted small tc">ยังไม่มีข้อมูล</p>'; return; }
    el.innerHTML = rows.map((p) => {
      const isMe = me && p.nickname === me;
      const cls = p.rank === 1 ? "t1" : p.rank === 2 ? "t2" : p.rank === 3 ? "t3" : "";
      return '<div class="res-row' + (isMe ? " me" : "") + '">' +
        '<div class="rank ' + cls + '">' + p.rank + "</div>" +
        '<div style="flex:1; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + esc(p.nickname) + "</div>" +
        '<div class="mono" style="font-weight:800">' + fmt(p.score) + "</div>" +
        "</div>";
    }).join("");
  }

  function renderEnded() {
    if (!player) return;
    const rank = player.rank;
    const badge = $("#end-emoji");
    badge.textContent = rank;
    badge.className = "rankbadge" + (rank === 1 ? " gold" : rank === 2 ? " silver" : rank === 3 ? " bronze" : "");
    $("#end-title").textContent = rank === 1 ? "ยินดีด้วย! ที่ 1" : rank === 2 ? "ยินดีด้วย! ที่ 2" : rank === 3 ? "ยินดีด้วย! ที่ 3" : "จบเกมแล้ว";
    $("#end-score").textContent = fmt(player.score);
    $("#end-rank").textContent = "อันดับ " + rank + " จาก " + (state.player_count || 0) + " คน · ตอบถูก " +
      player.correct_count + " ข้อ";
    renderList($("#end-list"), state.final_leaderboard, player.nickname);
  }

  /* ------------------------------------------------------------------ */
  /* polling + realtime + lifecycle                                     */
  /* ------------------------------------------------------------------ */
  function startPolling() {
    stopPolling();
    pollInt = setInterval(sync, 5000);
  }
  function stopPolling() { if (pollInt) { clearInterval(pollInt); pollInt = null; } }

  function subscribe() {
    if (channel) return;
    channel = API.subscribeRoom(pin, queueSync);
  }

  function stopAll() {
    stopPolling(); stopTimer();
    if (channel) { channel.close(); channel = null; }
    releaseWakeLock();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token) sync();
  });

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
      }
    } catch (e) { /* ไม่รองรับก็ข้ามไป */ }
  }
  function releaseWakeLock() {
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) { }
  }
})();
