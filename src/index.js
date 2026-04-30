import { BotRunner } from "./runner.js";
import dotenv from "dotenv";
dotenv.config();

// Parse PROXIES from .env as a comma-separated list of full URLs
// (e.g. PROXIES=http://user:pass@host1:port,http://user:pass@host2:port)
// Empty/unset → bot runs without a proxy.
const PROXIES = (process.env.PROXIES || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
// WARNING: Move credentials and tokens to environment variables before making this repo public.
// Anyone with access to this file can log in to the portal or send Telegram messages as this bot.
const clientConfig = {
  // Client identity — used as a label in Telegram notifications
  name: "Test Client",

  // Portal login credentials for ais.usvisa-info.com
  email: process.env.EMAIL,
  password: process.env.PASSWORD
  ,

  // Found in the portal URL: /schedule/{scheduleId}/appointment
  scheduleId: process.env.SCHEDULE_ID,

  // Facility IDs — fixed values for Dominican Republic
  facilityId: 138,
  ascFacilityId: 139,

  // The appointment date currently booked (used for reference)
  currentAppointment: "2026-05-08",

  // Only reschedule if a slot falls within this date range
  targetStart: "2026-04-25",
  targetEnd: "2027-12-31",

  // Telegram bot credentials for notifications
  telegramToken: process.env.TELEGRAM_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
proxies: PROXIES,

  // For testing: skip the actual reschedule step and just log when a slot would be booked
  // Set to false to actually submit the reschedule request
  dryRun: true,
};

const bot = new BotRunner(clientConfig);
bot.start();
