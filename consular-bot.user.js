// ==UserScript==
// @name         Consular Appointment Bot
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Monitors the US Visa portal for available appointment slots and sends Telegram notifications
// @author       Leniel510
// @match        https://ais.usvisa-info.com/es-do/niv/schedule/*
// @match        https://ais.usvisa-info.com/es-do/niv/users/sign_in*
// @match        https://ais.usvisa-info.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=usvisa-info.com
// @grant        none
// ==/UserScript==

// ─── Configuration ────────────────────────────────────────────────────────────
const CONFIG = {
  telegram: {
    token: "",          // Your Telegram bot token (see README)
    chatId: "",         // Your Telegram chat ID (see README)
  },
  credentials: {
    email: "",          // Your portal email
    password: "",       // Your portal password
  },
  timing: {
    loginDelay:   { min: 2000, max: 3000 },
    pageDelay:    { min: 1000, max: 2000 },
    calendarWait: { min: 2000, max: 3000 },
    reloadWait:   { min: 15000, max: 30000 },
    pollInterval: 500,
    monthsToCheck: 4,
  },
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Returns a random integer between min and max (inclusive).
 * Used to add human-like delays and avoid detection.
 */
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * Waits for a DOM element matching `selector` to appear,
 * then calls `callback(element)`. Stops polling after `timeout` ms.
 */
function waitForElement(selector, callback, timeout = 10000) {
  const start = Date.now();
  const interval = setInterval(() => {
    const el = document.querySelector(selector);
    if (el) {
      clearInterval(interval);
      callback(el);
    } else if (Date.now() - start > timeout) {
      clearInterval(interval);
      console.warn(`[Bot] Timeout waiting for: ${selector}`);
    }
  }, CONFIG.timing.pollInterval);
}

/**
 * Sends a message to the configured Telegram chat.
 */
async function sendTelegramMessage(text) {
  const { token, chatId } = CONFIG.telegram;
  if (!token || !chatId) {
    console.warn("[Bot] Telegram credentials not configured.");
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[Bot] Failed to send Telegram message:", err);
  }
}

// ─── Page Handlers ────────────────────────────────────────────────────────────

/**
 * Handles the login page:
 * - Notifies via Telegram that the session expired
 * - Fills in credentials and submits the form
 */
function handleLoginPage() {
  sendTelegramMessage("⚠️ Session expired — attempting to log in again.");

  window.addEventListener("load", () => {
    waitForElement("#user_email", () => {
      const email    = document.querySelector("#user_email");
      const password = document.querySelector("#user_password");
      const checkbox = document.querySelector("#policy_confirmed");
      const btnLogin = document.querySelector("input[value='Iniciar sesión']");

      email.value    = CONFIG.credentials.email;
      password.value = CONFIG.credentials.password;

      if (checkbox && !checkbox.checked) checkbox.click();

      setTimeout(() => {
        if (btnLogin) btnLogin.click();
      }, randomDelay(CONFIG.timing.loginDelay.min, CONFIG.timing.loginDelay.max));
    });
  });
}

/**
 * Handles the groups/account selection page:
 * - Clicks the "Continue" button to proceed
 */
function handleGroupsPage() {
  window.addEventListener("load", () => {
    waitForElement("a.button.primary.small", (btn) => {
      setTimeout(() => btn.click(), randomDelay(
        CONFIG.timing.pageDelay.min,
        CONFIG.timing.pageDelay.max
      ));
    });
  });
}

/**
 * Handles the actions page:
 * - Expands the "Reschedule appointment" accordion
 * - Clicks the reschedule button once it's visible
 */
function handleContinueActionsPage() {
  setTimeout(() => {
    const allAccordions = () => [...document.querySelectorAll("a.accordion-title")];

    const rescheduleLink = allAccordions().find(el =>
      el.innerText.trim().includes("Reprogramar cita")
    );
    if (rescheduleLink) rescheduleLink.click();

    waitForElement("a.accordion-title", () => {
      const reschedule = allAccordions().find(el =>
        el.innerText.trim().includes("Reprogramar cita")
      );

      if (!reschedule) return;

      const container = reschedule.closest("li") || reschedule.parentElement;
      const btn = container?.querySelector("a.button.small.primary.small-only-expanded");

      if (btn) {
        setTimeout(() => btn.click(), CONFIG.timing.pollInterval);
      }
    });
  }, 3000);
}

/**
 * Handles the appointment confirmation page:
 * - Checks the confirmation checkbox
 * - Clicks the Continue button
 */
function handleAppointmentPage() {
  window.addEventListener("load", () => {
    waitForElement("#confirmed_limit_message", () => {
      const checkbox = document.querySelector("#confirmed_limit_message");
      const buttons  = [...document.querySelectorAll("input.button.primary")];

      if (checkbox && !checkbox.checked) checkbox.click();

      setTimeout(() => {
        const continueBtn = buttons.find(el =>
          /Continue|Continuar/i.test(el.value.trim())
        );
        if (continueBtn) continueBtn.click();
      }, 1000);
    });
  });
}

// ─── Calendar Scanner ─────────────────────────────────────────────────────────

/**
 * Extracts available dates from the datepicker and formats them as DD/MM/YYYY strings.
 */
function getAvailableDates() {
  const availableDays = document.querySelectorAll(
    "#ui-datepicker-div td:not(.ui-datepicker-unselectable):not(.ui-state-disabled):not(.ui-datepicker-other-month)"
  );

  return [...availableDays].map(td => {
    const month = td.dataset.month ? parseInt(td.dataset.month) + 1 : "?";
    const year  = td.dataset.year  || "?";
    const day   = td.querySelector("a")?.innerText || "?";
    return `${day}/${month}/${year}`;
  });
}

/**
 * Main calendar scanning loop:
 * - Opens the datepicker
 * - Iterates over the next N months looking for available slots
 * - If found, sends a Telegram alert
 * - If not found, reloads the page after a random delay
 */
function startCalendarScan() {
  console.log("[Bot] Waiting for date input...");

  waitForElement("#appointments_consulate_appointment_date", (input) => {
    console.log("[Bot] Date input found, opening calendar...");

    setTimeout(() => input.click(), 2000);

    let monthsChecked = 0;

    function checkCurrentMonth() {
      setTimeout(async () => {
        const availableDates = getAvailableDates();

        if (availableDates.length > 0) {
          const dateList = availableDates.join(", ");
          console.log(`[Bot] ✅ Available dates found: ${dateList}`);
          await sendTelegramMessage(`✅ Appointment slots available!\n📅 Dates: ${dateList}`);
          return; // Stop scanning — user needs to act
        }

        monthsChecked++;
        console.log(`[Bot] Month ${monthsChecked} checked — no appointments.`);

        if (monthsChecked < CONFIG.timing.monthsToCheck) {
          const nextBtn = document.querySelector(".ui-datepicker-next");
          if (nextBtn) {
            nextBtn.click();
            checkCurrentMonth();
          } else {
            console.log("[Bot] Next button not found — reopening calendar.");
            input.click();
            checkCurrentMonth();
          }
        } else {
          monthsChecked = 0;
          const delay = randomDelay(
            CONFIG.timing.reloadWait.min,
            CONFIG.timing.reloadWait.max
          );
          console.log(`[Bot] All months checked. Reloading in ${delay / 1000}s...`);
          setTimeout(() => location.reload(), delay);
        }
      }, randomDelay(CONFIG.timing.calendarWait.min, CONFIG.timing.calendarWait.max));
    }

    checkCurrentMonth();
  });
}

// ─── Router ───────────────────────────────────────────────────────────────────

const url = window.location.href;

if (url.includes("sign_in")) {
  handleLoginPage();
} else if (url.includes("groups")) {
  handleGroupsPage();
} else if (url.includes("continue_actions")) {
  handleContinueActionsPage();
} else if (url.includes("appointment")) {
  handleAppointmentPage();
}

// The calendar scanner runs on all matching pages (schedule/*)
startCalendarScan();
