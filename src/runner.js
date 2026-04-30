import { VisaClient } from "./client.js";

const TELEGRAM_API = "https://api.telegram.org";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Returns a random integer between min and max (inclusive)
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// Connection-level failure (TLS abort, dropped tunnel, DNS, timeout) — no HTTP response reached us.
// Distinct from portal errors, which surface as "Failed to get days: 4xx" or SESSION_EXPIRED.
function isNetworkError(err) {
  if (!err) return false;
  if (err.message === "fetch failed") return true;
  if (err.message?.startsWith("Network error reaching")) return true;
  return false;
}

async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) return;
  try {
    await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (err) {
    console.error("[Telegram] Failed to send message:", err.message);
  }
}

export class BotRunner {
  constructor(config) {
    this.config = config;
    this.isRunning = false;
    this.status = "idle";
    this.checksCount = 0;
    this.lastCheckAt = null;
    this.errorMessage = null;

    this.client = new VisaClient({
      email: config.email,
      password: config.password,
      scheduleId: config.scheduleId,
      facilityId: config.facilityId,
      ascFacilityId: config.ascFacilityId,
      proxies: config.proxies,
    });
  }

  async notify(text) {
    const { telegramToken, telegramChatId, name } = this.config;
    await sendTelegram(telegramToken, telegramChatId, `[${name}] ${text}`);
  }

  updateStatus(status, errorMessage = null) {
    this.status = status;
    this.errorMessage = errorMessage;
    console.log(`[STATUS] ${this.config.name} → ${status}`);
  }

  async start() {
    if (this.isRunning) {
      console.log(`[Bot] ${this.config.name} is already running.`);
      return;
    }

    this.isRunning = true;
    this.updateStatus("running");
    console.log(`[Bot] Starting for client: ${this.config.name}`);

    const ok = await this.loginWithRetry("Login");
    if (!ok) return;

    await this.runLoop();
  }

  async loginWithRetry(label) {
    while (this.isRunning) {
      try {
        await this.client.login();
        return true;
      } catch (err) {
        this.updateStatus("error", err.message);
        console.log(`[ERROR] ${label} failed: ${err.message}. Retrying in 60s...`);
        await this.notify(`${label} failed: ${err.message}. Retrying in 60s...`);
        await sleep(60000);
        this.updateStatus("running");
      }
    }
    return false;
  }

  async runLoop() {
    while (this.isRunning) {
      try {
        await this.check();

        const delay = randomDelay(15000, 30000);
        console.log(`[Bot] Next check in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      } catch (err) {
        if (err.message === "SESSION_EXPIRED") {
          console.log("[Bot] Session expired, re-logging in...");
          const ok = await this.loginWithRetry("Re-login");
          if (!ok) return;
          continue;
        }

        if (isNetworkError(err) && this.client.rotateProxy()) {
          console.log(`[Bot] Network error: ${err.message}. Rotated proxy, retrying in 5s...`);
          await sleep(5000);
          continue;
        }

        this.updateStatus("error", err.message);
        console.log(`[Bot] Error: ${err.message}. Retrying in 60s...`);
        await this.notify(`Error: ${err.message}`);
        await sleep(60000);
        this.updateStatus("running");
      }
    }
  }

  async check() {
    this.checksCount++;
    this.lastCheckAt = new Date().toISOString();
    console.log(`[Bot] Check #${this.checksCount} for ${this.config.name}...`);

    const result = await this.client.findAndReschedule({
      start: this.config.targetStart,
      end: this.config.targetEnd,
      currentDate: this.config.currentAppointment,
      dryRun: this.config.dryRun || false,
    });

    if (result?.rescheduled) {
      await this.notify(`Appointment rescheduled!\nConsular: ${result.consularDate} at ${result.consularTime}\nASC: ${result.ascDate} at ${result.ascTime}`);
      this.updateStatus("completed");
      this.isRunning = false;
      return;
    }

    // In dry-run mode, a result without rescheduled=true means a slot was found but not booked
    if (result && !result.rescheduled) {
      await this.notify(`[DRY RUN] Slot found:\nConsular: ${result.consularDate} at ${result.consularTime}\nASC: ${result.ascDate} at ${result.ascTime}`);
    }
  }

  async stop() {
    this.isRunning = false;
    this.updateStatus("stopped");
    await this.notify("Bot stopped.");
    console.log(`[Bot] Stopped for client: ${this.config.name}`);
  }
}
