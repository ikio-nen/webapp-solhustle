/* ============================================================
   Solhustle UI components JS — vanilla implementations.
   Depends on: /js/common.js (api, esc, session helpers).
   Additive only.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 1. Constellation mouse-motion grid ---------- */
  const Constellation = {
    init(canvasId, opts) {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return;
      const o = Object.assign({ count: 70, linkDist: 130, mouseDist: 180, speed: 0.35 }, opts || {});
      const ctx = canvas.getContext("2d");
      let w, h, pts = [];
      const mouse = { x: -9999, y: -9999 };

      function resize() {
        const r = canvas.parentElement.getBoundingClientRect();
        w = canvas.width = r.width; h = canvas.height = r.height;
      }
      function spawn() {
        pts = Array.from({ length: o.count }, () => ({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * o.speed, vy: (Math.random() - 0.5) * o.speed,
          r: Math.random() * 1.8 + 0.8
        }));
      }
      function frame() {
        ctx.clearRect(0, 0, w, h);
        for (const p of pts) {
          // gentle mouse repulsion
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const d = Math.hypot(dx, dy);
          if (d < o.mouseDist && d > 1) {
            p.vx += (dx / d) * 0.045; p.vy += (dy / d) * 0.045;
          }
          p.vx *= 0.985; p.vy *= 0.985;
          // keep a minimum drift so it never freezes
          if (Math.hypot(p.vx, p.vy) < 0.08) { p.vx += (Math.random() - 0.5) * 0.05; p.vy += (Math.random() - 0.5) * 0.05; }
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          p.x = Math.max(0, Math.min(w, p.x)); p.y = Math.max(0, Math.min(h, p.y));
        }
        // links
        for (let i = 0; i < pts.length; i++) {
          for (let j = i + 1; j < pts.length; j++) {
            const a = pts[i], b = pts[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < o.linkDist) {
              ctx.strokeStyle = `rgba(110,168,254,${(1 - d / o.linkDist) * 0.28})`;
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            }
          }
          // mouse link
          const p = pts[i];
          const md = Math.hypot(p.x - mouse.x, p.y - mouse.y);
          if (md < o.mouseDist) {
            ctx.strokeStyle = `rgba(74,222,128,${(1 - md / o.mouseDist) * 0.45})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
          ctx.fillStyle = "rgba(140,190,255,.75)";
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
        requestAnimationFrame(frame);
      }
      const wrap = canvas.parentElement;
      wrap.addEventListener("mousemove", (e) => {
        const r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      });
      wrap.addEventListener("mouseleave", () => { mouse.x = -9999; mouse.y = -9999; });
      window.addEventListener("resize", () => { resize(); });
      resize(); spawn(); frame();
    }
  };

  /* ---------- 2. Global loading spinner ---------- */
  const SolSpinner = {
    el: null,
    ensure() {
      if (this.el) return this.el;
      const d = document.createElement("div");
      d.className = "sol-spinner-overlay";
      d.id = "sol-spinner";
      d.innerHTML = `<div class="v-spinner"><div class="ring"></div><div class="ring r2"></div><div class="dot"></div></div><p id="sol-spinner-msg">loading…</p>`;
      document.body.appendChild(d);
      this.el = d;
      return d;
    },
    show(msg) {
      const el = this.ensure();
      if (msg) el.querySelector("#sol-spinner-msg").textContent = msg;
      el.classList.add("on");
    },
    hide() { if (this.el) this.el.classList.remove("on"); }
  };

  /* ---------- 3. diceui-style pending button ---------- */
  async function pendingBtn(btn, fn) {
    if (!btn || btn.classList.contains("pending")) return;
    const orig = btn.innerHTML;
    btn.classList.add("pending");
    btn.setAttribute("aria-busy", "true");
    const label = btn.textContent.trim();
    btn.innerHTML = `<span class="btn-spin"></span>${label}`;
    try { await fn(); }
    finally {
      btn.classList.remove("pending");
      btn.removeAttribute("aria-busy");
      btn.innerHTML = orig;
    }
  }

  /* ---------- 4. Stepper (work-in-progress) ---------- */
  const JOB_STEPS = [
    { key: "posted",      lbl: "Posted",      sub: "Job published to marketplace" },
    { key: "funded",      lbl: "Funded",      sub: "SOL locked in escrow vault" },
    { key: "in_progress", lbl: "In Progress", sub: "Freelancer is working" },
    { key: "delivered",   lbl: "Delivered",   sub: "Work submitted for review" },
    { key: "released",    lbl: "Released",    sub: "Payment released on-chain" }
  ];
  function jobStepIndex(status) {
    const order = ["open", "funded", "in_progress", "delivered", "released"];
    // "open" maps to Posted; anything unknown clamps sensibly
    const i = order.indexOf(status);
    return i === -1 ? 0 : i;
  }
  function stepperHTML(status) {
    const cur = jobStepIndex(status);
    return `<div class="stepper">` + JOB_STEPS.map((s, i) => {
      const cls = i < cur ? "done" : (i === cur ? "now" : "");
      const mark = i < cur ? "✓" : (i + 1);
      return `<div class="step ${cls}">
        <div class="dot">${mark}</div>
        <div class="lbl">${s.lbl}</div>
        <div class="sub">${s.sub}</div>
      </div>`;
    }).join("") + `</div>`;
  }

  /* ---------- 5. Notifications (mention-alert style) ---------- */
  const Notifications = {
    async fetchAll(token) {
      try {
        const d = await api("GET", "/me/notifications", undefined, token);
        return d.notifications || [];
      } catch (e) { return []; }
    },
    mount(bellId, token, onCount) {
      const bell = document.getElementById(bellId);
      if (!bell) return;
      const panel = document.createElement("div");
      panel.className = "notif-panel";
      panel.id = bellId + "-panel";
      bell.style.position = "relative";
      bell.appendChild(panel);
      bell.querySelector(".notif-bell-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        panel.classList.toggle("open");
        if (panel.classList.contains("open")) this.render(panel, token, bellId);
      });
      document.addEventListener("click", (e) => {
        if (!panel.contains(e.target)) panel.classList.remove("open");
      });
      this.refreshBadge(bellId, token, onCount);
      // poll every 45s
      setInterval(() => this.refreshBadge(bellId, token, onCount), 45000);
    },
    async refreshBadge(bellId, token, onCount) {
      const list = await this.fetchAll(token);
      const unread = list.filter(n => n.status === "unread").length;
      const badge = document.querySelector("#" + bellId + " .notif-badge");
      if (badge) { badge.textContent = unread; badge.style.display = unread ? "" : "none"; }
      if (onCount) onCount(list);
    },
    async render(panel, token, bellId) {
      const list = await this.fetchAll(token);
      if (!list.length) {
        panel.innerHTML = `<div class="notif-empty">🔕 No notifications yet.<br/>Job invites will appear here.</div>`;
        return;
      }
      panel.innerHTML = list.map(n => {
        const title = esc(n.title || "Notification");
        const msg = esc(n.message || "");
        const when = esc(n.created_at || n.time || "");
        const init = (n.title || "S").trim().charAt(0).toUpperCase();
        const canRespond = n.status === "unread" && /invite|shortlist|select/i.test(title + " " + msg);
        return `<div class="notif-row ${n.status === "unread" ? "unread" : ""}">
          <div class="n-ava">${init}</div>
          <div class="n-body">
            <p class="n-text"><b>${title}</b><br/>${msg}</p>
            <span class="n-time">${when} · ${esc(n.status || "")}</span>
            ${canRespond ? `<div class="n-actions">
              <button class="mini-btn go" data-nid="${n.id}" data-act="approve">Accept</button>
              <button class="mini-btn no" data-nid="${n.id}" data-act="decline">Decline</button>
            </div>` : ""}
          </div>
        </div>`;
      }).join("");
      panel.querySelectorAll("[data-nid]").forEach(b => {
        b.onclick = async () => {
          await pendingBtn(b, async () => {
            const r = await api("POST", `/notifications/${b.dataset.nid}/respond`, { action: b.dataset.act }, token);
            toast(r.message || "Done");
            this.render(panel, token, bellId);
            this.refreshBadge(bellId, token);
          });
        };
      });
    }
  };

  /* ---------- 6. Glass freelancer profile modal ---------- */
  async function openFreelancerProfile(fid, token) {
    let back = document.getElementById("glass-profile-back");
    if (!back) {
      back = document.createElement("div");
      back.className = "glass-modal-backdrop";
      back.id = "glass-profile-back";
      back.innerHTML = `<div class="glass-card" id="glass-profile-card"></div>`;
      document.body.appendChild(back);
      back.addEventListener("click", (e) => { if (e.target === back) back.classList.remove("open"); });
    }
    const card = document.getElementById("glass-profile-card");
    card.innerHTML = `<div style="padding:40px; text-align:center;" class="dim">loading profile…</div>`;
    back.classList.add("open");
    try {
      const d = await api("GET", "/freelancer/profile/" + fid, undefined, token);
      const p = d.profile || {};
      const u = d.user || {};
      const st = d.stats || {};
      const name = esc(u.username || ("freelancer #" + fid));
      const init = name.charAt(0).toUpperCase();
      const langs = String(p.languages || "").split(",").map(s => s.trim()).filter(Boolean);
      const degs = String(p.degrees || "").split(",").map(s => s.trim()).filter(Boolean);
      const tags = langs.concat(degs).map(t => `<span class="pill">${esc(t)}</span>`).join("");
      const portfolio = (d.portfolio || []).map(it =>
        `<div style="margin-top:8px;"><a href="${esc(it.url || "#")}" target="_blank" style="color:var(--acc); font-size:13px;">🔗 ${esc(it.title || it.url || "portfolio item")}</a></div>`
      ).join("");
      card.innerHTML = `
        <button class="glass-close" onclick="document.getElementById('glass-profile-back').classList.remove('open')">✕</button>
        <div class="glass-head">
          <div class="glass-ava">${init}</div>
          <div>
            <h2>${name}</h2>
            <div class="role">${esc(p.headline || "Solana Freelancer")}</div>
            <div class="dim" style="font-size:12px; margin-top:4px;">${esc(p.bio || "")}</div>
          </div>
        </div>
        <div class="glass-stats">
          <div class="glass-stat"><b>${st.avg_rating ?? "—"}</b><span>rating</span></div>
          <div class="glass-stat"><b>${st.settled_jobs ?? 0}</b><span>jobs done</span></div>
          <div class="glass-stat"><b>${p.points ?? 0}</b><span>points</span></div>
          <div class="glass-stat"><b>${p.hourly_rate_sol ?? "—"}</b><span>SOL / hr</span></div>
        </div>
        <div class="glass-meta">
          <div><span class="k">Age</span><br/><span class="v">${p.age ?? "—"}</span></div>
          <div><span class="k">Experience</span><br/><span class="v">${p.years_experience ?? "—"} yrs</span></div>
          <div><span class="k">Wallet</span><br/><span class="v mono" style="font-size:11px;">${esc((u.wallet_address || "").slice(0, 12))}…</span></div>
          <div><span class="k">Status</span><br/><span class="v">${esc(u.status || "active")}</span></div>
        </div>
        ${tags ? `<div class="glass-tags">${tags}</div>` : ""}
        ${portfolio ? `<div style="margin-top:10px;"><b style="font-size:13px;">Portfolio</b>${portfolio}</div>` : ""}`;
    } catch (e) {
      card.innerHTML = `<div style="padding:40px; text-align:center;" class="dim">Could not load profile.</div>`;
    }
  }

  /* ---------- 7. Shortlist (applicant dropdown) ---------- */
  async function renderShortlist(menuEl, jobId, token, opts) {
    opts = opts || {};
    const list = await (async () => {
      try { const d = await api("GET", `/jobs/${jobId}/applications`, undefined, token); return d.applications || []; }
      catch (e) { return []; }
    })();
    if (!list.length) {
      menuEl.innerHTML = `<div class="notif-empty">No applications yet.<br/>Share the job link to get applicants.</div>`;
      return;
    }
    menuEl.innerHTML = list.map(a => {
      const fid = a.freelancer_id || a.user_id;
      const nm = esc(a.username || ("freelancer #" + fid));
      const init = nm.charAt(0).toUpperCase();
      const st = a.status || "pending";
      return `<div class="applicant-row">
        <div class="a-ava">${init}</div>
        <div class="a-info"><b>${nm}</b><span>${esc(a.cover_note || a.message || "—")} · ${esc(st)}</span></div>
        <div class="a-actions">
          <button class="mini-btn" data-view="${fid}">Profile</button>
          ${st === "pending" ? `<button class="mini-btn go" data-acc="${a.id}">Hire</button><button class="mini-btn no" data-dec="${a.id}">✕</button>` : `<span class="pill ${st === "accepted" ? "ok" : ""}">${esc(st)}</span>`}
        </div>
      </div>`;
    }).join("");
    menuEl.querySelectorAll("[data-view]").forEach(b => b.onclick = (e) => { e.stopPropagation(); openFreelancerProfile(b.dataset.view, token); });
    menuEl.querySelectorAll("[data-acc]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await pendingBtn(b, async () => {
        await api("POST", `/jobs/${jobId}/applications/${b.dataset.acc}/accept`, {}, token);
        toast("Freelancer hired — invite sent 🔔");
        renderShortlist(menuEl, jobId, token, opts);
        if (opts.onChange) opts.onChange();
      });
    });
    menuEl.querySelectorAll("[data-dec]").forEach(b => b.onclick = async (e) => {
      e.stopPropagation();
      await pendingBtn(b, async () => {
        await api("POST", `/jobs/${jobId}/applications/${b.dataset.dec}/decline`, {}, token);
        renderShortlist(menuEl, jobId, token, opts);
        if (opts.onChange) opts.onChange();
      });
    });
  }

  function toast(msg) {
    let t = document.getElementById("sol-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "sol-toast";
      t.style.cssText = "position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--card2);border:1px solid var(--acc);color:#fff;padding:10px 20px;border-radius:999px;font-size:13px;z-index:500;opacity:0;transition:all .3s ease;pointer-events:none;";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1"; t.style.transform = "translateX(-50%)";
    clearTimeout(t._h);
    t._h = setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(-50%) translateY(20px)"; }, 2600);
  }

  // expose
  window.SolUI = { Constellation, SolSpinner, pendingBtn, stepperHTML, jobStepIndex, Notifications, openFreelancerProfile, renderShortlist, toast };
})();
