/**
 * AI Chat Widget SDK
 * Embeddable chat widget for WordPress and other websites
 * Version: 2.0.0
 *
 * WHAT'S NEW vs v1:
 *  - Dual-mode: "Chat With Us" (general) vs "Schedule an Appointment" (booking)
 *  - Conversational inline form: First Name → Last Name → Email → Practitioner
 *  - Practitioner autocomplete with badge UI
 *  - Slot card UI with "See all available slots" overlay
 *  - `mode` field sent with every API request
 *  - SID regenerated on every widget close/reset (prevents stale session context)
 *  - Booking-intent detection upgrades general→booking mode mid-conversation
 *  - Full state clear on appointment confirmed
 */

(function (window) {
  "use strict";

  if (window.AIChatWidget) {
    console.warn("AI Chat Widget already initialized");
    return;
  }

  // ── tiny UUID helper ────────────────────────────────────────────────────────
  function generateUUID() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ── booking-intent keywords (used to auto-upgrade general→booking) ──────────
  const BOOKING_INTENT_PATTERNS = [
    /\bbook\b/i,
    /\bschedul/i,
    /\bappointment\b/i,
    /\breserv/i,
    /\bvisit\b/i,
    /\bsee a doctor\b/i,
    /\bcome in\b/i,
    /\bsign me up\b/i,
    /\bset up\b/i,
    /\bi want to (book|schedule|make|get)\b/i,
    /\bi'd like to (book|schedule|make|get)\b/i,
    /\bcan i (book|schedule|make|get)\b/i,
    /\bi need (an appointment|a slot|to book|to schedule)\b/i,
  ];

  function detectsBookingIntent(text) {
    return BOOKING_INTENT_PATTERNS.some((re) => re.test(text));
  }

  // ── welcome message shown in general mode ───────────────────────────────────
  const WELCOME_MSG =
    "Welcome to One Chiropractic Studio! 🏥\n\n" +
    "We're a network of chiropractic clinics across the Netherlands with locations in Utrecht, Amsterdam, Rotterdam, The Hague, Haarlem, Arnhem, Gouda, and Amersfoort.\n\n" +
    "Our Services:\n" +
    "• ONE Adjustment - Regular chiropractic adjustments\n" +
    "• Initial Assessment - Comprehensive first visit evaluation\n\n" +
    "Why Choose Us:\n" +
    "✓ Experienced practitioners\n" +
    "✓ Modern facilities\n" +
    "✓ Convenient locations\n" +
    "✓ Easy online booking\n\n" +
    "Would you like to schedule an appointment, or do you have any questions?";

  // ════════════════════════════════════════════════════════════════════════════
  // MAIN CLASS
  // ════════════════════════════════════════════════════════════════════════════
  class AIChatWidget {
    constructor(config = {}) {
      this.config = {
        apiUrl: config.apiUrl || "http://127.0.0.1:3000/api/chat",
        practitionerSearchUrl:
          config.practitionerSearchUrl ||
          "http://127.0.0.1:3000/api/practitioners/search",
        position: config.position || "bottom-right",
        primaryColor: config.primaryColor || "#0078d4",
        zIndex: config.zIndex || 1000,
        headerTitle: config.headerTitle || "One Chiropractic Studio",
        headerSubtitle: config.headerSubtitle || "The team can also help",
        ...config,
      };

      // session / state
      this.SID = generateUUID();
      this.chatMode = "general"; // "general" | "booking"
      this.bs = {
        patientId: null,
        practitionerId: null,
        locationId: null,
        appointmentTypeId: null,
        selectedSlot: null,
      };
      this.busy = false;
      this.curOpts = null;
      this.isOpen = false;
      this.curScreen = "welcome"; // "welcome" | "chat"

      // practitioner autocomplete state
      this.selectedPract = null;
      this.practDebounce = null;
      this.practHighlight = -1;

      this.init();
    }

    _loadFontAwesome() {
      const id = "ai-chat-widget-fa";
      if (document.getElementById(id)) return; // already loaded
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href =
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
      document.head.appendChild(link);
    }

    // ── INIT ──────────────────────────────────────────────────────────────────
    init() {
      this._loadFontAwesome();
      this.injectStyles();
      this.buildDOM();
      this.attachListeners();
      if (this.config.autoOpen) setTimeout(() => this.openWidget(), 500);
    }

    // ── STYLES ────────────────────────────────────────────────────────────────
    injectStyles() {
      const id = "ai-chat-widget-styles-v2";
      if (document.getElementById(id)) return;

      const p = this.config.primaryColor;
      const pd = this._darken(p, 20);
      const pl = this._lighten(p);

      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        /* ── container ── */
        .aiw-root {
          --aiw-p:  ${p};
          --aiw-pd: ${pd};
          --aiw-pl: ${pl};
          --aiw-text: #1a1a1a;
          --aiw-light: #888;
          --aiw-border: #e8e8e8;
          --aiw-success: #22c55e;
          --aiw-success-bg: #f0fdf4;
          position: fixed;
          ${this._posCSS()}
          z-index: ${this.config.zIndex};
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .aiw-root * { margin:0; padding:0; box-sizing:border-box; }

        /* ── launcher button ── */
        .aiw-launcher {
          position: relative;
          width: 56px; height: 56px;
          border-radius: 50%;
          background: var(--aiw-p);
          color: white; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          font-size: 22px;
          box-shadow: 0 4px 16px rgba(0,120,212,.35);
          transition: all .25s ease;
          z-index: ${this.config.zIndex + 1};
        }
        .aiw-launcher:hover { background: var(--aiw-pd); transform: translateY(-2px); }
        .aiw-launcher.open  { background: #555; }

        /* ── widget panel ── */
        .aiw-panel {
          position: absolute;
          ${this.config.position.includes("right") ? "right:0;" : "left:0;"}
          bottom: calc(56px + 16px);
          width: 390px; height: 580px;
          background: white;
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0,0,0,.14);
          display: flex; flex-direction: column;
          overflow: hidden;
          opacity: 0; visibility: hidden;
          transform: translateY(16px) scale(.97);
          transition: all .3s cubic-bezier(.4,0,.2,1);
        }
        .aiw-panel.active {
          opacity: 1; visibility: visible;
          transform: translateY(0) scale(1);
        }

        /* ── header ── */
        .aiw-header {
          display: flex; align-items: center; gap: 10px;
          padding: 13px 14px;
          border-bottom: 1px solid var(--aiw-border);
          background: white; flex-shrink: 0;
        }
        .aiw-hbtn {
          width:30px; height:30px; border-radius:50%; border:none;
          cursor:pointer; display:flex; align-items:center; justify-content:center;
          background:transparent; color:#888; font-size:13px; transition:background .2s;
          flex-shrink:0;
        }
        .aiw-hbtn:hover { background:#f2f2f2; color:#333; }
        .aiw-hlogo {
          width:36px; height:36px; border-radius:10px;
          background: linear-gradient(135deg,#4fc3f7,var(--aiw-p));
          display:flex; align-items:center; justify-content:center;
          color:white; font-size:17px; flex-shrink:0;
          box-shadow: 0 2px 8px rgba(0,120,212,.2);
        }
        .aiw-htitle { flex:1; }
        .aiw-htitle strong { display:block; font-size:14.5px; font-weight:600; color:var(--aiw-text); }
        .aiw-htitle span   { font-size:11px; color:#aaa; }

        /* ── screens ── */
        .aiw-screen { flex:1; display:none; flex-direction:column; overflow:hidden; }
        .aiw-screen.active { display:flex; }

        /* ── welcome screen ── */
        .aiw-welcome-body {
          flex:1; padding:28px 22px 16px; overflow-y:auto;
        }
        .aiw-how { text-align:center; font-size:13px; color:var(--aiw-light); margin-bottom:22px; }
        .aiw-greet-row {
          display:flex; align-items:flex-start; gap:10px;
          animation: aiw-fadeUp .4s ease both;
        }
        .aiw-g-av {
          width:36px; height:36px; border-radius:50%;
          background:linear-gradient(135deg,#4fc3f7,var(--aiw-p));
          display:flex; align-items:center; justify-content:center;
          color:white; font-size:15px; flex-shrink:0; margin-top:2px;
        }
        .aiw-g-bubble {
          background:#f2f2f2; border-radius:18px 18px 18px 4px;
          padding:12px 15px; font-size:14px; color:var(--aiw-text);
          line-height:1.5; max-width:255px;
        }
        .aiw-g-meta { font-size:11px; color:var(--aiw-light); margin-top:5px; }
        .aiw-welcome-actions {
          flex-shrink:0; padding:14px 22px 22px;
          display:flex; gap:10px; justify-content:center;
          border-top:1px solid var(--aiw-border);
        }
        .aiw-pill {
          padding:10px 20px; border-radius:999px;
          border:1.5px solid var(--aiw-border);
          background:white; color:var(--aiw-p);
          font-size:13.5px; font-weight:500; cursor:pointer;
          transition:all .2s; white-space:nowrap; font-family:inherit;
        }
        .aiw-pill:hover {
          background:var(--aiw-pl); border-color:var(--aiw-p);
          transform:translateY(-1px);
          box-shadow:0 3px 10px rgba(0,120,212,.12);
          color: var(--primary);
        }

        /* ── chat screen ── */
        .aiw-msgs {
          flex:1; overflow-y:auto; padding:18px;
          background:#f9f9f9;
          display:flex; flex-direction:column; gap:12px;
        }
        .aiw-msgs::-webkit-scrollbar { width:5px; }
        .aiw-msgs::-webkit-scrollbar-thumb { background:#ddd; border-radius:3px; }

        /* messages */
        .aiw-msg { display:flex; gap:8px; animation:aiw-fadeUp .25s ease both; }
        .aiw-msg.bot  { align-items:flex-start; }
        .aiw-msg.user { align-items:flex-end; flex-direction:row-reverse; }
        .aiw-av {
          width:30px; height:30px; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-size:13px; flex-shrink:0;
        }
        .aiw-msg.bot  .aiw-av { background:linear-gradient(135deg,#4fc3f7,var(--aiw-p)); color:white; }
        .aiw-msg.user .aiw-av { background:var(--aiw-p); color:white; }
        .aiw-mbody { max-width:72%; }
        .aiw-bubble {
          padding:10px 14px; border-radius:14px;
          font-size:13.5px; line-height:1.5; word-wrap:break-word;
        }
        .aiw-msg.bot  .aiw-bubble { background:white; color:var(--aiw-text); border:1px solid var(--aiw-border); border-bottom-left-radius:4px; }
        .aiw-msg.user .aiw-bubble { background:var(--aiw-p); color:white; border-bottom-right-radius:4px; }
        .aiw-mtime { font-size:10.5px; color:var(--aiw-light); margin-top:4px; padding:0 2px; }

        /* typing */
        .aiw-typing-row { display:flex; gap:4px; align-items:center; padding:12px 14px; }
        .aiw-dot {
          width:6px; height:6px; border-radius:50%;
          background:#aaa; animation:aiw-blink 1.4s infinite ease-in-out;
        }
        .aiw-dot:nth-child(1){ animation-delay:-.32s; }
        .aiw-dot:nth-child(2){ animation-delay:-.16s; }

        /* option buttons */
        .aiw-opts { display:flex; flex-wrap:wrap; gap:10px; margin-top:8px; }
        .aiw-opt {
          padding:11px 24px; background:var(--aiw-p);
          border:none; border-radius:999px;
          font-size:14px; font-weight:500; cursor:pointer;
          transition:all .2s; font-family:inherit; color:white;
          box-shadow:0 2px 6px rgba(0,120,212,.3);
        }
        .aiw-opt:hover {
          background:var(--aiw-pd); transform:translateY(-2px);
          box-shadow:0 4px 12px rgba(0,120,212,.4);
        }

        /* no-slots notice */
        .aiw-no-slots {
          background:#fff8e1; border:1px solid #ffd54f;
          border-radius:8px; padding:10px 14px;
          font-size:13px; color:#7a5c00;
        }

        /* chat bar */
        .aiw-bar {
          padding:13px 15px; border-top:1px solid var(--aiw-border);
          background:white; display:flex; gap:10px;
          align-items:center; flex-shrink:0;
        }
        .aiw-inp {
          flex:1; padding:10px 15px;
          border:1.5px solid var(--aiw-border); border-radius:999px;
          font-size:13.5px; outline:none; transition:border-color .2s;
          background:#fafafa; font-family:inherit; color:var(--aiw-text);
        }
        .aiw-inp:focus { border-color:var(--aiw-p); background:white; }
        .aiw-inp:disabled { opacity:.5; cursor:not-allowed; }
        .aiw-send {
          width:38px; height:38px; border-radius:50%;
          background:var(--aiw-p); color:white; border:none;
          cursor:pointer; display:flex; align-items:center;
          justify-content:center; font-size:14px; flex-shrink:0;
          transition:all .2s;
        }
        .aiw-send:hover { background:var(--aiw-pd); transform:scale(1.05); }
        .aiw-send:disabled { background:#ccc; cursor:not-allowed; transform:none; }

        /* inline field cards */
        .aiw-field-card {
          display:flex; flex-direction:column; gap:10px;
          margin:8px 0; padding:16px; background:white;
          border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08);
          animation:aiw-fadeUp .3s ease both; transition:box-shadow .3s;
        }
        .aiw-field-label { font-size:13px; font-weight:500; color:#666; }
        .aiw-field-row { display:flex; gap:8px; position:relative; }
        .aiw-field-inp {
          flex:1; padding:12px 14px;
          border:1.5px solid var(--aiw-border); border-radius:8px;
          font-size:14px; outline:none; font-family:inherit;
          background:white; color:var(--aiw-text); transition:all .2s;
        }
        .aiw-field-inp:focus { border-color:var(--aiw-p); box-shadow:0 0 0 3px rgba(0,120,212,.1); }
        .aiw-field-inp.success { border-color:var(--aiw-success)!important; background:var(--aiw-success-bg)!important; }
        .aiw-field-err { font-size:12px; color:#e74c3c; margin-top:4px; display:none; }

        /* submit button inside field card */
        .aiw-sbtn {
          width:40px; height:40px; background:var(--aiw-p);
          color:white; border:none; border-radius:8px;
          cursor:pointer; display:flex; align-items:center;
          justify-content:center; transition:all .2s;
          flex-shrink:0; position:relative; overflow:hidden;
        }
        .aiw-sbtn:hover:not(:disabled) { background:var(--aiw-pd); }
        .aiw-sbtn:disabled { cursor:not-allowed; }
        .aiw-sbtn .s-spinner {
          width:18px; height:18px;
          border:2px solid rgba(255,255,255,.35); border-top-color:white;
          border-radius:50%; animation:aiw-spin .65s linear infinite;
          display:none; position:absolute;
        }
        .aiw-sbtn .s-icon  { transition:opacity .15s,transform .15s; }
        .aiw-sbtn .s-tick  {
          display:none; position:absolute; font-size:17px;
          transform:scale(0);
          transition:transform .25s cubic-bezier(.34,1.56,.64,1);
        }
        .aiw-sbtn.loading .s-icon  { opacity:0; transform:scale(.5); }
        .aiw-sbtn.loading .s-spinner { display:block; }
        .aiw-sbtn.success { background:var(--aiw-success)!important; }
        .aiw-sbtn.success .s-icon  { opacity:0; transform:scale(.5); }
        .aiw-sbtn.success .s-spinner { display:none; }
        .aiw-sbtn.success .s-tick  { display:flex; transform:scale(1); }

        /* continue button inside practitioner step */
        .aiw-continue-btn {
          padding:12px 20px; background:var(--aiw-p); color:white;
          border:none; border-radius:8px; font-size:14px; font-weight:500;
          cursor:pointer; font-family:inherit;
          display:flex; align-items:center; justify-content:center; gap:8px;
          transition:all .2s;
        }
        .aiw-continue-btn:hover { background:var(--aiw-pd); transform:translateY(-1px); }

        /* practitioner autocomplete */
        .aiw-pract-wrap { position:relative; }
        .aiw-pract-wrap input { padding-right:36px; }
        .aiw-pspinner {
          position:absolute; right:11px; top:50%; transform:translateY(-50%);
          width:16px; height:16px; display:none;
          border:2px solid #ddd; border-top-color:var(--aiw-p);
          border-radius:50%; animation:aiw-spin .7s linear infinite;
        }
        .aiw-pspinner.show { display:block; }
        .aiw-pclear {
          position:absolute; right:11px; top:50%; transform:translateY(-50%);
          width:20px; height:20px; border-radius:50%;
          background:#ddd; border:none; cursor:pointer;
          display:none; align-items:center; justify-content:center;
          color:#666; font-size:11px; transition:background .2s;
        }
        .aiw-pclear:hover { background:#bbb; }
        .aiw-pclear.show { display:flex; }
        .aiw-pdropdown {
          position:absolute; top:calc(100% + 4px); left:0; right:0;
          background:white; border:1.5px solid var(--aiw-border);
          border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.1);
          z-index:999; max-height:180px; overflow-y:auto; display:none;
        }
        .aiw-pdropdown.open { display:block; animation:aiw-fadeUp .15s ease both; }
        .aiw-pitem {
          padding:10px 14px; font-size:13.5px; color:var(--aiw-text);
          cursor:pointer; transition:background .15s;
          display:flex; align-items:center; gap:8px;
        }
        .aiw-pitem:hover, .aiw-pitem.active { background:var(--aiw-pl); color:var(--aiw-p); }
        .aiw-pempty { padding:12px 14px; font-size:13px; color:var(--aiw-light); text-align:center; font-style:italic; }
        .aiw-pbadge {
          display:none; align-items:center; gap:6px;
          padding:7px 10px; background:var(--aiw-pl);
          border:1.5px solid var(--aiw-p); border-radius:8px;
          font-size:13px; color:var(--aiw-p); font-weight:500; margin-top:6px;
        }
        .aiw-pbadge.show { display:flex; }
        .aiw-pbadge-x {
          margin-left:auto; background:none; border:none;
          cursor:pointer; color:var(--aiw-p); font-size:13px; padding:0 2px;
        }

        /* slot card */
        .aiw-slot-card {
          background:white; border:1.5px solid var(--aiw-border);
          border-radius:14px; margin-top:8px;
          box-shadow:0 2px 12px rgba(0,0,0,.07); width:100%;
        }
        .aiw-slot-head {
          padding:12px 16px; border-bottom:1px solid var(--aiw-border);
        }
        .aiw-slot-title { font-size:13px; font-weight:600; color:var(--aiw-text); }
        .aiw-slot-sub   { font-size:11px; color:#888; margin-top:2px; }
        .aiw-slot-list  { padding:10px 16px; display:flex; flex-direction:column; gap:8px; }
        .aiw-slot-btn {
          width:100%; padding:11px 16px;
          border:1.5px solid var(--aiw-border); border-radius:8px;
          background:white; font-size:14px; color:var(--aiw-text);
          font-family:inherit; cursor:pointer; text-align:center;
          transition:all .15s;
        }
        .aiw-slot-btn:hover { border-color:var(--aiw-p); color:var(--aiw-p); background:var(--aiw-pl); }
        .aiw-slot-more {
          width:100%; padding:11px 16px; border:none;
          border-top:1px solid var(--aiw-border); background:#f9f9f9;
          color:var(--aiw-p); font-size:13px; font-weight:500;
          cursor:pointer; font-family:inherit;
          display:flex; align-items:center; justify-content:center; gap:6px;
          border-radius:0 0 12px 12px;
        }
        .aiw-slot-more:hover { background:var(--aiw-pl); }

        /* slots overlay */
        .aiw-ov {
          position:absolute; inset:0; background:white;
          z-index:200; display:flex; flex-direction:column;
          animation:aiw-fadeUp .2s ease both;
        }
        .aiw-ov-head {
          display:flex; align-items:center; gap:10px;
          padding:13px 14px; border-bottom:1px solid var(--aiw-border); flex-shrink:0;
        }
        .aiw-ov-back {
          width:30px; height:30px; border-radius:50%; border:none;
          background:transparent; color:#888; cursor:pointer;
          display:flex; align-items:center; justify-content:center; font-size:13px;
        }
        .aiw-ov-back:hover { background:#f2f2f2; }
        .aiw-ov-body { flex:1; overflow-y:auto; padding:16px; }
        .aiw-ov-body::-webkit-scrollbar { width:4px; }
        .aiw-ov-body::-webkit-scrollbar-thumb { background:#ddd; border-radius:2px; }

        /* keyframes */
        @keyframes aiw-fadeUp {
          from { opacity:0; transform:translateY(8px); }
          to   { opacity:1; transform:translateY(0); }
        }
        @keyframes aiw-blink {
          0%,80%,100% { transform:scale(.8); opacity:.5; }
          40%          { transform:scale(1);   opacity:1;  }
        }
        @keyframes aiw-spin {
          to { transform:translateY(-50%) rotate(360deg); }
        }
        @keyframes aiw-tick {
          0%  { transform:scale(0) rotate(-10deg); }
          60% { transform:scale(1.2) rotate(3deg); }
          100%{ transform:scale(1)   rotate(0deg); }
        }

        /* overlay backdrop */
        .aiw-backdrop {
          position:fixed; inset:0;
          background:rgba(0,0,0,.25); backdrop-filter:blur(2px);
          z-index:${this.config.zIndex - 1}; display:none;
        }
        .aiw-backdrop.active { display:block; }

        /* responsive */
        @media(max-width:480px){
          .aiw-panel {
            width:calc(100vw - 32px); height:calc(100vh - 120px);
            ${this.config.position.includes("right") ? "right:0;" : "left:0;"}
          }
        }
      `;
      document.head.appendChild(style);
    }

    // ── DOM BUILD ─────────────────────────────────────────────────────────────
    buildDOM() {
      // backdrop
      this.backdrop = document.createElement("div");
      this.backdrop.className = "aiw-backdrop";
      document.body.appendChild(this.backdrop);

      // root container
      this.root = document.createElement("div");
      this.root.className = "aiw-root";
      this.root.innerHTML = `
        <!-- launcher -->
        <button class="aiw-launcher" id="aiwLauncher" aria-label="Open chat">
          <i class="fas fa-comment-dots"></i>
        </button>

        <!-- panel -->
        <div class="aiw-panel" id="aiwPanel">

          <!-- header -->
          <div class="aiw-header">
            <button class="aiw-hbtn" id="aiwBack" style="display:none">
              <i class="fas fa-chevron-left"></i>
            </button>
            <div class="aiw-hlogo"><i class="fas fa-hand-holding-medical"></i></div>
            <div class="aiw-htitle">
              <strong>${this.config.headerTitle}</strong>
              <span>${this.config.headerSubtitle}</span>
            </div>
            <button class="aiw-hbtn" id="aiwClose"><i class="fas fa-times"></i></button>
          </div>

          <!-- welcome screen -->
          <div class="aiw-screen active" id="aiwWelcome">
            <div class="aiw-welcome-body">
              <div class="aiw-how">How can we help?</div>
              <div class="aiw-greet-row">
                <div class="aiw-g-av"><i class="fas fa-robot"></i></div>
                <div>
                  <div class="aiw-g-bubble">Hello 👋 How can we help you today?</div>
                  <div class="aiw-g-meta">AI Agent &bull; Just now</div>
                </div>
              </div>
            </div>
            <div class="aiw-welcome-actions">
              <button class="aiw-pill" id="aiwBtnChat">Chat With Us</button>
              <button class="aiw-pill" id="aiwBtnSchedule">Schedule an Appointment</button>
            </div>
          </div>

          <!-- chat screen -->
          <div class="aiw-screen" id="aiwChat">
            <div class="aiw-msgs" id="aiwMsgs"></div>
            <div class="aiw-bar" id="aiwBar">
              <input class="aiw-inp" id="aiwInp" placeholder="Type your message…" autocomplete="off" />
              <button class="aiw-send" id="aiwSend"><i class="fas fa-paper-plane"></i></button>
            </div>
          </div>

        </div>
      `;
      document.body.appendChild(this.root);

      // cache elements
      this.el = {
        launcher: this.root.querySelector("#aiwLauncher"),
        panel: this.root.querySelector("#aiwPanel"),
        back: this.root.querySelector("#aiwBack"),
        close: this.root.querySelector("#aiwClose"),
        welcome: this.root.querySelector("#aiwWelcome"),
        chat: this.root.querySelector("#aiwChat"),
        msgs: this.root.querySelector("#aiwMsgs"),
        bar: this.root.querySelector("#aiwBar"),
        inp: this.root.querySelector("#aiwInp"),
        send: this.root.querySelector("#aiwSend"),
        btnChat: this.root.querySelector("#aiwBtnChat"),
        btnSched: this.root.querySelector("#aiwBtnSchedule"),
      };
    }

    // ── EVENT LISTENERS ───────────────────────────────────────────────────────
    attachListeners() {
      this.el.launcher.addEventListener("click", () => this._toggle());
      this.backdrop.addEventListener("click", () => this._close());
      this.el.close.addEventListener("click", () => this._close());
      this.el.back.addEventListener("click", () => {
        this._reset();
        this._go("welcome");
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) this._close();
      });

      this.el.send.addEventListener("click", () => this._sendInput());
      this.el.inp.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !this.busy) this._sendInput();
      });

      // welcome buttons
      this.el.btnChat.addEventListener("click", () => {
        this.chatMode = "general";
        this._go("chat");
        this.el.bar.style.display = "flex";
        this._addMsg("bot", "Hello 👋 How can we help you today?");
        this._addMsg("user", "Chat With Us");
        this._setBusy(true);
        this._showTyping();
        setTimeout(() => {
          this._removeTyping();
          this._setBusy(false);
          this._addMsg("bot", WELCOME_MSG);
        }, 1000);
      });

      this.el.btnSched.addEventListener("click", () => {
        this.chatMode = "booking";
        this._go("chat");
        this._addMsg("bot", "Hello 👋 How can we help you today?");
        this._addMsg("user", "Schedule an Appointment");
        this._setBusy(true);
        this._showTyping();
        this.el.bar.style.display = "none";
        setTimeout(() => {
          this._removeTyping();
          this._setBusy(false);
          this._addMsg(
            "bot",
            "Excellent! We're excited to help you book your appointment. 😊",
          );
          setTimeout(() => {
            this._addMsg("bot", "Great! Let's start with your first name.");
            this._renderInlineForm();
          }, 800);
        }, 1000);
      });
    }

    // ── OPEN / CLOSE / TOGGLE ─────────────────────────────────────────────────
    _toggle() {
      this.isOpen ? this._close() : this._open();
    }

    _open() {
      this.isOpen = true;
      this.el.panel.classList.add("active");
      this.backdrop.classList.add("active");
      this.el.launcher.classList.add("open");
      this.el.launcher.innerHTML = '<i class="fas fa-times"></i>';
      this._go("welcome");
      this.triggerEvent("chatOpened");
    }

    _close() {
      this.isOpen = false;
      this.el.panel.classList.remove("active");
      this.backdrop.classList.remove("active");
      this.el.launcher.classList.remove("open");
      this.el.launcher.innerHTML = '<i class="fas fa-comment-dots"></i>';
      this._reset();
      this.triggerEvent("chatClosed");
    }

    // ── SCREEN ROUTING ────────────────────────────────────────────────────────
    _go(name) {
      this.curScreen = name;
      this.el.welcome.classList.toggle("active", name === "welcome");
      this.el.chat.classList.toggle("active", name === "chat");
      this.el.back.style.display = name === "welcome" ? "none" : "flex";
      if (name === "chat") this.el.inp.focus();
    }

    // ── RESET ─────────────────────────────────────────────────────────────────
    _reset() {
      this.SID = generateUUID(); // fresh session = fresh backend context
      this.chatMode = "general";
      this.bs = {
        patientId: null,
        practitionerId: null,
        locationId: null,
        appointmentTypeId: null,
        selectedSlot: null,
      };
      this.curOpts = null;
      this.busy = false;
      this.el.msgs.innerHTML = "";
      this.el.inp.disabled = false;
      this.el.send.disabled = false;
      this.el.bar.style.display = "flex";
      this._removeTyping();
    }

    // ── SEND INPUT (free text) ────────────────────────────────────────────────
    _sendInput() {
      const m = this.el.inp.value.trim();
      if (!m || this.busy) return;
      this.el.inp.value = "";

      // general→booking intent upgrade
      if (this.chatMode === "general" && detectsBookingIntent(m)) {
        this.chatMode = "booking";
        this._addMsg("user", m);
        this._addMsg(
          "bot",
          "Of course! Let me get your appointment set up. 😊",
        );
        setTimeout(() => {
          this.el.bar.style.display = "none";
          setTimeout(() => {
            this._addMsg("bot", "Let's start with your first name.");
            this._renderInlineForm();
          }, 600);
        }, 500);
        return;
      }

      this._addMsg("user", m);
      this._toBackend(m);
    }

    // ── API CALLS ─────────────────────────────────────────────────────────────
    async _toBackend(message) {
      this._setBusy(true);
      this._showTyping();
      try {
        const r = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.SID,
            message,
            bookingState: this.bs,
            mode: this.chatMode,
            extra: null,
          }),
        });
        this._removeTyping();
        if (!r.ok) throw new Error("HTTP " + r.status);
        this._handleReply((await r.json()).reply);
        this.triggerEvent("messageSent", { message });
      } catch (err) {
        this._removeTyping();
        this._addMsg(
          "bot",
          "Sorry, I'm having trouble connecting. Please try again.",
        );
        this.triggerEvent("error", { error: err });
      } finally {
        this._setBusy(false);
      }
    }

    async _sendSel(value, extra = null) {
      this._setBusy(true);
      this._showTyping();
      try {
        const r = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.SID,
            message: value,
            bookingState: this.bs,
            mode: this.chatMode,
            extra,
          }),
        });
        this._removeTyping();
        if (!r.ok) throw new Error("HTTP " + r.status);
        this._handleReply((await r.json()).reply);
      } catch (err) {
        this._removeTyping();
        this._addMsg("bot", "Error processing your selection.");
      } finally {
        this._setBusy(false);
      }
    }

    // ── REPLY HANDLER ─────────────────────────────────────────────────────────
    _handleReply(reply) {
      // state clearing signals
      if (reply.type === "restart_booking" || reply.clearState) {
        this.bs = {
          patientId: null,
          practitionerId: null,
          locationId: null,
          appointmentTypeId: null,
          selectedSlot: null,
        };
        this._rmOpts();
      }
      if (reply.type === "clear_patient") this.bs.patientId = null;
      if (reply.type === "clear_practitioner" || reply.clearPractitioner) {
        Object.assign(this.bs, {
          practitionerId: null,
          locationId: null,
          appointmentTypeId: null,
          selectedSlot: null,
        });
        this._rmOpts();
      }
      if (reply.clearLocation) {
        Object.assign(this.bs, {
          locationId: null,
          appointmentTypeId: null,
          selectedSlot: null,
        });
        this._rmOpts();
      }
      if (reply.clearAppointmentType) {
        Object.assign(this.bs, { appointmentTypeId: null, selectedSlot: null });
        this._rmOpts();
      }
      if (reply.clearSlot) {
        this.bs.selectedSlot = null;
        this._rmOpts();
      }

      // store IDs from response
      if (reply.patientId && !this.bs.patientId)
        this.bs.patientId = reply.patientId;
      if (reply.practitionerId && !this.bs.practitionerId)
        this.bs.practitionerId = reply.practitionerId;

      const isNoSlots = reply.type === "available_slots" && !reply.data?.length;
      if (reply.aiMessage && !isNoSlots) this._addMsg("bot", reply.aiMessage);

      switch (reply.type) {
        case "practitioner_verified":
          if (reply.practitionerId)
            this.bs.practitionerId = reply.practitionerId;
          break;
        case "practitioners_list":
          if (reply.data?.length) this._renderPracts(reply.data);
          break;
        case "patient_verified":
          if (reply.patientId) this.bs.patientId = reply.patientId;
          break;
        case "locations_list":
          if (reply.data?.length) this._renderOpts("location", reply.data);
          break;
        case "appointment_types_list":
          if (reply.data?.length)
            this._renderOpts("appointmentType", reply.data);
          break;
        case "available_slots":
          if (reply.data?.length) this._renderSlots(reply.data);
          else if (reply.unavailableDates?.length)
            this._renderNoSlots(reply.unavailableDates);
          break;
        case "appointment_confirmed":
          this.bs = {
            patientId: null,
            practitionerId: null,
            locationId: null,
            appointmentTypeId: null,
            selectedSlot: null,
          };
          break;
        case "error":
          if (!reply.aiMessage)
            this._addMsg(
              "bot",
              "❌ " + (reply.message || "Something went wrong."),
            );
          break;
        default:
          if (!reply.aiMessage && reply.message)
            this._addMsg("bot", reply.message);
      }
    }

    // ── UI HELPERS ────────────────────────────────────────────────────────────
    _setBusy(v) {
      this.busy = v;
      this.el.inp.disabled = v;
      this.el.send.disabled = v;
    }

    _addMsg(who, text) {
      const d = document.createElement("div");
      d.className = "aiw-msg " + who;
      const t = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      d.innerHTML = `
        <div class="aiw-av"><i class="${who === "bot" ? "fas fa-robot" : "fas fa-user"}"></i></div>
        <div class="aiw-mbody">
          <div class="aiw-bubble">${this._esc(text)}</div>
          <div class="aiw-mtime">${t}</div>
        </div>`;
      this.el.msgs.appendChild(d);
      this._scrollBottom();
      if (who === "bot") this._playSound();
    }

    _showTyping() {
      const d = document.createElement("div");
      d.className = "aiw-msg bot";
      d.id = "aiwTyping";
      d.innerHTML = `<div class="aiw-av"><i class="fas fa-robot"></i></div>
        <div class="aiw-mbody"><div class="aiw-bubble">
          <div class="aiw-typing-row">
            <div class="aiw-dot"></div><div class="aiw-dot"></div><div class="aiw-dot"></div>
          </div>
        </div></div>`;
      this.el.msgs.appendChild(d);
      this._scrollBottom();
    }
    _removeTyping() {
      document.getElementById("aiwTyping")?.remove();
    }
    _rmOpts() {
      this.el.msgs.querySelector(".aiw-opts")?.remove();
      this.curOpts = null;
    }

    _renderPracts(list) {
      const wrap = document.createElement("div");
      wrap.className = "aiw-opts";
      list.forEach((p, i) => {
        const b = document.createElement("button");
        b.className = "aiw-opt";
        b.textContent = `${i + 1}. ${p.name}`;
        b.onclick = () => {
          this._addMsg("user", p.name);
          this.bs.practitionerId = p.id;
          this._sendSel(`practitioner_${p.id}`);
          wrap.remove();
        };
        wrap.appendChild(b);
      });
      this.el.msgs.appendChild(wrap);
      this._scrollBottom();
    }

    _renderOpts(type, opts) {
      this.curOpts = { type, options: opts };
      const wrap = document.createElement("div");
      wrap.className = "aiw-opts";
      opts.forEach((o) => {
        const b = document.createElement("button");
        b.className = "aiw-opt";
        b.textContent = o.name || o.type;
        b.onclick = () => {
          this._addMsg("user", o.name || o.type);
          if (type === "location") this.bs.locationId = o.id;
          if (type === "appointmentType") this.bs.appointmentTypeId = o.id;
          this._sendSel(o.id.toString(), null);
          wrap.remove();
          this.curOpts = null;
        };
        wrap.appendChild(b);
      });
      this.el.msgs.appendChild(wrap);
      this._scrollBottom();
    }

    _renderSlots(slots) {
      // Group by date
      const groups = {},
        dateKeys = [];
      slots.forEach((s) => {
        const dd = new Date(s.start.replace(" ", "T"));
        const key = dd.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        if (!groups[key]) {
          groups[key] = { dd, slots: [] };
          dateKeys.push(key);
        }
        groups[key].slots.push(s);
      });
      const preview = groups[dateKeys[0]]?.slots.slice(0, 3) ?? [];
      const firstDd = groups[dateKeys[0]].dd;

      const card = document.createElement("div");
      card.className = "aiw-slot-card";

      // head
      const head = document.createElement("div");
      head.className = "aiw-slot-head";
      head.innerHTML = `
        <div class="aiw-slot-title">${firstDd.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
        <div class="aiw-slot-sub">Select a time below</div>`;
      card.appendChild(head);

      // slot list
      const list = document.createElement("div");
      list.className = "aiw-slot-list";
      preview.forEach((s) => {
        const dd = new Date(s.start.replace(" ", "T"));
        const lbl = dd.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const full = `${firstDd.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${lbl}`;
        const btn = document.createElement("button");
        btn.className = "aiw-slot-btn";
        btn.textContent = lbl;
        btn.onclick = () => {
          this._addMsg("user", full);
          this.bs.selectedSlot = {
            id: s.id,
            practitionerId: s.practitionerId,
            start: s.start,
            end: s.end,
          };
          this._sendSel(`slot_${s.id}`, {
            practitionerId: s.practitionerId,
            start: s.start,
            end: s.end,
          });
          card.remove();
        };
        list.appendChild(btn);
      });
      card.appendChild(list);

      // "see all" button
      if (slots.length > preview.length) {
        const more = document.createElement("button");
        more.className = "aiw-slot-more";
        more.innerHTML = `<i class="fas fa-calendar-alt"></i> See all available slots`;
        more.onclick = () =>
          this._openSlotsOverlay(slots, groups, dateKeys, card);
        card.appendChild(more);
      }

      this.el.msgs.appendChild(card);
      this._scrollBottom();
    }

    _openSlotsOverlay(slots, groups, dateKeys, sourceCard) {
      const ov = document.createElement("div");
      ov.className = "aiw-ov";

      const head = document.createElement("div");
      head.className = "aiw-ov-head";
      head.innerHTML = `
        <button class="aiw-ov-back"><i class="fas fa-chevron-left"></i></button>
        <strong style="font-size:14px;color:var(--aiw-text)">Available Slots</strong>`;
      ov.appendChild(head);
      head.querySelector(".aiw-ov-back").onclick = () => ov.remove();

      const body = document.createElement("div");
      body.className = "aiw-ov-body";

      dateKeys.forEach((key, gi) => {
        const { dd, slots: daySlots } = groups[key];
        if (gi > 0) {
          const hr = document.createElement("hr");
          hr.style.cssText =
            "border:none;border-top:1px solid #e8e8e8;margin:4px 0 20px";
          body.appendChild(hr);
        }
        const row = document.createElement("div");
        row.style.cssText =
          "display:flex;gap:16px;align-items:flex-start;margin-bottom:20px";

        const dateCol = document.createElement("div");
        dateCol.style.cssText = "min-width:54px;padding-top:2px;flex-shrink:0";
        dateCol.innerHTML = `
          <div style="font-size:15px;font-weight:700;color:var(--aiw-text);line-height:1.2">
            ${dd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </div>
          <div style="font-size:12px;color:#888">${dd.toLocaleDateString("en-US", { weekday: "short" })}</div>`;

        const timesCol = document.createElement("div");
        timesCol.style.cssText =
          "flex:1;display:flex;flex-direction:column;gap:8px";

        daySlots.forEach((s) => {
          const slotDd = new Date(s.start.replace(" ", "T"));
          const lbl = slotDd.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          const full = `${dd.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} at ${lbl}`;
          const btn = document.createElement("button");
          btn.className = "aiw-slot-btn";
          btn.textContent = lbl;
          btn.onclick = () => {
            this._addMsg("user", full);
            this.bs.selectedSlot = {
              id: s.id,
              practitionerId: s.practitionerId,
              start: s.start,
              end: s.end,
            };
            this._sendSel(`slot_${s.id}`, {
              practitionerId: s.practitionerId,
              start: s.start,
              end: s.end,
            });
            ov.remove();
            sourceCard.remove();
          };
          timesCol.appendChild(btn);
        });
        row.appendChild(dateCol);
        row.appendChild(timesCol);
        body.appendChild(row);
      });

      ov.appendChild(body);
      this.el.panel.appendChild(ov);
    }

    _renderNoSlots(dates) {
      const notice = document.createElement("div");
      notice.className = "aiw-no-slots";
      const range = dates.length
        ? `${dates[0]} to ${dates[dates.length - 1]}`
        : "the selected period";
      notice.innerHTML = `<i class="fas fa-info-circle" style="margin-right:7px"></i><strong>No slots available</strong> for ${range}.`;
      this.el.msgs.appendChild(notice);
      this._scrollBottom();
      setTimeout(() => {
        this._addMsg(
          "bot",
          "Please choose a different location and I'll find available slots for you:",
        );
        this._renderOpts("location", [
          { id: 1, name: "Utrecht" },
          { id: 2, name: "Arnhem" },
          { id: 3, name: "Amsterdam" },
          { id: 4, name: "The Hague" },
          { id: 5, name: "Rotterdam" },
          { id: 6, name: "Haarlem" },
          { id: 7, name: "Kleiweg" },
          { id: 8, name: "Amersfoort" },
        ]);
      }, 600);
    }

    // ── INLINE CONVERSATIONAL FORM ────────────────────────────────────────────
    _renderInlineForm() {
      setTimeout(() => this._renderFirstNameField(), 800);
    }

    _makeCard(id) {
      const card = document.createElement("div");
      card.id = id;
      card.className = "aiw-field-card";
      return card;
    }

    _makeSBtn() {
      return `<button type="button" class="aiw-sbtn">
        <span class="s-icon"><i class="fas fa-arrow-right"></i></span>
        <div class="s-spinner"></div>
        <span class="s-tick"><i class="fas fa-check"></i></span>
      </button>`;
    }

    async _animateFieldSuccess(card, input, btn) {
      btn.disabled = true;
      btn.classList.add("loading");
      await this._delay(220);
      btn.classList.remove("loading");
      btn.classList.add("success");
      input.classList.add("success");
      card.style.boxShadow = "0 2px 16px rgba(34,197,94,.18)";
      await this._delay(420);
    }

    _delay(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    // STEP 1 — First Name
    _renderFirstNameField() {
      const card = this._makeCard("aiwFirstName");
      card.innerHTML = `
        <label class="aiw-field-label">First Name</label>
        <div class="aiw-field-row">
          <input id="aiwFnInp" class="aiw-field-inp" type="text" placeholder="John" />
          ${this._makeSBtn()}
        </div>
        <div class="aiw-field-err" id="aiwFnErr"></div>`;
      this.el.msgs.appendChild(card);
      this._scrollBottom();

      const inp = card.querySelector("#aiwFnInp");
      const btn = card.querySelector(".aiw-sbtn");
      const err = card.querySelector("#aiwFnErr");
      setTimeout(() => inp.focus(), 100);

      const submit = async () => {
        const val = inp.value.trim();
        if (!val || val.length < 2) {
          err.textContent = "Please enter your first name";
          err.style.display = "block";
          inp.style.borderColor = "#e74c3c";
          inp.focus();
          return;
        }
        err.style.display = "none";
        inp.disabled = true;
        await this._animateFieldSuccess(card, inp, btn);
        this._addMsg("user", val);
        card.remove();
        setTimeout(() => {
          this._addMsg("bot", "Great! What's your last name?");
          this._renderLastNameField(val);
        }, 600);
      };
      btn.addEventListener("click", submit);
      inp.addEventListener("keypress", (e) => {
        if (e.key === "Enter") submit();
      });
      inp.addEventListener("input", () => {
        err.style.display = "none";
        inp.style.borderColor = "";
      });
    }

    // STEP 2 — Last Name
    _renderLastNameField(firstName) {
      const card = this._makeCard("aiwLastName");
      card.innerHTML = `
        <label class="aiw-field-label">Last Name</label>
        <div class="aiw-field-row">
          <input id="aiwLnInp" class="aiw-field-inp" type="text" placeholder="Doe" />
          ${this._makeSBtn()}
        </div>
        <div class="aiw-field-err" id="aiwLnErr"></div>`;
      this.el.msgs.appendChild(card);
      this._scrollBottom();

      const inp = card.querySelector("#aiwLnInp");
      const btn = card.querySelector(".aiw-sbtn");
      const err = card.querySelector("#aiwLnErr");
      setTimeout(() => inp.focus(), 100);

      const submit = async () => {
        const val = inp.value.trim();
        if (!val || val.length < 2) {
          err.textContent = "Please enter your last name";
          err.style.display = "block";
          inp.style.borderColor = "#e74c3c";
          inp.focus();
          return;
        }
        err.style.display = "none";
        inp.disabled = true;
        await this._animateFieldSuccess(card, inp, btn);
        this._addMsg("user", val);
        card.remove();
        setTimeout(() => {
          this._addMsg(
            "bot",
            `Thanks ${firstName} ${val}! What's your email address?`,
          );
          this._renderEmailField(firstName, val);
        }, 600);
      };
      btn.addEventListener("click", submit);
      inp.addEventListener("keypress", (e) => {
        if (e.key === "Enter") submit();
      });
      inp.addEventListener("input", () => {
        err.style.display = "none";
        inp.style.borderColor = "";
      });
    }

    // STEP 3 — Email
    _renderEmailField(firstName, lastName) {
      const card = this._makeCard("aiwEmail");
      card.innerHTML = `
        <label class="aiw-field-label">Email</label>
        <div class="aiw-field-row">
          <input id="aiwEmInp" class="aiw-field-inp" type="email" placeholder="email@example.com" />
          ${this._makeSBtn()}
        </div>
        <div class="aiw-field-err" id="aiwEmErr"></div>`;
      this.el.msgs.appendChild(card);
      this._scrollBottom();

      const inp = card.querySelector("#aiwEmInp");
      const btn = card.querySelector(".aiw-sbtn");
      const err = card.querySelector("#aiwEmErr");
      setTimeout(() => inp.focus(), 100);

      const submit = async () => {
        const val = inp.value.trim();
        if (!/^[\w.%+-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(val)) {
          err.textContent = "Please enter a valid email address";
          err.style.display = "block";
          inp.style.borderColor = "#e74c3c";
          inp.focus();
          return;
        }
        err.style.display = "none";
        inp.disabled = true;
        await this._animateFieldSuccess(card, inp, btn);
        this._addMsg("user", val);
        card.remove();
        setTimeout(() => {
          this._addMsg(
            "bot",
            "Perfect! Do you have a preferred practitioner you'd like to see? (Optional - just hit Continue if you'd like to see all available appointments)",
          );
          this._renderPractitionerField(val, firstName, lastName);
        }, 600);
      };
      btn.addEventListener("click", submit);
      inp.addEventListener("keypress", (e) => {
        if (e.key === "Enter") submit();
      });
      inp.addEventListener("input", () => {
        err.style.display = "none";
        inp.style.borderColor = "";
      });
    }

    // STEP 4 — Practitioner (optional)
    _renderPractitionerField(email, firstName, lastName) {
      let selectedP = null;
      let debounce = null;
      let highlight = -1;

      const wrap = document.createElement("div");
      wrap.className = "aiw-field-card";
      wrap.innerHTML = `
        <label class="aiw-field-label" style="color:#aaa">
          Practitioner <span style="font-weight:400;font-size:12px">(optional)</span>
        </label>
        <div class="aiw-pract-wrap">
          <input id="aiwPrInp" class="aiw-field-inp" type="text" placeholder="Search by name…" autocomplete="off" />
          <div class="aiw-pspinner" id="aiwPrSpin"></div>
          <button class="aiw-pclear" id="aiwPrClear" type="button" style="display:none">
            <i class="fas fa-times"></i>
          </button>
          <div class="aiw-pdropdown" id="aiwPrDrop"></div>
        </div>
        <div class="aiw-pbadge" id="aiwPrBadge" style="display:none">
          <i class="fas fa-user-md"></i>
          <span id="aiwPrBadgeTxt"></span>
          <button class="aiw-pbadge-x" id="aiwPrBadgeX" type="button">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="aiw-field-err" id="aiwPrErr" style="display:none">Please select a practitioner from the list</div>
        <button class="aiw-continue-btn" id="aiwPrSubmit">
          Continue <i class="fas fa-arrow-right"></i>
        </button>`;
      this.el.msgs.appendChild(wrap);
      this._scrollBottom();

      const prInp = wrap.querySelector("#aiwPrInp");
      const prSpin = wrap.querySelector("#aiwPrSpin");
      const prClear = wrap.querySelector("#aiwPrClear");
      const prDrop = wrap.querySelector("#aiwPrDrop");
      const prBadge = wrap.querySelector("#aiwPrBadge");
      const prBadgeTxt = wrap.querySelector("#aiwPrBadgeTxt");
      const prBadgeX = wrap.querySelector("#aiwPrBadgeX");
      const prErr = wrap.querySelector("#aiwPrErr");
      const prSubmit = wrap.querySelector("#aiwPrSubmit");

      setTimeout(() => prInp.focus(), 100);

      const selectP = (p) => {
        selectedP = p;
        prInp.value = "";
        prBadgeTxt.textContent = p.name;
        prBadge.style.display = "flex";
        prClear.style.display = "none";
        prDrop.classList.remove("open");
        prErr.style.display = "none";
      };

      prInp.addEventListener("input", async () => {
        const q = prInp.value.trim();
        prClear.style.display = q.length > 0 && !selectedP ? "flex" : "none";
        selectedP = null;
        prBadge.style.display = "none";
        clearTimeout(debounce);
        if (q.length < 1) {
          prDrop.classList.remove("open");
          return;
        }
        debounce = setTimeout(async () => {
          prSpin.classList.add("show");
          prClear.style.display = "none";
          const results = await this._searchPractitioners(q);
          prSpin.classList.remove("show");
          prClear.style.display = q.length > 0 ? "flex" : "none";
          this._renderPractDropdown(results, prDrop, selectP);
        }, 300);
      });

      prClear.addEventListener("click", () => {
        selectedP = null;
        prInp.value = "";
        prBadge.style.display = "none";
        prClear.style.display = "none";
        prDrop.classList.remove("open");
        prInp.focus();
      });
      prBadgeX.addEventListener("click", () => {
        selectedP = null;
        prInp.value = "";
        prBadge.style.display = "none";
        prClear.style.display = "none";
        prInp.focus();
      });

      prInp.addEventListener("keydown", (e) => {
        const items = prDrop.querySelectorAll(".aiw-pitem");
        if (!prDrop.classList.contains("open") || !items.length) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          highlight = Math.min(highlight + 1, items.length - 1);
          items.forEach((el, i) =>
            el.classList.toggle("active", i === highlight),
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          highlight = Math.max(highlight - 1, 0);
          items.forEach((el, i) =>
            el.classList.toggle("active", i === highlight),
          );
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (highlight >= 0)
            items[highlight].dispatchEvent(new Event("mousedown"));
          else finalSubmit();
        } else if (e.key === "Escape") prDrop.classList.remove("open");
      });
      prInp.addEventListener("blur", () =>
        setTimeout(() => prDrop.classList.remove("open"), 150),
      );

      const finalSubmit = () => {
        if (prInp.value.trim() && !selectedP) {
          prErr.style.display = "block";
          prInp.style.borderColor = "#e74c3c";
          prInp.focus();
          return;
        }
        const practName = selectedP ? selectedP.name : null;
        const msg = practName
          ? `I want to book an appointment with ${practName}. My name is ${firstName} ${lastName} and my email is ${email}`
          : `I want to book an appointment. My name is ${firstName} ${lastName} and my email is ${email}`;
        wrap.remove();
        this._addMsg(
          "user",
          practName
            ? `Practitioner: ${practName}`
            : "Show all available appointments",
        );
        this.chatMode = "booking";
        this._toBackend(msg);
      };
      prSubmit.addEventListener("click", finalSubmit);
    }

    // practitioner autocomplete helpers
    _renderPractDropdown(results, dropdown, onSelect) {
      dropdown.innerHTML = "";
      if (!results.length) {
        dropdown.innerHTML =
          '<div class="aiw-pempty">No practitioners found</div>';
        dropdown.classList.add("open");
        return;
      }
      results.forEach((p) => {
        const d = document.createElement("div");
        d.className = "aiw-pitem";
        d.innerHTML = '<i class="fas fa-user-md"></i> ' + p.name;
        d.addEventListener("mousedown", (e) => {
          e.preventDefault();
          onSelect(p);
        });
        dropdown.appendChild(d);
      });
      dropdown.classList.add("open");
    }

    async _searchPractitioners(q) {
      try {
        const r = await fetch(
          `${this.config.practitionerSearchUrl}?q=${encodeURIComponent(q)}`,
        );
        if (!r.ok) throw new Error();
        return (await r.json()).practitioners ?? [];
      } catch {
        return [];
      }
    }

    // ── SOUND ─────────────────────────────────────────────────────────────────
    _playSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } catch {}
    }

    // ── UTILS ─────────────────────────────────────────────────────────────────
    _esc(t) {
      const el = document.createElement("div");
      el.textContent = t;
      return el.innerHTML.replace(/\n/g, "<br>");
    }

    _scrollBottom() {
      setTimeout(() => {
        this.el.msgs.scrollTop = this.el.msgs.scrollHeight;
      }, 80);
    }

    _posCSS() {
      const map = {
        "bottom-right": "bottom:30px;right:30px;",
        "bottom-left": "bottom:30px;left:30px;",
        "top-right": "top:30px;right:30px;",
        "top-left": "top:30px;left:30px;",
      };
      return map[this.config.position] || map["bottom-right"];
    }

    _darken(hex, pct) {
      const n = parseInt(hex.replace("#", ""), 16),
        a = -Math.round(2.55 * pct);
      const clamp = (v) => Math.max(0, Math.min(255, v));
      return (
        "#" +
        [0, 8, 16]
          .map((s) =>
            clamp(((n >> s) & 0xff) + a)
              .toString(16)
              .padStart(2, "0"),
          )
          .reverse()
          .join("")
      );
    }

    _lighten(hex) {
      // produce a very light tint (opacity-like effect)
      const n = parseInt(hex.replace("#", ""), 16);
      const mix = (c) => Math.round(c + (255 - c) * 0.88);
      return (
        "#" +
        [16, 8, 0]
          .map((s) =>
            mix((n >> s) & 0xff)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")
      );
    }

    // ── PUBLIC API ────────────────────────────────────────────────────────────
    triggerEvent(name, data = {}) {
      window.dispatchEvent(
        new CustomEvent(`aiChatWidget:${name}`, {
          detail: { widget: this, ...data },
        }),
      );
    }

    open() {
      this._open();
    }
    close() {
      this._close();
    }
    destroy() {
      this.root?.remove();
      this.backdrop?.remove();
      document.getElementById("ai-chat-widget-styles-v2")?.remove();
    }
  }

  // ── expose ──────────────────────────────────────────────────────────────────
  window.AIChatWidget = AIChatWidget;

  // auto-init
  if (window.aiChatWidgetConfig) {
    window.aiChatWidgetInstance = new AIChatWidget(window.aiChatWidgetConfig);
  }
})(window);
