/**
 * AI Chatbot Widget SDK
 * Version: 1.2.0
 *
 * Converted from standalone widget to embeddable SDK.
 * Drop into any website with a single <script> tag.
 *
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/gh/RehmanAli10/chat-bot-widget-sdk@main/chatbot-sdk.js"></script>
 *   <script>
 *     new ChatbotSDK({ apiUrl: "https://your-backend.vercel.app/api/chat" }).init();
 *   </script>
 *
 * Config options:
 *   apiUrl         {string}  REQUIRED — your backend /api/chat endpoint
 *   position       {string}  "bottom-right" | "bottom-left" | "top-right" | "top-left"  (default: "bottom-right")
 *   theme          {string}  "blue" | "green" | "purple" | "red" | "orange"             (default: "blue")
 *   autoOpen       {boolean} open the widget automatically on page load                 (default: false)
 *   welcomeMessage {string}  first bot message shown when widget opens
 *   headerTitle    {string}  widget header title                                        (default: "AI Assistant")
 *   headerSubtitle {string}  widget header subtitle                                     (default: "Online • Ready to chat")
 *   placeholder    {string}  input placeholder text                                     (default: "Type your message...")
 */

(function (global) {
  "use strict";

  // ─── Font Awesome (loaded once per page) ─────────────────────────────────
  function _loadFontAwesome() {
    if (document.getElementById("chatbot-sdk-fa")) return;
    const link = document.createElement("link");
    link.id = "chatbot-sdk-fa";
    link.rel = "stylesheet";
    link.href =
      "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
    document.head.appendChild(link);
  }

  // ─── SDK Class ────────────────────────────────────────────────────────────
  class ChatbotSDK {
    constructor(config = {}) {
      if (!config.apiUrl) {
        throw new Error(
          "[ChatbotSDK] 'apiUrl' is required. " +
            "e.g. new ChatbotSDK({ apiUrl: 'https://your-app.vercel.app/api/chat' })",
        );
      }

      this.config = {
        apiUrl: config.apiUrl,
        position: config.position || "bottom-right",
        theme: config.theme || "blue",
        autoOpen: config.autoOpen || false,
        welcomeMessage:
          config.welcomeMessage ||
          "Hello! 👋 I can help you book an appointment.\n\nTo get started, please provide your email.",
        headerTitle: config.headerTitle || "AI Assistant",
        headerSubtitle: config.headerSubtitle || "Online • Ready to chat",
        placeholder: config.placeholder || "Type your message...",
      };

      // Unique per-instance prefix — prevents ID collisions when multiple widgets exist on a page
      this.instanceId = "cs-" + this._generateUUID().slice(0, 8);
      this.sessionId = this._generateUUID();
      this.isOpen = false;
      this.hasShownWelcome = false;
      this.isTyping = false;
      this.waitingForResponse = false;
      this.currentOptions = null;

      this.bookingState = {
        patientId: null,
        locationId: null,
        appointmentTypeId: null,
        selectedSlot: null,
      };

      this.elements = {};
      this.eventHandlers = {};
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    /** Initialize and inject the widget into the page */
    init() {
      _loadFontAwesome();
      this._injectStyles();
      this._injectHTML();
      this._attachEventListeners();
      if (this.config.autoOpen) setTimeout(() => this.open(), 500);
      this._emit("ready");
      return this;
    }

    /** Open the chat widget */
    open() {
      this.isOpen = true;
      this.elements.widget.classList.add("active");
      this.elements.overlay.classList.add("active");
      this.elements.button.classList.add("active");
      this.elements.button.innerHTML = '<i class="fas fa-times"></i>';
      this.elements.input.focus();

      if (!this.hasShownWelcome) {
        this.hasShownWelcome = true;
        this.elements.welcome.style.display = "none";
        setTimeout(
          () => this._addMessage("bot", this.config.welcomeMessage),
          300,
        );
      } else if (this.elements.messages.children.length > 1) {
        this.elements.welcome.style.display = "none";
      }

      this._emit("open");
    }

    /** Close the chat widget */
    close() {
      this.isOpen = false;
      this.elements.widget.classList.remove("active");
      this.elements.overlay.classList.remove("active");
      this.elements.button.classList.remove("active");
      this.elements.button.innerHTML = '<i class="fas fa-comments"></i>';
      this._emit("close");
    }

    /** Toggle open/close */
    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    /** Remove the widget from the page entirely */
    destroy() {
      if (this.elements.container) this.elements.container.remove();
      if (this.elements.overlay) this.elements.overlay.remove();
      if (!document.querySelector("[data-chatbot-sdk]")) {
        const s = document.getElementById("chatbot-sdk-styles");
        if (s) s.remove();
      }
      this._emit("destroyed");
    }

    /**
     * Register an event listener
     * Events: ready | open | close | messageSent | messageReceived | error | destroyed
     */
    on(event, callback) {
      if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
      this.eventHandlers[event].push(callback);
      return this;
    }

    // ─── Messaging ───────────────────────────────────────────────────────────

    async sendMessage(text = null) {
      const message = text || this.elements.input.value.trim();
      if (!message || this.isTyping || this.waitingForResponse) return;

      // User typed a number — treat as option selection
      if (this.currentOptions && /^\d+$/.test(message)) {
        const idx = parseInt(message, 10) - 1;
        if (idx >= 0 && idx < this.currentOptions.options.length) {
          const opt = this.currentOptions.options[idx];
          const displayName = opt.name || opt.type;

          if (this.currentOptions.type === "location") {
            this.bookingState.locationId = opt.id;
          } else if (this.currentOptions.type === "appointmentType") {
            this.bookingState.appointmentTypeId = opt.id;
          }

          this.elements.input.value = "";
          this._removeOptionsContainer();
          this.currentOptions = null;

          this._addMessage("user", displayName);
          await this._dispatchToAPI(opt.id.toString(), null);
          return;
        }
      }

      if (
        this.elements.welcome &&
        this.elements.welcome.style.display !== "none"
      ) {
        this.elements.welcome.style.display = "none";
      }

      this._addMessage("user", message);
      this.elements.input.value = "";
      await this._dispatchToAPI(message, null);
    }

    // ─── Private: API calls ──────────────────────────────────────────────────

    async _dispatchToAPI(message, extra) {
      this._showTyping();
      this._setInputLocked(true);
      this._emit("messageSent", { message });

      try {
        const res = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.sessionId,
            message,
            patientId: this.bookingState.patientId,
            bookingState: this.bookingState,
            extra: extra || null,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const data = await res.json();
        this._removeTyping();
        this._handleResponse(data.reply);
        this._emit("messageReceived", { reply: data.reply });
      } catch (err) {
        console.error("[ChatbotSDK] Fetch error:", err);
        this._removeTyping();
        this._addMessage(
          "bot",
          "Sorry, I'm having trouble connecting. Please try again.",
        );
        this._emit("error", { error: err });
      } finally {
        this._setInputLocked(false);
      }
    }

    async _sendSelection(value, selectionType = null, extra = null) {
      this._showTyping();
      this._setInputLocked(true);

      try {
        const res = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.sessionId,
            message: value,
            patientId: this.bookingState.patientId,
            bookingState: this.bookingState,
            extra: extra || null,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const data = await res.json();
        this._removeTyping();
        this._handleResponse(data.reply);
      } catch (err) {
        console.error("[ChatbotSDK] Selection error:", err);
        this._removeTyping();
        this._addMessage(
          "bot",
          "Sorry, there was an error processing your selection.",
        );
      } finally {
        this._setInputLocked(false);
      }
    }

    // ─── Private: Response handling ──────────────────────────────────────────

    _handleResponse(reply) {
      if (!reply) return;

      // ── State clearing ────────────────────────────────────────────────────
      if (reply.type === "restart_booking" || reply.clearState) {
        this.bookingState = {
          patientId: null,
          locationId: null,
          appointmentTypeId: null,
          selectedSlot: null,
        };
        this._removeOptionsContainer();
        this.currentOptions = null;
      }

      if (reply.type === "clear_patient") {
        this.bookingState.patientId = null;
      }

      if (reply.clearLocation) {
        this.bookingState.locationId = null;
        this.bookingState.appointmentTypeId = null;
        this.bookingState.selectedSlot = null;
        this._removeOptionsContainer();
        this.currentOptions = null;
      }

      if (reply.clearAppointmentType) {
        this.bookingState.appointmentTypeId = null;
        this.bookingState.selectedSlot = null;
        this._removeOptionsContainer();
        this.currentOptions = null;
      }

      if (reply.clearSlot) {
        this.bookingState.selectedSlot = null;
        this._removeOptionsContainer();
        this.currentOptions = null;
      }

      // ── Update patientId (first time only) ────────────────────────────────
      if (reply.patientId && !this.bookingState.patientId) {
        this.bookingState.patientId = reply.patientId;
      }

      // ── Show AI message first if present ──────────────────────────────────
      if (reply.aiMessage) {
        this._addMessage("bot", reply.aiMessage);
      }

      // ── Response type handler ─────────────────────────────────────────────
      switch (reply.type) {
        case "restart_booking":
        case "clear_patient":
          break;

        case "patient_verified":
          if (reply.patientId) this.bookingState.patientId = reply.patientId;
          if (!reply.aiMessage && reply.patient) {
            this._addMessage(
              "bot",
              `✅ Patient verified: ${reply.patient.first_name} ${reply.patient.last_name}`,
            );
          }
          break;

        case "patient_not_found":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              "No patient found. Please contact our support team for assistance.",
            );
          }
          break;

        case "multiple_patients_found":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              `Found ${reply.count} patients with that name. Please provide your email address.`,
            );
          }
          break;

        case "email_not_found":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              "No patient found with that email. Please provide your phone number.",
            );
          }
          break;

        case "locations_list":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              "Please select a location where you want to book an appointment:",
            );
          }
          if (reply.data && reply.data.length > 0) {
            this._renderOptions("location", reply.data);
          }
          break;

        case "appointment_types_list":
          if (!reply.aiMessage) {
            this._addMessage("bot", "Please select the type of appointment:");
          }
          if (reply.data && reply.data.length > 0) {
            this._renderOptions("appointmentType", reply.data);
          }
          break;

        case "available_slots":
          if (reply.data && reply.data.length > 0) {
            if (!reply.aiMessage) {
              this._addMessage("bot", "Please select an available time slot:");
            }
            this._renderSlotOptions(reply.data);
          } else {
            if (!reply.aiMessage) {
              this._addMessage(
                "bot",
                "No available slots found for the selected dates.",
              );
            }
            if (reply.unavailableDates && reply.unavailableDates.length > 0) {
              this._renderNoSlotsMessage(reply.unavailableDates);
            }
            this._addMessage(
              "bot",
              "Would you like to:\n1. Try a different location\n2. Try a different appointment type\n3. Contact support for assistance\n\nPlease let me know how I can help!",
            );
          }
          break;

        case "appointment_confirmed":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              reply.message ||
                "🎉 Your appointment has been booked successfully!",
            );
          }
          this.bookingState = {
            patientId: this.bookingState.patientId,
            locationId: null,
            appointmentTypeId: null,
            selectedSlot: null,
          };
          break;

        case "message":
          if (!reply.aiMessage && reply.message) {
            this._addMessage("bot", reply.message);
          }
          break;

        case "error":
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              `❌ ${reply.message || "Sorry, something went wrong."}`,
            );
          }
          break;

        default:
          if (!reply.aiMessage) {
            this._addMessage(
              "bot",
              reply.message || "I couldn't process that request.",
            );
          }
          break;
      }
    }

    // ─── Private: DOM helpers ────────────────────────────────────────────────

    _addMessage(sender, text) {
      const wrap = document.createElement("div");
      wrap.className = `chatbot-sdk-message ${sender}`;

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const iconClass = sender === "bot" ? "fas fa-robot" : "fas fa-user";

      const avatar = document.createElement("div");
      avatar.className = "chatbot-sdk-avatar";
      avatar.innerHTML = `<i class="${iconClass}"></i>`;

      const content = document.createElement("div");
      content.className = "chatbot-sdk-message-content";

      const bubble = document.createElement("div");
      bubble.className = "chatbot-sdk-bubble";
      bubble.innerHTML = this._escapeHtml(text);

      const timeEl = document.createElement("div");
      timeEl.className = "chatbot-sdk-time";
      timeEl.textContent = time;

      content.appendChild(bubble);
      content.appendChild(timeEl);
      wrap.appendChild(avatar);
      wrap.appendChild(content);
      this.elements.messages.appendChild(wrap);
      this._scrollToBottom();
    }

    _showTyping() {
      const wrap = document.createElement("div");
      wrap.className = "chatbot-sdk-message bot";
      wrap.id = `${this.instanceId}-typing`;

      const avatar = document.createElement("div");
      avatar.className = "chatbot-sdk-avatar";
      avatar.innerHTML = '<i class="fas fa-robot"></i>';

      const content = document.createElement("div");
      content.className = "chatbot-sdk-message-content";

      const bubble = document.createElement("div");
      bubble.className = "chatbot-sdk-bubble";
      bubble.innerHTML = `
        <div class="chatbot-sdk-typing">
          <div class="chatbot-sdk-typing-dot"></div>
          <div class="chatbot-sdk-typing-dot"></div>
          <div class="chatbot-sdk-typing-dot"></div>
        </div>`;

      content.appendChild(bubble);
      wrap.appendChild(avatar);
      wrap.appendChild(content);
      this.elements.messages.appendChild(wrap);
      this._scrollToBottom();
    }

    _removeTyping() {
      const el = document.getElementById(`${this.instanceId}-typing`);
      if (el) el.remove();
    }

    _removeOptionsContainer() {
      const el =
        this.elements.messages &&
        this.elements.messages.querySelector(".chatbot-sdk-options");
      if (el) el.remove();
    }

    _renderOptions(optionType, options) {
      this._removeOptionsContainer();
      this.currentOptions = { type: optionType, options };

      const container = document.createElement("div");
      container.className = "chatbot-sdk-options";

      options.forEach((opt, index) => {
        const btn = document.createElement("button");
        btn.className = "chatbot-sdk-option-btn";
        btn.type = "button";
        btn.textContent = `${index + 1}. ${opt.name || opt.type}`;

        const capturedOpt = opt;
        const capturedType = optionType;

        btn.addEventListener("click", () => {
          this._addMessage("user", capturedOpt.name || capturedOpt.type);

          if (capturedType === "location") {
            this.bookingState.locationId = capturedOpt.id;
          } else if (capturedType === "appointmentType") {
            this.bookingState.appointmentTypeId = capturedOpt.id;
          }

          container.remove();
          this.currentOptions = null;
          this._sendSelection(capturedOpt.id.toString(), capturedType);
        });

        container.appendChild(btn);
      });

      this.elements.messages.appendChild(container);
      this._scrollToBottom();
    }

    _renderSlotOptions(slots) {
      this._removeOptionsContainer();

      const container = document.createElement("div");
      container.className = "chatbot-sdk-options";

      slots.forEach((slot, index) => {
        const btn = document.createElement("button");
        btn.className = "chatbot-sdk-option-btn";
        btn.type = "button";

        const startDate = new Date(slot.start.replace(" ", "T"));
        const dateLabel = startDate.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        });
        const practitioner = slot.practitionerName
          ? ` (${slot.practitionerName})`
          : "";
        const displayText = `${index + 1}. ${dateLabel} - ${slot.title}${practitioner}`;

        btn.textContent = displayText;

        const capturedSlot = slot;
        const capturedDisplay = displayText;

        btn.addEventListener("click", () => {
          this._addMessage("user", capturedDisplay.replace(/^\d+\.\s*/, ""));

          this.bookingState.selectedSlot = {
            id: capturedSlot.id,
            practitionerId: capturedSlot.practitionerId,
            start: capturedSlot.start,
            end: capturedSlot.end,
            practitionerName: capturedSlot.practitionerName,
          };

          container.remove();
          this._sendSelection(`slot_${capturedSlot.id}`, "slot", {
            practitionerId: capturedSlot.practitionerId,
            start: capturedSlot.start,
            end: capturedSlot.end,
          });
        });

        container.appendChild(btn);
      });

      this.elements.messages.appendChild(container);
      this._scrollToBottom();
    }

    _renderNoSlotsMessage(unavailableDates) {
      const el = document.createElement("div");
      el.className = "chatbot-sdk-info";

      const from = unavailableDates[0];
      const to = unavailableDates[unavailableDates.length - 1];
      const range =
        unavailableDates.length > 0
          ? `${from} to ${to}`
          : "the selected period";

      const icon = document.createElement("i");
      icon.className = "fas fa-info-circle";
      icon.style.marginRight = "8px";

      const strong = document.createElement("strong");
      strong.textContent = "No appointments available";

      el.appendChild(icon);
      el.appendChild(strong);
      el.appendChild(document.createTextNode(` for ${range}.`));

      this.elements.messages.appendChild(el);
      this._scrollToBottom();
    }

    _setInputLocked(locked) {
      this.isTyping = locked;
      this.waitingForResponse = locked;
      this.elements.send.disabled = locked;
      this.elements.input.disabled = locked;
      if (!locked) this.elements.input.focus();
    }

    _scrollToBottom() {
      setTimeout(() => {
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      }, 100);
    }

    _escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = String(text);
      return div.innerHTML.replace(/\n/g, "<br>");
    }

    _escapeConfig(val) {
      return String(val).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    }

    // ─── Private: Initialisation ─────────────────────────────────────────────

    _generateUUID() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
    }

    _injectStyles() {
      if (document.getElementById("chatbot-sdk-styles")) return;
      const style = document.createElement("style");
      style.id = "chatbot-sdk-styles";
      style.textContent = this._getStyles();
      document.head.appendChild(style);
    }

    _getStyles() {
      const themes = {
        blue: { primary: "#007aff", primaryDark: "#0056cc" },
        green: { primary: "#34c759", primaryDark: "#28a745" },
        purple: { primary: "#af52de", primaryDark: "#8e44ad" },
        red: { primary: "#ff3b30", primaryDark: "#dc3545" },
        orange: { primary: "#ff9500", primaryDark: "#e68600" },
      };
      const t = themes[this.config.theme] || themes.blue;

      return `
        :root {
          --chatbot-primary:      ${t.primary};
          --chatbot-primary-dark: ${t.primaryDark};
          --chatbot-bot-bg:       #f2f2f7;
          --chatbot-user-bg:      ${t.primary};
          --chatbot-text-dark:    #1d1d1f;
          --chatbot-text-light:   #86868b;
          --chatbot-border:       #e5e5ea;
          --chatbot-shadow:       0 4px 24px rgba(0,0,0,0.1);
          --chatbot-radius:       16px;
          --chatbot-widget-size:  64px;
        }

        .chatbot-sdk * {
          margin:0; padding:0; box-sizing:border-box;
          font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }

        .chatbot-sdk-container {
          position:fixed;
          ${this._getPositionStyles()}
          z-index:999999;
        }

        .chatbot-sdk-button {
          width:var(--chatbot-widget-size); height:var(--chatbot-widget-size);
          border-radius:50%; background:var(--chatbot-primary); color:white;
          border:none; cursor:pointer; display:flex; align-items:center;
          justify-content:center; font-size:20px;
          box-shadow:0 6px 20px rgba(0,122,255,0.3);
          transition:all 0.3s ease; position:relative; z-index:1000001;
        }
        .chatbot-sdk-button:hover  { background:var(--chatbot-primary-dark); transform:scale(1.05); box-shadow:0 8px 25px rgba(0,122,255,0.4); }
        .chatbot-sdk-button.active { transform:rotate(90deg); background:#ff3b30; }
        .chatbot-sdk-button.active:hover { background:#d70015; }

        .chatbot-sdk-widget {
          width:400px; height:600px; background:white;
          border-radius:var(--chatbot-radius); box-shadow:var(--chatbot-shadow);
          overflow:hidden; display:flex; flex-direction:column;
          position:absolute; bottom:80px; right:0;
          opacity:0; visibility:hidden; transform:translateY(20px);
          transition:all 0.3s ease;
        }
        .chatbot-sdk-widget.active { opacity:1; visibility:visible; transform:translateY(0); }

        .chatbot-sdk-header {
          padding:16px 20px; background:white;
          border-bottom:1px solid var(--chatbot-border);
          display:flex; align-items:center; gap:12px; flex-shrink:0;
        }
        .chatbot-sdk-header-icon {
          width:36px; height:36px; background:var(--chatbot-primary);
          border-radius:10px; display:flex; align-items:center;
          justify-content:center; color:white; font-size:15px;
        }
        .chatbot-sdk-header-info h2 { font-size:17px; font-weight:600; color:var(--chatbot-text-dark); }
        .chatbot-sdk-header-info p  { font-size:13px; color:var(--chatbot-text-light); margin-top:2px; }

        .chatbot-sdk-status-dot {
          width:8px; height:8px; background:#30d158; border-radius:50%;
          margin-right:6px; display:inline-block; animation:chatbot-pulse 2s infinite;
        }
        @keyframes chatbot-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

        .chatbot-sdk-messages { flex:1; overflow-y:auto; padding:20px; background:#fafafa; }

        .chatbot-sdk-message {
          display:flex; gap:8px; margin-bottom:16px;
          animation:chatbot-fadeIn 0.3s ease;
        }
        @keyframes chatbot-fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }

        .chatbot-sdk-message.bot  { align-items:flex-start; }
        .chatbot-sdk-message.user { align-items:flex-end; flex-direction:row-reverse; }

        .chatbot-sdk-avatar {
          width:32px; height:32px; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0; font-size:13px;
        }
        .chatbot-sdk-message.bot  .chatbot-sdk-avatar { background:var(--chatbot-bot-bg); color:var(--chatbot-primary); }
        .chatbot-sdk-message.user .chatbot-sdk-avatar { background:var(--chatbot-user-bg); color:white; }

        .chatbot-sdk-message-content { max-width:70%; }
        .chatbot-sdk-message.bot  .chatbot-sdk-message-content { margin-right:auto; }
        .chatbot-sdk-message.user .chatbot-sdk-message-content { margin-left:auto; }

        .chatbot-sdk-bubble {
          padding:12px 16px; border-radius:18px;
          line-height:1.4; font-size:15px; word-wrap:break-word;
        }
        .chatbot-sdk-message.bot  .chatbot-sdk-bubble {
          background:white; color:var(--chatbot-text-dark);
          border:1px solid var(--chatbot-border); border-bottom-left-radius:4px;
        }
        .chatbot-sdk-message.user .chatbot-sdk-bubble {
          background:var(--chatbot-user-bg); color:white; border-bottom-right-radius:4px;
        }

        .chatbot-sdk-time { font-size:11px; color:var(--chatbot-text-light); margin-top:4px; text-align:right; }
        .chatbot-sdk-message.user .chatbot-sdk-time { color:rgba(255,255,255,0.7); }

        .chatbot-sdk-typing { display:flex; align-items:center; gap:4px; padding:4px 0; }
        .chatbot-sdk-typing-dot {
          width:6px; height:6px; background:var(--chatbot-text-light);
          border-radius:50%; animation:chatbot-typing 1.4s infinite ease-in-out;
        }
        .chatbot-sdk-typing-dot:nth-child(1){animation-delay:-0.32s}
        .chatbot-sdk-typing-dot:nth-child(2){animation-delay:-0.16s}
        @keyframes chatbot-typing { 0%,80%,100%{transform:scale(0.8);opacity:0.5} 40%{transform:scale(1);opacity:1} }

        .chatbot-sdk-input-container {
          padding:16px 20px; background:white;
          border-top:1px solid var(--chatbot-border); flex-shrink:0;
        }
        .chatbot-sdk-input-wrapper { display:flex; gap:12px; align-items:center; }

        .chatbot-sdk-input {
          flex:1; padding:12px 16px; border:1px solid var(--chatbot-border);
          border-radius:20px; font-size:15px; outline:none;
          transition:all 0.2s; background:#f2f2f7;
        }
        .chatbot-sdk-input:focus    { background:white; border-color:var(--chatbot-primary); }
        .chatbot-sdk-input:disabled { background:#e5e5ea; cursor:not-allowed; opacity:0.6; }

        .chatbot-sdk-send {
          width:44px; height:44px; border-radius:50%;
          background:var(--chatbot-primary); color:white;
          border:none; cursor:pointer; display:flex; align-items:center;
          justify-content:center; font-size:13px; transition:all 0.2s; flex-shrink:0;
        }
        .chatbot-sdk-send:hover    { background:var(--chatbot-primary-dark); transform:scale(1.05); }
        .chatbot-sdk-send:disabled { background:var(--chatbot-text-light); cursor:not-allowed; transform:none; }

        .chatbot-sdk-welcome { text-align:center; padding:40px 20px; color:var(--chatbot-text-light); }
        .chatbot-sdk-welcome-icon { font-size:48px; color:var(--chatbot-primary); margin-bottom:16px; opacity:0.5; }
        .chatbot-sdk-welcome h3 { font-size:18px; font-weight:600; color:var(--chatbot-text-dark); margin-bottom:8px; }
        .chatbot-sdk-welcome p  { font-size:14px; }

        .chatbot-sdk-options { margin:12px 0; padding:0 8px; }
        .chatbot-sdk-option-btn {
          display:block; width:100%; padding:12px 16px; margin:8px 0;
          background:#f2f2f7; border:1px solid #e5e5ea; border-radius:10px;
          text-align:left; font-size:15px; cursor:pointer;
          transition:all 0.2s; font-family:inherit;
        }
        .chatbot-sdk-option-btn:hover    { background:#e5e5ea; border-color:var(--chatbot-primary); }
        .chatbot-sdk-option-btn:active   { background:#d0d0d7; transform:scale(0.98); }
        .chatbot-sdk-option-btn:disabled { opacity:0.5; cursor:not-allowed; }

        .chatbot-sdk-info {
          background:#fff3cd; border:1px solid #ffc107;
          border-radius:10px; padding:12px 16px;
          margin:12px 0; font-size:14px; color:#856404;
        }

        .chatbot-sdk-overlay {
          position:fixed; top:0; left:0; width:100%; height:100%;
          background:transparent; z-index:999998; display:none;
        }
        .chatbot-sdk-overlay.active { display:block; }

        .chatbot-sdk-messages::-webkit-scrollbar       { width:6px; }
        .chatbot-sdk-messages::-webkit-scrollbar-track  { background:transparent; }
        .chatbot-sdk-messages::-webkit-scrollbar-thumb  { background:#c7c7cc; border-radius:3px; }

        @media (max-width:480px) {
          .chatbot-sdk-widget { width:calc(100vw - 40px); height:70vh; max-width:100%; }
          .chatbot-sdk-container { bottom:20px !important; right:20px !important; }
          .chatbot-sdk-message-content { max-width:80%; }
        }
      `;
    }

    _getPositionStyles() {
      const positions = {
        "bottom-right": "bottom:30px; right:30px;",
        "bottom-left": "bottom:30px; left:30px;",
        "top-right": "top:30px; right:30px;",
        "top-left": "top:30px; left:30px;",
      };
      return positions[this.config.position] || positions["bottom-right"];
    }

    _injectHTML() {
      const safeTitle = this._escapeConfig(this.config.headerTitle);
      const safeSubtitle = this._escapeConfig(this.config.headerSubtitle);
      const safePlaceholder = this._escapeConfig(this.config.placeholder);
      const id = this.instanceId;

      const container = document.createElement("div");
      container.className = "chatbot-sdk chatbot-sdk-container";
      container.setAttribute("data-chatbot-sdk", id);

      container.innerHTML = `
        <div class="chatbot-sdk-widget" id="${id}-widget">

          <div class="chatbot-sdk-header">
            <div class="chatbot-sdk-header-icon">
              <i class="fas fa-robot"></i>
            </div>
            <div class="chatbot-sdk-header-info">
              <h2>${safeTitle}</h2>
              <p><span class="chatbot-sdk-status-dot"></span>${safeSubtitle}</p>
            </div>
          </div>

          <div class="chatbot-sdk-messages" id="${id}-messages">
            <div class="chatbot-sdk-welcome" id="${id}-welcome">
              <div class="chatbot-sdk-welcome-icon">
                <i class="fas fa-comments"></i>
              </div>
              <h3>Start a conversation</h3>
              <p>I'm here to help you with anything you need!</p>
            </div>
          </div>

          <div class="chatbot-sdk-input-container">
            <div class="chatbot-sdk-input-wrapper">
              <input
                type="text"
                class="chatbot-sdk-input"
                id="${id}-input"
                placeholder="${safePlaceholder}"
                autocomplete="off"
              />
              <button class="chatbot-sdk-send" id="${id}-send" type="button">
                <i class="fas fa-paper-plane"></i>
              </button>
            </div>
          </div>

        </div>

        <button class="chatbot-sdk-button" id="${id}-button" type="button">
          <i class="fas fa-comments"></i>
        </button>
      `;

      const overlay = document.createElement("div");
      overlay.className = "chatbot-sdk-overlay";
      overlay.id = `${id}-overlay`;

      document.body.appendChild(overlay);
      document.body.appendChild(container);

      this.elements = {
        container,
        overlay,
        button: document.getElementById(`${id}-button`),
        widget: document.getElementById(`${id}-widget`),
        messages: document.getElementById(`${id}-messages`),
        welcome: document.getElementById(`${id}-welcome`),
        input: document.getElementById(`${id}-input`),
        send: document.getElementById(`${id}-send`),
      };
    }

    _attachEventListeners() {
      this.elements.button.addEventListener("click", () => this.toggle());
      this.elements.overlay.addEventListener("click", () => this.close());
      this.elements.send.addEventListener("click", () => this.sendMessage());
      this.elements.input.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !this.waitingForResponse) this.sendMessage();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) this.close();
      });
    }

    _emit(event, data = {}) {
      (this.eventHandlers[event] || []).forEach((cb) => cb(data));
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ChatbotSDK;
  } else {
    global.ChatbotSDK = ChatbotSDK;
  }
})(typeof window !== "undefined" ? window : this);
