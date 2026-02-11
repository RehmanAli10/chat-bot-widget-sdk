/**
 * AI Chat Widget SDK
 * Embeddable chat widget for WordPress and other websites
 * Version: 1.0.0
 */

(function (window) {
  "use strict";

  // Prevent multiple initializations
  if (window.AIChatWidget) {
    console.warn("AI Chat Widget already initialized");
    return;
  }

  class AIChatWidget {
    constructor(config = {}) {
      this.config = {
        apiUrl: config.apiUrl || "http://127.0.0.1:3000/api/chat",
        position: config.position || "bottom-right", // bottom-right, bottom-left
        primaryColor: config.primaryColor || "#007aff",
        buttonSize: config.buttonSize || 64,
        zIndex: config.zIndex || 1000,
        greeting:
          config.greeting ||
          "Hello! 👋 I can help you book an appointment.\n\nTo get started, please provide your email.",
        headerTitle: config.headerTitle || "AI Assistant",
        headerSubtitle: config.headerSubtitle || "Online • Ready to chat",
        autoOpen: config.autoOpen || false,
        ...config,
      };

      this.sessionId = this.generateUUID();
      this.isTyping = false;
      this.isChatOpen = false;
      this.hasShownWelcome = false;
      this.bookingState = {
        patientId: null,
        locationId: null,
        appointmentTypeId: null,
        selectedSlot: null,
      };
      this.currentOptions = null;
      this.waitingForResponse = false;

      this.init();
    }

    generateUUID() {
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
        /[xy]/g,
        function (c) {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        },
      );
    }

    init() {
      this.injectStyles();
      this.createWidget();
      this.attachEventListeners();

      if (this.config.autoOpen) {
        setTimeout(() => this.openChat(), 500);
      }
    }

    injectStyles() {
      const styleId = "ai-chat-widget-styles";
      if (document.getElementById(styleId)) return;

      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .ai-chat-widget-container {
          --ai-primary: ${this.config.primaryColor};
          --ai-primary-dark: ${this.adjustColor(this.config.primaryColor, -20)};
          --ai-bot-bg: #f2f2f7;
          --ai-user-bg: ${this.config.primaryColor};
          --ai-text-dark: #1d1d1f;
          --ai-text-light: #86868b;
          --ai-border: #e5e5ea;
          --ai-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
          --ai-radius: 16px;
          --ai-widget-size: ${this.config.buttonSize}px;
          
          position: fixed;
          ${this.getPositionStyles()}
          z-index: ${this.config.zIndex};
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }

        .ai-chat-widget-container * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        .ai-chat-button {
          width: var(--ai-widget-size);
          height: var(--ai-widget-size);
          border-radius: 50%;
          background: var(--ai-primary);
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          box-shadow: 0 6px 20px rgba(0, 122, 255, 0.3);
          transition: all 0.3s ease;
          position: relative;
          z-index: ${this.config.zIndex + 1};
        }

        .ai-chat-button:hover {
          background: var(--ai-primary-dark);
          transform: scale(1.05);
          box-shadow: 0 8px 25px rgba(0, 122, 255, 0.4);
        }

        .ai-chat-button.active {
          transform: rotate(90deg);
          background: #ff3b30;
        }

        .ai-chat-button.active:hover {
          background: #d70015;
        }

        .ai-chat-widget {
          max-width: 400px;
          height: 600px;
          background: white;
          border-radius: var(--ai-radius);
          box-shadow: var(--ai-shadow);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          position: absolute;
          bottom: calc(var(--ai-widget-size) + 20px);
          ${this.config.position.includes("right") ? "right: 0;" : "left: 0;"}
          opacity: 0;
          visibility: hidden;
          transform: translateY(20px);
          transition: all 0.3s ease;
        }

        .ai-chat-widget.active {
          opacity: 1;
          visibility: visible;
          transform: translateY(0);
        }

        .ai-chat-header {
          padding: 16px 20px;
          background: white;
          border-bottom: 1px solid var(--ai-border);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ai-header-icon {
          width: 36px;
          height: 36px;
          background: var(--ai-primary);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 18px;
        }

        .ai-header-info h2 {
          font-size: 17px;
          font-weight: 600;
          color: var(--ai-text-dark);
        }

        .ai-header-info p {
          font-size: 13px;
          color: var(--ai-text-light);
          margin-top: 2px;
        }

        .ai-status-dot {
          width: 8px;
          height: 8px;
          background: #30d158;
          border-radius: 50%;
          margin-right: 6px;
          display: inline-block;
          animation: ai-pulse 2s infinite;
        }

        @keyframes ai-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .ai-messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          background: #fafafa;
        }

        .ai-message {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
          animation: ai-fadeIn 0.3s ease;
        }

        @keyframes ai-fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .ai-message.bot {
          align-items: flex-start;
        }

        .ai-message.user {
          align-items: flex-end;
          flex-direction: row-reverse;
        }

        .ai-message-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 14px;
        }

        .ai-message.bot .ai-message-avatar {
          background: var(--ai-bot-bg);
          color: var(--ai-primary);
        }

        .ai-message.user .ai-message-avatar {
          background: var(--ai-user-bg);
          color: white;
        }

        .ai-message-content {
          max-width: 70%;
        }

        .ai-message-bubble {
          padding: 12px 16px;
          border-radius: 18px;
          line-height: 1.4;
          font-size: 15px;
          word-wrap: break-word;
        }

        .ai-message.bot .ai-message-bubble {
          background: white;
          color: var(--ai-text-dark);
          border: 1px solid var(--ai-border);
          border-bottom-left-radius: 4px;
        }

        .ai-message.user .ai-message-bubble {
          background: var(--ai-user-bg);
          color: white;
          border-bottom-right-radius: 4px;
        }

        .ai-message-time {
          font-size: 11px;
          color: var(--ai-text-light);
          margin-top: 4px;
          text-align: right;
        }

        .ai-message.user .ai-message-time {
          color: rgba(255, 255, 255, 0.7);
        }

        .ai-typing-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 12px;
        }

        .ai-typing-dot {
          width: 6px;
          height: 6px;
          background: var(--ai-text-light);
          border-radius: 50%;
          animation: ai-typing 1.4s infinite ease-in-out;
        }

        .ai-typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .ai-typing-dot:nth-child(2) { animation-delay: -0.16s; }

        @keyframes ai-typing {
          0%, 80%, 100% {
            transform: scale(0.8);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .ai-input-container {
          padding: 16px 20px;
          background: white;
          border-top: 1px solid var(--ai-border);
        }

        .ai-input-wrapper {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .ai-message-input {
          flex: 1;
          padding: 12px 16px;
          border: 1px solid var(--ai-border);
          border-radius: 20px;
          font-size: 15px;
          outline: none;
          transition: all 0.2s;
          background: #f2f2f7;
          font-family: inherit;
        }

        .ai-message-input:focus {
          background: white;
          border-color: var(--ai-primary);
        }

        .ai-message-input:disabled {
          background: #e5e5ea;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .ai-send-button {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: var(--ai-primary);
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }

        .ai-send-button:hover {
          background: var(--ai-primary-dark);
          transform: scale(1.05);
        }

        .ai-send-button:disabled {
          background: var(--ai-text-light);
          cursor: not-allowed;
          transform: none;
        }

        .ai-welcome-message {
          text-align: center;
          padding: 40px 20px;
          color: var(--ai-text-light);
        }

        .ai-welcome-icon {
          font-size: 48px;
          color: var(--ai-primary);
          margin-bottom: 16px;
          opacity: 0.5;
        }

        .ai-messages-container::-webkit-scrollbar {
          width: 6px;
        }

        .ai-messages-container::-webkit-scrollbar-track {
          background: transparent;
        }

        .ai-messages-container::-webkit-scrollbar-thumb {
          background: #c7c7cc;
          border-radius: 3px;
        }

        .ai-options-container {
          margin: 12px 0;
          padding: 0 8px;
        }

        .ai-option-button {
          display: block;
          width: 100%;
          padding: 12px 16px;
          margin: 8px 0;
          background: #f2f2f7;
          border: 1px solid #e5e5ea;
          border-radius: 10px;
          text-align: left;
          font-size: 15px;
          cursor: pointer;
          transition: all 0.2s;
          font-family: inherit;
        }

        .ai-option-button:hover {
          background: #e5e5ea;
          border-color: var(--ai-primary);
        }

        .ai-option-button:active {
          background: #d0d0d7;
          transform: scale(0.98);
        }

        .ai-option-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .ai-info-message {
          background: #fff3cd;
          border: 1px solid #ffc107;
          border-radius: 10px;
          padding: 12px 16px;
          margin: 12px 0;
          font-size: 14px;
          color: #856404;
        }

        .ai-chat-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: transparent;
          z-index: ${this.config.zIndex - 1};
          display: none;
        }

        .ai-chat-overlay.active {
          display: block;
        }

        @media (max-width: 480px) {
          .ai-chat-widget {
            width: calc(100vw - 40px);
            height: 70vh;
            max-width: 100%;
            border-radius: var(--ai-radius);
            bottom: calc(var(--ai-widget-size) + 20px);
            ${this.config.position.includes("right") ? "right: 20px;" : "left: 20px;"}
          }

          .ai-chat-widget-container {
            ${this.config.position.includes("bottom") ? "bottom: 20px;" : "top: 20px;"}
            ${this.config.position.includes("right") ? "right: 20px;" : "left: 20px;"}
          }

          .ai-message-content {
            max-width: 80%;
          }
        }

        /* Font Awesome Icons (minimal SVG icons) */
        .ai-icon {
          display: inline-block;
          width: 1em;
          height: 1em;
          vertical-align: -0.125em;
        }
      `;

      document.head.appendChild(style);
    }

    getPositionStyles() {
      const positions = {
        "bottom-right": "bottom: 30px; right: 30px;",
        "bottom-left": "bottom: 30px; left: 30px;",
        "top-right": "top: 30px; right: 30px;",
        "top-left": "top: 30px; left: 30px;",
      };
      return positions[this.config.position] || positions["bottom-right"];
    }

    adjustColor(color, percent) {
      const num = parseInt(color.replace("#", ""), 16);
      const amt = Math.round(2.55 * percent);
      const R = (num >> 16) + amt;
      const G = ((num >> 8) & 0x00ff) + amt;
      const B = (num & 0x0000ff) + amt;
      return (
        "#" +
        (
          0x1000000 +
          (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
          (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
          (B < 255 ? (B < 1 ? 0 : B) : 255)
        )
          .toString(16)
          .slice(1)
      );
    }

    createWidget() {
      // Create container
      this.container = document.createElement("div");
      this.container.className = "ai-chat-widget-container";
      this.container.innerHTML = `
        <div class="ai-chat-widget">
          <div class="ai-chat-header">
            <div class="ai-header-icon">
              ${this.getIcon("robot")}
            </div>
            <div class="ai-header-info">
              <h2>${this.config.headerTitle}</h2>
              <p><span class="ai-status-dot"></span> ${this.config.headerSubtitle}</p>
            </div>
          </div>

          <div class="ai-messages-container">
            <div class="ai-welcome-message">
              <div class="ai-welcome-icon">
                ${this.getIcon("comments")}
              </div>
              <h3>Start a conversation</h3>
              <p>I'm here to help you with anything you need!</p>
            </div>
          </div>

          <div class="ai-input-container">
            <div class="ai-input-wrapper">
              <input
                type="text"
                class="ai-message-input"
                placeholder="Type your message..."
                autocomplete="off"
              />
              <button class="ai-send-button">
                ${this.getIcon("send")}
              </button>
            </div>
          </div>
        </div>

        <button class="ai-chat-button">
          ${this.getIcon("comments")}
        </button>
      `;

      // Create overlay
      this.overlay = document.createElement("div");
      this.overlay.className = "ai-chat-overlay";

      document.body.appendChild(this.overlay);
      document.body.appendChild(this.container);

      // Cache DOM elements
      this.elements = {
        button: this.container.querySelector(".ai-chat-button"),
        widget: this.container.querySelector(".ai-chat-widget"),
        messagesContainer: this.container.querySelector(
          ".ai-messages-container",
        ),
        welcomeMessage: this.container.querySelector(".ai-welcome-message"),
        input: this.container.querySelector(".ai-message-input"),
        sendButton: this.container.querySelector(".ai-send-button"),
      };
    }

    getIcon(name) {
      const icons = {
        robot:
          '<svg viewBox="0 0 640 512" fill="currentColor" style="width:1em;height:1em"><path d="M320 0c17.7 0 32 14.3 32 32V96H472c39.8 0 72 32.2 72 72V440c0 39.8-32.2 72-72 72H168c-39.8 0-72-32.2-72-72V168c0-39.8 32.2-72 72-72H288V32c0-17.7 14.3-32 32-32zM208 384c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H208zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H304zm96 0c-8.8 0-16 7.2-16 16s7.2 16 16 16h32c8.8 0 16-7.2 16-16s-7.2-16-16-16H400zM264 256a40 40 0 1 0 -80 0 40 40 0 1 0 80 0zm152 40a40 40 0 1 0 0-80 40 40 0 1 0 0 80z"/></svg>',
        comments:
          '<svg viewBox="0 0 640 512" fill="currentColor" style="width:1em;height:1em"><path d="M208 352c114.9 0 208-78.8 208-176S322.9 0 208 0S0 78.8 0 176c0 38.6 14.7 74.3 39.6 103.4c-3.5 9.4-8.7 17.7-14.2 24.7c-4.8 6.2-9.7 11-13.3 14.3c-1.8 1.6-3.3 2.9-4.3 3.7c-.5 .4-.9 .7-1.1 .8l-.2 .2 0 0 0 0C1 327.2-1.4 334.4 .8 340.9S9.1 352 16 352c21.8 0 43.8-5.6 62.1-12.5c9.2-3.5 17.8-7.4 25.3-11.4C134.1 343.3 169.8 352 208 352zM448 176c0 112.3-99.1 196.9-216.5 207C255.8 457.4 336.4 512 432 512c38.2 0 73.9-8.7 104.7-23.9c7.5 4 16 7.9 25.2 11.4c18.3 6.9 40.3 12.5 62.1 12.5c6.9 0 13.1-4.5 15.2-11.1c2.1-6.6-.2-13.8-5.8-17.9l0 0 0 0-.2-.2c-.2-.2-.6-.4-1.1-.8c-1-.8-2.5-2-4.3-3.7c-3.6-3.3-8.5-8.1-13.3-14.3c-5.5-7-10.7-15.4-14.2-24.7c24.9-29 39.6-64.7 39.6-103.4c0-92.8-84.9-168.9-192.6-175.5c.4 5.1 .6 10.3 .6 15.5z"/></svg>',
        user: '<svg viewBox="0 0 448 512" fill="currentColor" style="width:1em;height:1em"><path d="M224 256A128 128 0 1 0 224 0a128 128 0 1 0 0 256zm-45.7 48C79.8 304 0 383.8 0 482.3C0 498.7 13.3 512 29.7 512H418.3c16.4 0 29.7-13.3 29.7-29.7C448 383.8 368.2 304 269.7 304H178.3z"/></svg>',
        send: '<svg viewBox="0 0 512 512" fill="currentColor" style="width:1em;height:1em"><path d="M498.1 5.6c10.1 7 15.4 19.1 13.5 31.2l-64 416c-1.5 9.7-7.4 18.2-16 23s-18.9 5.4-28 1.6L284 427.7l-68.5 74.1c-8.9 9.7-22.9 12.9-35.2 8.1S160 493.2 160 480V396.4c0-4 1.5-7.8 4.2-10.7L331.8 202.8c5.8-6.3 5.6-16-.4-22s-15.7-6.4-22-.7L106 360.8 17.7 316.6C7.1 311.3 .3 300.7 0 288.9s5.9-22.8 16.1-28.7l448-256c10.7-6.1 23.9-5.5 34 1.4z"/></svg>',
        times:
          '<svg viewBox="0 0 384 512" fill="currentColor" style="width:1em;height:1em"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z"/></svg>',
      };
      return icons[name] || "";
    }

    attachEventListeners() {
      this.elements.button.addEventListener("click", () => this.toggleChat());
      this.overlay.addEventListener("click", () => this.closeChat());
      this.elements.sendButton.addEventListener("click", () =>
        this.sendMessage(),
      );
      this.elements.input.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !this.waitingForResponse) {
          this.sendMessage();
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isChatOpen) {
          this.closeChat();
        }
      });
    }

    toggleChat() {
      this.isChatOpen ? this.closeChat() : this.openChat();
    }

    openChat() {
      this.isChatOpen = true;
      this.elements.widget.classList.add("active");
      this.overlay.classList.add("active");
      this.elements.button.classList.add("active");
      this.elements.button.innerHTML = this.getIcon("times");
      this.elements.input.focus();

      if (!this.hasShownWelcome) {
        this.hasShownWelcome = true;
        this.elements.welcomeMessage.style.display = "none";
        setTimeout(() => {
          this.addMessage("bot", this.config.greeting);
        }, 300);
      } else if (this.elements.messagesContainer.children.length > 1) {
        this.elements.welcomeMessage.style.display = "none";
      }

      // Trigger custom event
      this.triggerEvent("chatOpened");
    }

    closeChat() {
      this.isChatOpen = false;
      this.elements.widget.classList.remove("active");
      this.overlay.classList.remove("active");
      this.elements.button.classList.remove("active");
      this.elements.button.innerHTML = this.getIcon("comments");

      // Trigger custom event
      this.triggerEvent("chatClosed");
    }

    async sendMessage() {
      const message = this.elements.input.value.trim();

      if (!message || this.isTyping || this.waitingForResponse) return;

      // Handle numeric option selection
      if (this.currentOptions && /^\d+$/.test(message)) {
        const optionIndex = parseInt(message) - 1;

        if (
          optionIndex >= 0 &&
          optionIndex < this.currentOptions.options.length
        ) {
          const selectedOption = this.currentOptions.options[optionIndex];

          if (this.currentOptions.type === "location") {
            this.bookingState.locationId = selectedOption.id;
          } else if (this.currentOptions.type === "appointmentType") {
            this.bookingState.appointmentTypeId = selectedOption.id;
          }

          const optionsContainer = this.container.querySelector(
            ".ai-options-container",
          );
          if (optionsContainer) {
            optionsContainer.remove();
          }

          this.currentOptions = null;
        }
      }

      if (
        this.elements.welcomeMessage &&
        this.elements.welcomeMessage.style.display !== "none"
      ) {
        this.elements.welcomeMessage.style.display = "none";
      }

      this.addMessage("user", message);
      this.elements.input.value = "";
      this.showTyping();
      this.isTyping = true;
      this.waitingForResponse = true;
      this.elements.sendButton.disabled = true;
      this.elements.input.disabled = true;

      try {
        const response = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: this.sessionId,
            message: message,
            patientId: this.bookingState.patientId,
            bookingState: this.bookingState,
            extra: null,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        this.removeTyping();
        this.handleBackendResponse(data.reply);

        // Trigger custom event
        this.triggerEvent("messageSent", { message, response: data });
      } catch (error) {
        console.error("AI Chat Widget Error:", error);
        this.removeTyping();
        this.addMessage(
          "bot",
          "Sorry, I'm having trouble connecting. Please try again.",
        );

        // Trigger custom event
        this.triggerEvent("error", { error });
      } finally {
        this.isTyping = false;
        this.waitingForResponse = false;
        this.elements.sendButton.disabled = false;
        this.elements.input.disabled = false;
        this.elements.input.focus();
      }
    }

    handleBackendResponse(reply) {
      // Handle state clearing signals
      if (reply.type === "restart_booking" || reply.clearState) {
        this.bookingState = {
          patientId: null,
          locationId: null,
          appointmentTypeId: null,
          selectedSlot: null,
        };
        const optionsContainer = this.container.querySelector(
          ".ai-options-container",
        );
        if (optionsContainer) optionsContainer.remove();
        this.currentOptions = null;
      }

      if (reply.type === "clear_patient") {
        this.bookingState.patientId = null;
      }

      if (reply.clearLocation) {
        this.bookingState.locationId = null;
        this.bookingState.appointmentTypeId = null;
        this.bookingState.selectedSlot = null;
        const optionsContainer = this.container.querySelector(
          ".ai-options-container",
        );
        if (optionsContainer) optionsContainer.remove();
        this.currentOptions = null;
      }

      if (reply.clearAppointmentType) {
        this.bookingState.appointmentTypeId = null;
        this.bookingState.selectedSlot = null;
        const optionsContainer = this.container.querySelector(
          ".ai-options-container",
        );
        if (optionsContainer) optionsContainer.remove();
        this.currentOptions = null;
      }

      if (reply.clearSlot) {
        this.bookingState.selectedSlot = null;
        const optionsContainer = this.container.querySelector(
          ".ai-options-container",
        );
        if (optionsContainer) optionsContainer.remove();
        this.currentOptions = null;
      }

      // Update patientId if present
      if (reply.patientId && !this.bookingState.patientId) {
        this.bookingState.patientId = reply.patientId;
      }

      // Always display AI message first if present
      // Support both 'aiMessage' and 'message' field names
      const messageText = reply.aiMessage || reply.message;
      if (messageText) {
        this.addMessage("bot", messageText);
      }

      // Handle different response types
      switch (reply.type) {
        case "patient_verified":
          if (reply.patientId) {
            this.bookingState.patientId = reply.patientId;
          }
          break;

        case "locations_list":
          if (reply.data && reply.data.length > 0) {
            this.renderOptions("location", reply.data);
          }
          break;

        case "appointment_types_list":
          if (reply.data && reply.data.length > 0) {
            this.renderOptions("appointmentType", reply.data);
          }
          break;

        case "available_slots":
          if (reply.data && reply.data.length > 0) {
            this.renderSlotOptions(reply.data);
          } else {
            if (!messageText) {
              this.addMessage(
                "bot",
                "No available slots found for the selected dates.",
              );
            }
            if (reply.unavailableDates && reply.unavailableDates.length > 0) {
              this.renderNoSlotsMessage(reply.unavailableDates);
            }
          }
          break;

        case "appointment_confirmed":
          this.bookingState = {
            patientId: this.bookingState.patientId,
            locationId: null,
            appointmentTypeId: null,
            selectedSlot: null,
          };
          break;

        case "error":
          const errorMsg = messageText || "Sorry, something went wrong.";
          if (!messageText) {
            this.addMessage("bot", `❌ ${errorMsg}`);
          }
          break;

        case "message":
          break;
      }
    }

    addMessage(sender, text) {
      const messageDiv = document.createElement("div");
      messageDiv.className = `ai-message ${sender}`;

      const time = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });

      const avatarIcon =
        sender === "bot" ? this.getIcon("robot") : this.getIcon("user");

      messageDiv.innerHTML = `
        <div class="ai-message-avatar">
          ${avatarIcon}
        </div>
        <div class="ai-message-content">
          <div class="ai-message-bubble">${this.escapeHtml(text)}</div>
          <div class="ai-message-time">${time}</div>
        </div>
      `;

      this.elements.messagesContainer.appendChild(messageDiv);
      this.scrollToBottom();
    }

    showTyping() {
      const typingDiv = document.createElement("div");
      typingDiv.className = "ai-message bot";
      typingDiv.id = "ai-typing-indicator";
      typingDiv.innerHTML = `
        <div class="ai-message-avatar">
          ${this.getIcon("robot")}
        </div>
        <div class="ai-message-content">
          <div class="ai-message-bubble">
            <div class="ai-typing-indicator">
              <div class="ai-typing-dot"></div>
              <div class="ai-typing-dot"></div>
              <div class="ai-typing-dot"></div>
            </div>
          </div>
        </div>
      `;

      this.elements.messagesContainer.appendChild(typingDiv);
      this.scrollToBottom();
    }

    removeTyping() {
      const typingIndicator = document.getElementById("ai-typing-indicator");
      if (typingIndicator) {
        typingIndicator.remove();
      }
    }

    renderOptions(optionType, options) {
      this.currentOptions = { type: optionType, options: options };

      const container = document.createElement("div");
      container.className = "ai-options-container";

      options.forEach((opt, index) => {
        const btn = document.createElement("button");
        btn.className = "ai-option-button";
        btn.textContent = `${index + 1}. ${opt.name || opt.type}`;

        btn.onclick = () => {
          this.addMessage("user", opt.name || opt.type);

          if (optionType === "location") {
            this.bookingState.locationId = opt.id;
          } else if (optionType === "appointmentType") {
            this.bookingState.appointmentTypeId = opt.id;
          }

          this.sendSelection(opt.id.toString(), optionType);
          container.remove();
          this.currentOptions = null;
        };

        container.appendChild(btn);
      });

      this.elements.messagesContainer.appendChild(container);
      this.scrollToBottom();
    }

    renderSlotOptions(slots) {
      const container = document.createElement("div");
      container.className = "ai-options-container";

      slots.forEach((slot, index) => {
        const btn = document.createElement("button");
        btn.className = "ai-option-button";

        const startDate = new Date(slot.start.replace(" ", "T"));
        const displayText = `${index + 1}. ${startDate.toLocaleDateString(
          "en-US",
          {
            weekday: "short",
            month: "short",
            day: "numeric",
          },
        )} - ${slot.title}${slot.practitionerName ? ` (${slot.practitionerName})` : ""}`;

        btn.textContent = displayText;

        btn.onclick = () => {
          this.addMessage("user", displayText.substring(3));

          this.bookingState.selectedSlot = {
            id: slot.id,
            practitionerId: slot.practitionerId,
            start: slot.start,
            end: slot.end,
            practitionerName: slot.practitionerName,
          };

          this.sendSelection(`slot_${slot.id}`, "slot", {
            practitionerId: slot.practitionerId,
            start: slot.start,
            end: slot.end,
          });
          container.remove();
        };

        container.appendChild(btn);
      });

      this.elements.messagesContainer.appendChild(container);
      this.scrollToBottom();
    }

    renderNoSlotsMessage(unavailableDates) {
      const container = document.createElement("div");
      container.className = "ai-info-message";

      const dateRange =
        unavailableDates.length > 0
          ? `${unavailableDates[0]} to ${unavailableDates[unavailableDates.length - 1]}`
          : "the selected period";

      container.innerHTML = `
        <strong>No appointments available</strong> for ${dateRange}.
      `;

      this.elements.messagesContainer.appendChild(container);
      this.scrollToBottom();
    }

    async sendSelection(value, selectionType = null, extra = null) {
      this.showTyping();
      this.isTyping = true;
      this.waitingForResponse = true;
      this.elements.sendButton.disabled = true;
      this.elements.input.disabled = true;

      try {
        const payload = {
          sessionId: this.sessionId,
          message: value,
          patientId: this.bookingState.patientId,
          bookingState: this.bookingState,
          extra: extra,
        };

        const response = await fetch(this.config.apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        this.removeTyping();
        this.handleBackendResponse(data.reply);
      } catch (err) {
        console.error("Selection error:", err);
        this.removeTyping();
        this.addMessage(
          "bot",
          "Sorry, there was an error processing your selection.",
        );
      } finally {
        this.isTyping = false;
        this.waitingForResponse = false;
        this.elements.sendButton.disabled = false;
        this.elements.input.disabled = false;
        this.elements.input.focus();
      }
    }

    escapeHtml(text) {
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML.replace(/\n/g, "<br>");
    }

    scrollToBottom() {
      setTimeout(() => {
        this.elements.messagesContainer.scrollTop =
          this.elements.messagesContainer.scrollHeight;
      }, 100);
    }

    triggerEvent(eventName, data = {}) {
      const event = new CustomEvent(`aiChatWidget:${eventName}`, {
        detail: { widget: this, ...data },
      });
      window.dispatchEvent(event);
    }

    // Public API methods
    destroy() {
      if (this.container) {
        this.container.remove();
      }
      if (this.overlay) {
        this.overlay.remove();
      }
      const style = document.getElementById("ai-chat-widget-styles");
      if (style) {
        style.remove();
      }
    }

    open() {
      this.openChat();
    }

    close() {
      this.closeChat();
    }

    sendCustomMessage(message) {
      this.elements.input.value = message;
      this.sendMessage();
    }
  }

  // Expose to window
  window.AIChatWidget = AIChatWidget;

  // Auto-initialize if config is present
  if (window.aiChatWidgetConfig) {
    window.aiChatWidgetInstance = new AIChatWidget(window.aiChatWidgetConfig);
  }
})(window);
