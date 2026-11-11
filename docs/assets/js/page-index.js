/* หน้าแรก: ผู้เล่นกรอก PIN / ผู้จัดเข้าสู่ระบบ */
(function () {
  const { $, $$, param } = U;
  const pinInput = $("#pin-input");
  let authMode = "login";
  let loggedIn = false;

  /* ---------- ผู้เล่น ---------- */
  // ถ้ามี ?pin= มาจาก QR ให้ข้ามไปหน้าผู้เล่นเลย
  const preset = param("pin");
  if (preset) {
    const p = String(preset).replace(/\D/g, "").slice(0, 6);
    if (p.length === 6) { location.replace("play.html?pin=" + p); return; }
  }

  pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 6);
    if (pinInput.value.length === 6) setTimeout(() => $("#join-form").requestSubmit(), 120);
  });

  $("#join-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pin = pinInput.value.replace(/\D/g, "");
    if (pin.length !== 6) { U.toast("PIN ต้องมี 6 หลัก", "err"); pinInput.focus(); return; }
    location.href = "play.html?pin=" + pin;
  });

  /* ---------- ผู้จัด ---------- */
  $$("#auth-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      authMode = b.dataset.mode;
      $$("#auth-tabs button").forEach((x) => x.classList.toggle("on", x === b));
      $("#auth-submit").textContent = authMode === "login" ? "เข้าสู่ระบบ →" : "สมัครและเริ่มใช้งาน →";
      $("#password").autocomplete = authMode === "login" ? "current-password" : "new-password";
    });
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loggedIn) { location.href = "admin.html"; return; }
    const btn = $("#auth-submit");
    const email = $("#email").value.trim();
    const password = $("#password").value;
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "กำลังดำเนินการ…";
    try {
      if (authMode === "login") await API.signIn(email, password);
      else await API.signUp(email, password);
      location.href = "admin.html";
    } catch (err) {
      U.toast(err.message, "err", 4000);
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  /* ถ้าเข้าสู่ระบบอยู่แล้ว แสดงทางลัด */
  API.currentUser().then((u) => {
    if (!u) return;
    loggedIn = true;
    const head = $("#host .card-head");
    if (head.querySelector(".pill")) head.querySelector(".pill").outerHTML = '<span class="pill pill-ok">เข้าสู่ระบบแล้ว</span>';
    $("#auth-submit").textContent = "ไปที่ห้องทำงาน →";
  }).catch(() => { });
})();
