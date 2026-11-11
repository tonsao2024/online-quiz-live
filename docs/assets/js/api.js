/* ชั้นเชื่อมต่อ Supabase — ทุกหน้าจอเรียกผ่าน API.* เท่านั้น */
(function () {
  const cfg = window.QUIZ_CONFIG || {};
  const ERRORS = {
    room_not_found: "ไม่พบห้องนี้ — ตรวจสอบ PIN อีกครั้ง",
    game_started: "เกมเริ่มแล้ว รอรอบถัดไปนะ",
    nickname_taken: "ชื่อนี้มีคนใช้แล้ว ลองเติมชื่ออื่น",
    nickname_required: "กรุณาใส่ชื่อของคุณ",
    time_up: "หมดเวลาข้อนี้แล้ว",
    already_answered: "คุณตอบข้อนี้ไปแล้ว",
    not_open: "ข้อนี้ปิดรับคำตอบแล้ว",
    player_not_found: "ไม่พบผู้เล่นนี้ กรุณาเข้าห้องใหม่",
    question_not_found: "ไม่พบข้อคำถาม",
    quiz_empty: "ชุดข้อสอบนี้ยังไม่มีคำถาม",
    quiz_not_found: "ไม่พบชุดข้อสอบ",
    forbidden: "คุณไม่มีสิทธิ์ในห้องนี้",
    not_authenticated: "กรุณาเข้าสู่ระบบก่อน",
    pin_unavailable: "สร้าง PIN ไม่สำเร็จ ลองอีกครั้ง"
  };
  const msg = (code) => ERRORS[code] || "เกิดข้อผิดพลาด: " + code;

  let sb = null;
  function client() {
    if (!sb) {
      if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error("ยังไม่ได้ตั้งค่า Supabase ใน config.js");
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return sb;
  }

  async function rpc(fn, args) {
    const { data, error } = await client().rpc(fn, args || {});
    if (error) { console.error("[rpc]", fn, error); throw new Error(error.message || "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); }
    if (data && data.error) { const e = new Error(msg(data.error)); e.code = data.error; throw e; }
    return data;
  }

  const API = {
    /* ---------- auth ---------- */
    async currentUser() {
      const { data } = await client().auth.getUser();
      return data ? data.user : null;
    },
    async signIn(email, password) {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error) throw new Error(thaiAuthError(error.message));
      return data.user;
    },
    async signUp(email, password) {
      const { data, error } = await client().auth.signUp({ email, password });
      if (error) throw new Error(thaiAuthError(error.message));
      if (!data.session) throw new Error("สมัครไม่สำเร็จ กรุณายืนยันอีเมลแล้วเข้าสู่ระบบ");
      return data.user;
    },
    async signOut() { await client().auth.signOut(); },

    /* ---------- quiz library ---------- */
    async listQuizzes() {
      const { data, error } = await client().from("quizzes").select("*").order("updated_at", { ascending: false });
      if (error) throw new Error(error.message);
      const { data: qs } = await client().from("questions").select("quiz_id");
      const counts = {};
      (qs || []).forEach((q) => { counts[q.quiz_id] = (counts[q.quiz_id] || 0) + 1; });
      return (data || []).map((q) => ({ ...q, question_count: counts[q.id] || 0 }));
    },
    async getQuiz(id) {
      const { data: quiz, error } = await client().from("quizzes").select("*").eq("id", id).single();
      if (error) throw new Error(error.message);
      const { data: questions, error: e2 } = await client().from("questions").select("*")
        .eq("quiz_id", id).order("position", { ascending: true });
      if (e2) throw new Error(e2.message);
      return { quiz, questions: questions || [] };
    },
    async createQuiz(payload) {
      const user = await API.currentUser();
      if (!user) throw new Error("กรุณาเข้าสู่ระบบก่อน");
      const { data, error } = await client().from("quizzes")
        .insert({ title: payload.title, description: payload.description || null, emoji: payload.emoji || "🎯", owner_id: user.id })
        .select().single();
      if (error) throw new Error(error.message);
      return data;
    },
    async updateQuiz(id, patch) {
      const { error } = await client().from("quizzes").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async deleteQuiz(id) {
      const { error } = await client().from("quizzes").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    async replaceQuestions(quizId, questions) {
      const { error: e1 } = await client().from("questions").delete().eq("quiz_id", quizId);
      if (e1) throw new Error(e1.message);
      if (!questions.length) return;
      const rows = questions.map((q, i) => ({
        quiz_id: quizId, position: i, prompt: q.prompt, image_url: q.image_url || null,
        options: q.options, correct_index: q.correct_index,
        time_limit: q.time_limit || 20, points: q.points || 1000
      }));
      const { error } = await client().from("questions").insert(rows);
      if (error) throw new Error(error.message);
    },

    /* ---------- host ---------- */
    createRoom: (quizId, allowLate) => rpc("create_room", { p_quiz_id: quizId, p_allow_late: !!allowLate }),
    hostSnapshot: (roomId) => rpc("host_snapshot", { p_room_id: roomId }),
    nextQuestion: (roomId) => rpc("host_next_question", { p_room_id: roomId }),
    setStatus: (roomId, status) => rpc("host_set_status", { p_room_id: roomId, p_status: status }),
    hostStats: (roomId, questionId) => rpc("host_question_stats", { p_room_id: roomId, p_question_id: questionId }),
    async setAllowLate(roomId, allow) {
      const { error } = await client().from("rooms").update({ allow_late: !!allow }).eq("id", roomId);
      if (error) throw new Error(error.message);
    },
    async myRooms() {
      const { data, error } = await client().from("rooms").select("id,pin,status,created_at,quiz_id")
        .order("created_at", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      return data || [];
    },

    /* ---------- player ---------- */
    joinRoom: (pin, nickname) => rpc("join_room", { p_pin: pin, p_nickname: nickname }),
    resume: (token) => rpc("player_resume", { p_token: token }),
    roomState: (pin) => rpc("room_public_state", { p_pin: pin }),
    submitAnswer: (token, questionId, choice) =>
      rpc("submit_answer", { p_token: token, p_question_id: questionId, p_choice: choice }),
    leaderboard: (pin, limit) => rpc("room_leaderboard", { p_pin: pin, p_limit: limit || 500 }),

    /* ---------- realtime ---------- */
    subscribeRoom(pin, onSync) {
      try {
        const ch = client().channel("room:" + pin, { config: { broadcast: { self: false } } });
        ch.on("broadcast", { event: "sync" }, (p) => { try { onSync(p && p.payload); } catch (e) { console.error(e); } });
        ch.subscribe();
        return {
          send() { try { ch.send({ type: "broadcast", event: "sync", payload: { t: Date.now() } }); } catch (e) { /* ไม่เป็นไร มี polling สำรอง */ } },
          close() { try { client().removeChannel(ch); } catch (e) { } }
        };
      } catch (e) {
        console.warn("realtime unavailable", e);
        return { send() { }, close() { } };
      }
    }
  };

  function thaiAuthError(m) {
    m = String(m || "");
    if (/invalid login credentials/i.test(m)) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
    if (/email not confirmed/i.test(m)) return "ยังไม่ได้ยืนยันอีเมล";
    if (/already registered|already exists/i.test(m)) return "อีเมลนี้มีบัญชีอยู่แล้ว";
    if (/password should be at least/i.test(m)) return "รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)";
    if (/rate limit/i.test(m)) return "ลองบ่อยเกินไป กรุณารอสักครู่";
    return m;
  }

  window.API = API;
})();
