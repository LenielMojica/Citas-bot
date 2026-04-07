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

const CONFIG = {
  telegram: {
    token: "",
    chatId: "",
  },
  credentials: {
    email: "",
    password: "",
  },
  timing: {
    loginDelay: { min: 2000, max: 3000 },
    pageDelay: { min: 1000, max: 2000 },
    calendarWait: { min: 2000, max: 3000 },
    timeWait: { min: 1500, max: 2500 },
    reloadWait: { min: 15000, max: 30000 },
    pollInterval: 500,
    monthsToCheck: 4,
  },
};

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

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

function handleLoginPage() {
  sendTelegramMessage("Session expired - attempting to log in again.");

  window.addEventListener("load", () => {
    waitForElement("#user_email", () => {
      const email = document.querySelector("#user_email");
      const password = document.querySelector("#user_password");
      const checkbox = document.querySelector("#policy_confirmed");
      const btnLogin = document.querySelector("input[value='Iniciar sesión']");

      email.value = CONFIG.credentials.email;
      password.value = CONFIG.credentials.password;

      if (checkbox && !checkbox.checked) checkbox.click();

      setTimeout(() => {
        if (btnLogin) btnLogin.click();
      }, randomDelay(CONFIG.timing.loginDelay.min, CONFIG.timing.loginDelay.max));
    });
  });
}

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

function handleContinueActionsPage() {
  setTimeout(() => {
    const allAccordions = () => [...document.querySelectorAll("a.accordion-title")];

    const rescheduleLink = allAccordions().find((el) =>
      el.innerText.trim().includes("Reprogramar cita")
    );
    if (rescheduleLink) rescheduleLink.click();

    waitForElement("a.accordion-title", () => {
      const reschedule = allAccordions().find((el) =>
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

function handleAppointmentPage() {
  window.addEventListener("load", () => {
    waitForElement("#confirmed_limit_message", () => {
      const checkbox = document.querySelector("#confirmed_limit_message");
      const buttons = [...document.querySelectorAll("input.button.primary")];

      if (checkbox && !checkbox.checked) checkbox.click();

      setTimeout(() => {
        const continueBtn = buttons.find((el) =>
          /Continue|Continuar/i.test(el.value.trim())
        );
        if (continueBtn) continueBtn.click();
      }, 1000);
    });
  });
}

// Reads whichever jQuery UI datepicker is currently open and returns
// clickable day cells plus a formatted label for logging/alerts.
function getAvailableDays() {
  const availableDays = document.querySelectorAll(
    "#ui-datepicker-div td:not(.ui-datepicker-unselectable):not(.ui-state-disabled):not(.ui-datepicker-other-month)"
  );

  return [...availableDays].map((td) => {
    const month = td.dataset.month ? parseInt(td.dataset.month, 10) + 1 : "?";
    const year = td.dataset.year || "?";
    const day = td.querySelector("a")?.innerText || "?";
    return {
      cell: td,
      label: `${day}/${month}/${year}`,
    };
  });
}

// Waits for a time dropdown to refresh after a date click, then selects
// the first real time option (skipping the blank placeholder option).
function selectFirstAvailableTime(selectSelector, previousValues = "", timeout = 10000) {
  const start = Date.now();

  function trySelectTime(resolve) {
    const select = document.querySelector(selectSelector);

    if (!select) {
      if (Date.now() - start <= timeout) {
        setTimeout(() => trySelectTime(resolve), CONFIG.timing.pollInterval);
      } else {
        console.warn(`[Bot] Timeout waiting for time select: ${selectSelector}`);
        resolve(null);
      }
      return;
    }

    const currentValues = [...select.options].map((option) => option.value).join("|");
    const firstAvailableOption = [...select.options].find(
      (option) => option.value.trim() !== "" && !option.disabled
    );

    if (!firstAvailableOption || currentValues === previousValues) {
      if (Date.now() - start <= timeout) {
        setTimeout(() => trySelectTime(resolve), CONFIG.timing.pollInterval);
      } else {
        console.log("[Bot] No available times found for the selected date.");
        resolve(null);
      }
      return;
    }

    firstAvailableOption.selected = true;
    select.value = firstAvailableOption.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const selectedTime = firstAvailableOption.text.trim();
    console.log(`[Bot] Selected first available time: ${selectedTime}`);
    resolve(selectedTime);
  }

  return new Promise((resolve) => {
    trySelectTime(resolve);
  });
}

// Tries each currently visible date until one produces an available time.
async function findDateWithAvailableTime(timeSelector) {
  const availableDays = getAvailableDays();

  for (const { cell, label } of availableDays) {
    const clickableDay = cell.querySelector("a") || cell;
    const timeSelect = document.querySelector(timeSelector);
    const previousValues = timeSelect
      ? [...timeSelect.options].map((option) => option.value).join("|")
      : "";

    clickableDay.click();
    console.log(`[Bot] Testing date: ${label}`);

    const firstTime = await selectFirstAvailableTime(timeSelector, previousValues);
    if (firstTime) {
      return { date: label, time: firstTime };
    }
  }

  return null;
}

// Scans one appointment fieldset by opening its calendar, checking up to the
// configured number of months, and returning the first date/time pair found.
function scanAppointmentField(dateSelector, timeSelector, appointmentLabel) {
  return new Promise((resolve) => {
    waitForElement(dateSelector, (input) => {
      console.log(`[Bot] ${appointmentLabel} date input found, opening calendar...`);

      setTimeout(() => input.click(), 2000);

      let monthsChecked = 0;

      function checkCurrentMonth() {
        setTimeout(async () => {
          const availableDays = getAvailableDays();

          if (availableDays.length > 0) {
            const availableLabels = availableDays.map(({ label }) => label).join(", ");
            console.log(`[Bot] ${appointmentLabel} dates found: ${availableLabels}`);

            const appointment = await findDateWithAvailableTime(timeSelector);
            if (appointment) {
              resolve(appointment);
              return;
            }

            console.log(`[Bot] ${appointmentLabel} dates found, but none had time slots.`);
          }

          monthsChecked++;
          console.log(`[Bot] ${appointmentLabel} month ${monthsChecked} checked - no appointments.`);

          if (monthsChecked < CONFIG.timing.monthsToCheck) {
            const nextBtn = document.querySelector(".ui-datepicker-next");
            if (nextBtn) {
              nextBtn.click();
              checkCurrentMonth();
            } else {
              console.log(`[Bot] Next button not found for ${appointmentLabel} - reopening calendar.`);
              input.click();
              checkCurrentMonth();
            }
          } else {
            resolve(null);
          }
        }, randomDelay(CONFIG.timing.calendarWait.min, CONFIG.timing.calendarWait.max));
      }

      checkCurrentMonth();
    });
  });
}

// Clicks the final submit button once both appointment fieldsets are filled.
function submitReschedule() {
  const submitButton = document.querySelector("#appointments_submit");

  if (!submitButton) {
    console.warn("[Bot] Reschedule button not found.");
    return false;
  }

  submitButton.click();
  console.log("[Bot] Reschedule button clicked.");
  return true;
}

// Watches for a success/confirmation state after submitting the reschedule.
function waitForRescheduleConfirmation(timeout = 15000) {
  const start = Date.now();

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const bodyText = document.body?.innerText || "";
      const successMessage = document.querySelector(".notice, .alert, .flash, .flash-message");
      const successDetected =
        /reprogramad|reprogramada|reprogramado|success|confirmad|confirmada/i.test(bodyText) ||
        (!!successMessage && /reprogramad|success|confirmad/i.test(successMessage.innerText));

      if (successDetected) {
        clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() - start > timeout) {
        clearInterval(interval);
        resolve(false);
      }
    }, CONFIG.timing.pollInterval);
  });
}

// Main scheduling flow:
// 1. Find/select the consular appointment.
// 2. Find/select the ASC appointment.
// 3. Submit the reschedule and notify Telegram.
function startCalendarScan() {
  console.log("[Bot] Waiting for appointment inputs...");

  waitForElement("#appointments_consulate_appointment_date", async () => {
    const consularAppointment = await scanAppointmentField(
      "#appointments_consulate_appointment_date",
      "#appointments_consulate_appointment_time",
      "Consular"
    );

    if (!consularAppointment) {
      const delay = randomDelay(
        CONFIG.timing.reloadWait.min,
        CONFIG.timing.reloadWait.max
      );
      console.log(`[Bot] No consular appointments found. Reloading in ${delay / 1000}s...`);
      setTimeout(() => location.reload(), delay);
      return;
    }

    console.log(
      `[Bot] Consular appointment selected: ${consularAppointment.date} at ${consularAppointment.time}`
    );

    const ascAppointment = await scanAppointmentField(
      "#appointments_asc_appointment_date",
      "#appointments_asc_appointment_time",
      "ASC"
    );

    if (!ascAppointment) {
      console.log("[Bot] ASC appointment not found after selecting consular appointment.");
      return;
    }

    console.log(`[Bot] ASC appointment selected: ${ascAppointment.date} at ${ascAppointment.time}`);
    await sendTelegramMessage(
      `Appointments selected. Consular: ${consularAppointment.date} at ${consularAppointment.time}. ASC: ${ascAppointment.date} at ${ascAppointment.time}. Submitting reschedule now.`
    );

    setTimeout(async () => {
      const submitted = submitReschedule();
      if (!submitted) {
        return;
      }

      const confirmed = await waitForRescheduleConfirmation();
      if (confirmed) {
        await sendTelegramMessage(
          `Reschedule submitted successfully. Consular: ${consularAppointment.date} at ${consularAppointment.time}. ASC: ${ascAppointment.date} at ${ascAppointment.time}.`
        );
      } else {
        console.log("[Bot] Reschedule confirmation was not detected.");
      }
    }, 1000);
  });
}

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

startCalendarScan();
