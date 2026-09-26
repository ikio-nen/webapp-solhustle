/* Solhustle GSAP enhancement layer — additive only.
   - If GSAP fails to load (offline CDN), this file exits silently and the
     site behaves exactly as before.
   - Respects prefers-reduced-motion.
   - All tweens clear their inline styles afterwards, so the page returns
     to its exact original styling.
   - Does NOT touch common.js / app.js logic; it only observes the DOM. */
(function () {
  "use strict";
  if (!window.gsap) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var gsap = window.gsap;

  /* --- Page-load entrance: nav slides down, cards stagger up ---
     Runs on window load (after each page's inline script has called
     renderNavbar) with a fallback timer in case load is delayed. */
  var entered = false;
  function entranceOnce() {
    if (entered) return;
    entered = true;
    entrance();
  }
  function entrance() {
    var nav = document.querySelector(".app-nav");
    if (nav) {
      gsap.from(nav, { y: -18, opacity: 0, duration: 0.5, ease: "power3.out", clearProps: "all" });
    }
    var cards = document.querySelectorAll("main .card");
    if (cards.length) {
      gsap.from(cards, {
        y: 26,
        opacity: 0,
        duration: 0.55,
        ease: "power3.out",
        stagger: 0.06,
        clearProps: "all",
        delay: 0.08,
      });
    }
    var heroTitle = document.querySelector("main h1");
    if (heroTitle) {
      gsap.from(heroTitle, { y: 14, opacity: 0, duration: 0.6, ease: "power3.out", clearProps: "all" });
    }
  }

  if (document.readyState === "complete") {
    entranceOnce();
  } else {
    window.addEventListener("load", entranceOnce);
    setTimeout(entranceOnce, 2500); // fallback if load hangs on a slow asset
  }

  /* --- Dynamically-created overlays (login gate, tx signer modal):
         fade the backdrop in whenever they are shown. --- */
  var OVERLAY_IDS = ["portal-login-overlay", "tx-modal-overlay"];
  var faded = new WeakSet();
  // Throttle map: the MutationObserver below also fires on the style writes
  // our own GSAP tween performs. Without this, each tween tick re-triggers
  // fadeOverlay -> new tween -> new tick... an exponential pile-up that
  // crashes the tab (Aw, Snap! Out of Memory) on the login gate.
  var lastFade = new WeakMap();

  function fadeOverlay(el) {
    if (el.style.display === "none") return;
    var now = (window.performance && performance.now()) || Date.now();
    if (lastFade.has(el) && now - lastFade.get(el) < 600) return; // observer echo; ignore
    lastFade.set(el, now);
    gsap.killTweensOf(el);
    gsap.fromTo(
      el,
      { opacity: 0 },
      { opacity: 1, duration: 0.28, ease: "power2.out", clearProps: "opacity" }
    );
    // gentle pop for the dialog box inside, if it has one
    var box = el.querySelector(".modal-card, .tx-card");
    if (box && !faded.has(box)) {
      faded.add(box);
      gsap.from(box, { y: 14, scale: 0.98, duration: 0.32, ease: "back.out(1.4)", clearProps: "all" });
    }
  }

  function isOverlay(node) {
    return node && node.nodeType === 1 && OVERLAY_IDS.indexOf(node.id) !== -1;
  }

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type === "childList") {
        m.addedNodes.forEach(function (n) {
          if (isOverlay(n)) fadeOverlay(n);
          else if (n.nodeType === 1 && n.querySelector) {
            OVERLAY_IDS.forEach(function (id) {
              var found = n.id === id ? n : n.querySelector("#" + id);
              if (found) fadeOverlay(found);
            });
          }
        });
      } else if (m.type === "attributes" && isOverlay(m.target)) {
        fadeOverlay(m.target);
      }
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
})();
