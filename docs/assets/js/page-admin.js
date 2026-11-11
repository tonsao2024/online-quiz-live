/* ห้องทำงานผู้จัด — สร้าง/แก้ไขชุดข้อสอบ และนำเข้า CSV/JSON */
(function () {
  const { $, $$, toast, esc, param } = U;
  const EMOJIS = ["🎯", "🧠", "🛡️", "⚙️", "💡", "📊", "🚀", "🌱", "🏥", "📚", "🔥", "🎓"];

  let user = null;
  let editing = null;          // {id,title,description,emoji}
  let questions = [];          // รายการคำถามที่กำลังแก้
  let pickingEmoji = "🎯";
  let importMode = "new";      // new | append
  let importTab = "csv";
  let parsed = [];

  const show = (id) => $$(".screen").forEach((s) => s.classList.toggle("on", s.id === id));

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */
  (async function boot() {
    try { user = await API.currentUser(); } catch (e) { }
    if (!user) { location.replace("index.html#host"); return; }
    $("#who").textContent = user.email;
    $("#who").classList.remove("hidden");
    $("#btn-logout").addEventListener("click", async () => { await API.signOut(); location.href = "index.html"; });

    bindStatic();
    const quizId = param("quiz");
    if (quizId) { await openEditor(quizId); }
    else { await renderList(); show("s-list"); }
  })();

  /* ------------------------------------------------------------------ */
  /* list                                                               */
  /* ------------------------------------------------------------------ */
  async function renderList() {
    show("s-list");
    const el = $("#quiz-list");
    el.innerHTML = '<div class="loader"></div>';
    try {
      const list = await API.listQuizzes();
      if (!list.length) {
        el.innerHTML = '<div class="card" style="grid-column:1/-1; text-align:center">' +
          '<p class="muted">ยังไม่มีชุดข้อสอบ</p>' +
          '<div class="row" style="justify-content:center; margin-top:12px; gap:8px">' +
          '<button class="btn btn-primary" onclick="document.getElementById(\'btn-new\').click()">+ สร้างชุดใหม่</button>' +
          '<button class="btn btn-ghost" onclick="document.getElementById(\'btn-import-open\').click()">นำเข้าข้อสอบ</button>' +
          "</div></div>";
        return;
      }
      el.innerHTML = list.map((q) =>
        '<div class="quiz-card">' +
        '<div class="row"><div class="quiz-emoji">' + esc(q.emoji || "🎯") + "</div>" +
        '<div style="min-width:0"><div style="font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">' + esc(q.title) + "</div>" +
        '<div class="tiny muted">' + q.question_count + " ข้อ" + (q.description ? " · " + esc(q.description) : "") + "</div></div></div>" +
        '<div class="row" style="gap:6px">' +
        '<button class="btn btn-sm btn-primary" data-play="' + q.id + '">เล่นเลย</button>' +
        '<button class="btn btn-sm btn-ghost" data-edit="' + q.id + '">แก้ไข</button>' +
        "</div></div>"
      ).join("");
      $$("[data-play]", el).forEach((b) => b.addEventListener("click", () => {
        location.href = "host.html?quiz=" + b.dataset.play;
      }));
      $$("[data-edit]", el).forEach((b) => b.addEventListener("click", () => openEditor(b.dataset.edit)));
    } catch (e) {
      el.innerHTML = '<p class="muted small">โหลดไม่สำเร็จ: ' + esc(e.message) + "</p>";
    }
  }

  /* ------------------------------------------------------------------ */
  /* editor                                                             */
  /* ------------------------------------------------------------------ */
  async function openEditor(id) {
    show("s-editor");
    $("#q-list").innerHTML = '<div class="loader"></div>';
    try {
      const { quiz, questions: qs } = await API.getQuiz(id);
      editing = { id: quiz.id, title: quiz.title, description: quiz.description || "", emoji: quiz.emoji || "🎯" };
      pickingEmoji = editing.emoji;
      questions = qs.map((q) => ({
        prompt: q.prompt, image_url: q.image_url || "", options: q.options.slice(),
        correct_index: q.correct_index, time_limit: q.time_limit, points: q.points
      }));
      $("#quiz-title").value = editing.title;
      $("#quiz-desc").value = editing.description;
      renderEmojiRow();
      renderQuestions();
    } catch (e) {
      toast(e.message, "err", 4000);
      await renderList();
    }
  }

  function newQuiz(title) {
    editing = { id: null, title: title || "ชุดข้อสอบใหม่", description: "", emoji: "🎯" };
    pickingEmoji = "🎯";
    questions = [];
    $("#quiz-title").value = editing.title;
    $("#quiz-desc").value = "";
    renderEmojiRow();
    addQuestion();
    show("s-editor");
  }

  function renderEmojiRow() {
    $("#emoji-row").innerHTML = EMOJIS.map((e) =>
      '<button data-emoji="' + e + '" class="' + (e === pickingEmoji ? "on" : "") + '">' + e + "</button>"
    ).join("");
    $$("[data-emoji]", $("#emoji-row")).forEach((b) => b.addEventListener("click", () => {
      pickingEmoji = b.dataset.emoji; renderEmojiRow();
    }));
  }

  function addQuestion() {
    questions.push({ prompt: "", image_url: "", options: ["", "", "", ""], correct_index: 0, time_limit: 20, points: 1000 });
    renderQuestions();
    const list = $("#q-list");
    if (list.lastElementChild) list.lastElementChild.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderQuestions() {
    const list = $("#q-list");
    $("#q-count").textContent = "(" + questions.length + " ข้อ)";
    if (!questions.length) {
      list.innerHTML = '<p class="muted small tc" style="padding:20px">ยังไม่มีคำถาม — กด “+ เพิ่มข้อ” หรือนำเข้าไฟล์</p>';
      return;
    }
    list.innerHTML = questions.map((q, qi) => {
      const opts = q.options.map((o, oi) =>
        '<div class="opt-row">' +
        '<input type="radio" name="correct-' + qi + '" data-qi="' + qi + '" data-oi="' + oi + '" ' +
        (q.correct_index === oi ? "checked" : "") + ' title="ตัวเลือกที่ถูก" />' +
        '<input type="text" data-q="' + qi + '" data-opt="' + oi + '" value="' + esc(o) + '" placeholder="ตัวเลือกที่ ' + (oi + 1) + '" />' +
        "</div>"
      ).join("");
      return '<div class="q-item" data-qi="' + qi + '">' +
        '<div class="row" style="align-items:flex-start">' +
        '<div class="qnum">' + (qi + 1) + "</div>" +
        '<textarea data-q="' + qi + '" data-prompt="1" rows="2" placeholder="พิมพ์คำถาม…" style="min-height:56px">' + esc(q.prompt) + "</textarea>" +
        '<div class="col" style="gap:4px">' +
        '<button class="btn btn-icon btn-ghost" data-act="up" data-qi="' + qi + '" title="เลื่อนขึ้น">↑</button>' +
        '<button class="btn btn-icon btn-ghost" data-act="down" data-qi="' + qi + '" title="เลื่อนลง">↓</button>' +
        '<button class="btn btn-icon btn-danger" data-act="del" data-qi="' + qi + '" title="ลบข้อนี้">✕</button>' +
        "</div></div>" +
        '<div class="col" style="gap:8px">' + opts + "</div>" +
        '<div class="row" style="gap:8px">' +
        '<button class="btn btn-sm btn-ghost" data-act="addopt" data-qi="' + qi + '">+ ตัวเลือก</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="delopt" data-qi="' + qi + '">− ตัวเลือก</button>' +
        '<div class="spacer"></div>' +
        '<span class="tiny muted">เวลา</span>' +
        '<input type="number" min="5" max="300" value="' + q.time_limit + '" data-q="' + qi + '" data-time="1" style="width:76px; padding:7px 9px" />' +
        '<span class="tiny muted">วินาที · คะแนน</span>' +
        '<input type="number" min="100" max="4000" step="100" value="' + q.points + '" data-q="' + qi + '" data-points="1" style="width:88px; padding:7px 9px" />' +
        "</div>" +
        "</div>";
    }).join("");

    $$("[data-prompt]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].prompt = t.value;
    }));
    $$("[data-opt]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].options[+t.dataset.opt] = t.value;
    }));
    $$("[data-time]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].time_limit = clamp(+t.value || 20, 5, 300);
    }));
    $$("[data-points]", list).forEach((t) => t.addEventListener("input", () => {
      questions[+t.dataset.q].points = clamp(+t.value || 1000, 100, 4000);
    }));
    $$('input[type="radio"]', list).forEach((r) => r.addEventListener("change", () => {
      questions[+r.dataset.qi].correct_index = +r.dataset.oi;
    }));
    $$("[data-act]", list).forEach((b) => b.addEventListener("click", () => {
      const qi = +b.dataset.qi;
      const act = b.dataset.act;
      if (act === "up" && qi > 0) { swap(qi, qi - 1); }
      else if (act === "down" && qi < questions.length - 1) { swap(qi, qi + 1); }
      else if (act === "del") {
        if (!confirm("ลบข้อ " + (qi + 1) + "?")) return;
        questions.splice(qi, 1); renderQuestions();
      } else if (act === "addopt") {
        if (questions[qi].options.length >= 6) { toast("สูงสุด 6 ตัวเลือก", "err"); return; }
        questions[qi].options.push(""); renderQuestions();
      } else if (act === "delopt") {
        if (questions[qi].options.length <= 2) { toast("อย่างน้อย 2 ตัวเลือก", "err"); return; }
        questions[qi].options.pop();
        if (questions[qi].correct_index >= questions[qi].options.length) questions[qi].correct_index = 0;
        renderQuestions();
      }
    }));
  }

  function swap(a, b) {
    const t = questions[a]; questions[a] = questions[b]; questions[b] = t;
    renderQuestions();
  }
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  /* ---------- save ---------- */
  function collect() {
    const title = $("#quiz-title").value.trim() || "ชุดข้อสอบไม่มีชื่อ";
    const desc = $("#quiz-desc").value.trim();
    const cleaned = [];
    for (const q of questions) {
      const prompt = (q.prompt || "").trim();
      if (!prompt) continue;
      const opts = q.options.map((o) => (o || "").trim());
      const kept = [];
      let correct = -1;
      opts.forEach((o, i) => {
        if (o) { if (i === q.correct_index) correct = kept.length; kept.push(o); }
      });
      if (kept.length < 2) continue;
      if (correct < 0) correct = 0;
      cleaned.push({
        prompt, options: kept, correct_index: correct,
        time_limit: q.time_limit || 20, points: q.points || 1000, image_url: q.image_url || ""
      });
    }
    return { title, desc, emoji: pickingEmoji, questions: cleaned };
  }

  async function save(silent) {
    const data = collect();
    if (!data.questions.length) { toast("ต้องมีอย่างน้อย 1 คำถามที่กรอกครบ", "err", 3600); return null; }
    const btns = [$("#btn-save"), $("#btn-save2"), $("#btn-play")];
    btns.forEach((b) => b && (b.disabled = true));
    try {
      if (!editing.id) {
        const q = await API.createQuiz({ title: data.title, description: data.desc, emoji: data.emoji });
        editing.id = q.id;
      } else {
        await API.updateQuiz(editing.id, { title: data.title, description: data.desc, emoji: data.emoji });
      }
      await API.replaceQuestions(editing.id, data.questions);
      if (!silent) toast("บันทึกแล้ว " + data.questions.length + " ข้อ", "ok");
      return editing.id;
    } catch (e) {
      toast(e.message, "err", 4200);
      return null;
    } finally {
      btns.forEach((b) => b && (b.disabled = false));
    }
  }

  /* ------------------------------------------------------------------ */
  /* import                                                             */
  /* ------------------------------------------------------------------ */
  function openImport(mode) {
    importMode = mode;
    parsed = [];
    $("#import-text").value = "";
    $("#import-result").innerHTML = "";
    $("#btn-import-run").textContent = "อ่านข้อมูล";
    show("s-import");
  }

  function bindStatic() {
    $("#btn-new").addEventListener("click", () => newQuiz(""));
    $("#btn-import-open").addEventListener("click", () => openImport("new"));
    $("#btn-import-q").addEventListener("click", () => openImport("append"));
    $("#btn-back").addEventListener("click", async () => { await renderList(); });
    $("#btn-save").addEventListener("click", () => save());
    $("#btn-save2").addEventListener("click", () => save());
    $("#btn-play").addEventListener("click", async () => {
      const id = await save(true);
      if (id) location.href = "host.html?quiz=" + id;
    });
    $("#btn-add-q").addEventListener("click", addQuestion);
    $("#btn-delete-quiz").addEventListener("click", async () => {
      if (!editing || !editing.id) { await renderList(); return; }
      if (!confirm("ลบชุดข้อสอบนี้ทั้งหมด?")) return;
      try { await API.deleteQuiz(editing.id); toast("ลบแล้ว", "ok"); await renderList(); }
      catch (e) { toast(e.message, "err"); }
    });
    $("#btn-import-back").addEventListener("click", () => {
      if (importMode === "append") show("s-editor"); else renderList();
    });
    $$("#s-import .tabs button").forEach((b) => b.addEventListener("click", () => {
      importTab = b.dataset.tab;
      $$("#s-import .tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("#tab-csv").classList.toggle("hidden", importTab !== "csv");
      $("#tab-json").classList.toggle("hidden", importTab !== "json");
    }));
    $("#import-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => { $("#import-text").value = r.result; };
      r.readAsText(f, "utf-8");
    });
    $("#btn-import-run").addEventListener("click", runImport);
    $("#btn-template").addEventListener("click", downloadTemplate);
  }

  function autodetect() {
    const t = $("#import-text").value.trim();
    if (!t) return;
    importTab = t.startsWith("[") || t.startsWith("{") ? "json" : "csv";
  }

  function runImport() {
    autodetect();
    const text = $("#import-text").value;
    try {
      parsed = importTab === "json" ? parseJSON(text) : parseCSV(text);
      if (!parsed.length) throw new Error("ไม่พบคำถามในข้อมูลที่วาง");
      $("#import-result").innerHTML =
        '<div class="card card-tight"><div class="row-between" style="margin-bottom:10px">' +
        '<div><b>อ่านได้ ' + parsed.length + " ข้อ</b><div class=\"tiny muted\">ตรวจตัวอย่างด้านล่างก่อนยืนยัน</div></div>" +
        '<button class="btn btn-primary" id="btn-import-confirm">' +
        (importMode === "append" ? "เพิ่มเข้าชุดนี้ (" + parsed.length + " ข้อ)" : "สร้างชุดข้อสอบใหม่") + "</button></div>" +
        '<div class="col" style="gap:8px">' + parsed.slice(0, 3).map((q, i) =>
          '<div class="q-item"><div class="row"><div class="qnum">' + (i + 1) + "</div><div style=\"font-weight:700\">" + esc(q.prompt) + "</div></div>" +
          '<div class="small muted">' + q.options.map((o, oi) =>
            (oi === q.correct_index ? '<span class="correct-tag">ถูก</span> ' : "") + esc(o)
          ).join(" · ") + "</div></div>"
        ).join("") + "</div></div>";
      $("#btn-import-confirm").addEventListener("click", confirmImport);
    } catch (e) {
      $("#import-result").innerHTML = '<div class="card card-tight" style="border-color:rgba(255,86,112,.5)">' +
        '<b style="color:#ffb3c0">อ่านข้อมูลไม่สำเร็จ</b><p class="small muted" style="margin-top:6px">' + esc(e.message) + "</p></div>";
    }
  }

  async function confirmImport() {
    if (!parsed.length) return;
    if (importMode === "append") {
      parsed.forEach((q) => questions.push(q));
      renderQuestions();
      toast("เพิ่ม " + parsed.length + " ข้อแล้ว — อย่าลืมกดบันทึก", "ok", 3600);
      show("s-editor");
      return;
    }
    const title = prompt("ชื่อชุดข้อสอบใหม่:", "ชุดข้อสอบที่นำเข้า");
    if (title === null) return;
    try {
      const q = await API.createQuiz({ title: title || "ชุดข้อสอบที่นำเข้า", description: "", emoji: "📥" });
      await API.replaceQuestions(q.id, parsed);
      toast("สร้างชุดข้อสอบ " + parsed.length + " ข้อแล้ว", "ok");
      await openEditor(q.id);
    } catch (e) { toast(e.message, "err", 4200); }
  }

  /* ------------------------------------------------------------------ */
  /* parsers                                                            */
  /* ------------------------------------------------------------------ */
  function parseCSV(text) {
    const raw = text.replace(/\r\n?/g, "\n").trim();
    const firstLine = raw.split("\n")[0];
    const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t" : ",";
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inQ) {
        if (c === '"') {
          if (raw[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
        } else cell += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === delim) { row.push(cell); cell = ""; }
        else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
        else cell += c;
      }
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (rows.length < 2) throw new Error("ต้องมีแถวหัวตารางและอย่างน้อย 1 แถวข้อมูล");

    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/^\ufeff/, ""));
    const map = header.map(headerToField);
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.join("").trim()) continue;
      const q = { options: [], correct_index: 0, time_limit: 20, points: 1000, image_url: "" };
      let correctRaw = "";
      cells.forEach((val, i) => {
        const f = map[i];
        const v = (val || "").trim();
        if (!f) return;
        if (f === "prompt") q.prompt = v;
        else if (f.startsWith("option")) {
          const n = +f.replace("option", "") - 1;
          q.options[n] = v;
        } else if (f === "correct") correctRaw = v;
        else if (f === "time_limit") q.time_limit = clamp(+v || 20, 5, 300);
        else if (f === "points") q.points = clamp(+v || 1000, 100, 4000);
        else if (f === "image_url") q.image_url = v;
      });
      q.options = q.options.filter((o) => o !== undefined && o !== null && String(o).trim() !== "");
      if (!q.prompt || q.options.length < 2) continue;
      q.correct_index = resolveCorrect(correctRaw, q.options);
      out.push(q);
    }
    if (!out.length) throw new Error("ไม่พบแถวที่มีคำถามและตัวเลือกอย่างน้อย 2 ตัวเลือก");
    return out;
  }

  function headerToField(h) {
    h = h.replace(/\s+/g, "");
    if (!h) return null;
    if (["question", "prompt", "คำถาม", "โจทย์", "คำถามที่"].includes(h)) return "prompt";
    if (["correct", "answer", "เฉลย", "คำตอบ", "คำตอบที่ถูก", "ข้อที่ถูก"].includes(h)) return "correct";
    if (["time", "time_limit", "เวลา", "เวลาวินาที", "วินาที"].includes(h)) return "time_limit";
    if (["points", "score", "คะแนน"].includes(h)) return "points";
    if (["image", "image_url", "รูป", "รูปภาพ"].includes(h)) return "image_url";
    let m = h.match(/^(option|opt|choice|ตัวเลือก|ข้อ)?([1-6])$/);
    if (m) return "option" + m[2];
    if (/^[a-f]$/.test(h)) return "option" + (h.charCodeAt(0) - 96);
    return null;
  }

  function resolveCorrect(raw, options) {
    const v = String(raw || "").trim();
    if (!v) return 0;
    let n = 0;
    if (/^[1-6]$/.test(v)) n = +v;
    else if (/^[a-fA-F]$/.test(v)) n = v.toLowerCase().charCodeAt(0) - 96;
    if (n >= 1 && n <= options.length) return n - 1;
    const idx = options.findIndex((o) => o.trim() === v);
    return idx >= 0 ? idx : 0;
  }

  function parseJSON(text) {
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.questions || data.items || []);
    if (!Array.isArray(arr)) throw new Error("JSON ต้องเป็น array ของคำถาม");
    const out = [];
    arr.forEach((item) => {
      const prompt = (item.prompt || item.question || item.q || "").toString().trim();
      let options = item.options || item.choices || item.answers;
      if (!Array.isArray(options)) {
        options = [1, 2, 3, 4, 5, 6].map((i) => item["option" + i]).filter((x) => x != null && String(x).trim() !== "");
      }
      options = (options || []).map((o) => String(o).trim()).filter(Boolean);
      if (!prompt || options.length < 2) return;
      let ci = item.correct_index;
      if (ci == null) ci = item.correctIndex;
      if (ci == null) ci = resolveCorrect(item.correct != null ? item.correct : item.answer, options);
      ci = clamp(+ci || 0, 0, options.length - 1);
      out.push({
        prompt, options, correct_index: ci,
        time_limit: clamp(+item.time_limit || +item.time || 20, 5, 300),
        points: clamp(+item.points || 1000, 100, 4000),
        image_url: item.image_url || item.image || ""
      });
    });
    if (!out.length) throw new Error("ไม่พบคำถามที่สมบูรณ์ใน JSON");
    return out;
  }

  function downloadTemplate() {
    const rows = [
      ["question", "option1", "option2", "option3", "option4", "correct", "time_limit", "points"],
      ["ข้อใดคือเมืองหลวงของประเทศไทย", "เชียงใหม่", "กรุงเทพมหานคร", "ขอนแก่น", "ภูเก็ต", "2", "20", "1000"],
      ["1 + 1 เท่ากับเท่าไร", "1", "2", "3", "4", "2", "10", "1000"]
    ];
    const csv = "\ufeff" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "quiz-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
})();
