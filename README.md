# Citas Bot

A Node.js bot that monitors the US Visa portal (`ais.usvisa-info.com`) for available appointment slots and automatically reschedules them when a better date is found.

## How It Works

```text
Login → GET available days → Filter by target range → GET available times → Reschedule
  ↑                                                                              |
  └──────────────────── session expired? re-login ──────────────────────────────┘
```

## Features

- Pure HTTP client — no browser needed after login, talks directly to the portal's JSON API
- Auto-login with CSRF token handling and session cookie management
- Automatic re-login when session expires
- Target range filtering — only reschedules if a slot is earlier than the current appointment and within the configured date range
- Dry run mode — finds slots without actually submitting, safe for testing
- Telegram notifications for critical events — successful reschedule, login failures, errors
- Randomized check intervals to avoid detection

## Project Structure

```text
citas-bot/
├── src/
│   ├── client.js         # HTTP client — login, fetch days/times, reschedule
│   ├── runner.js         # Bot loop — error recovery, session management, notifications
│   └── index.js          # Entry point — client config
├── consular-bot.user.js  # Original Tampermonkey script (legacy)
└── .env                  # Credentials (never commit this)
```

## Prerequisites

- Node.js v18 or higher
- An active account on [ais.usvisa-info.com](https://ais.usvisa-info.com)
- A Telegram bot token and chat ID (optional but recommended)

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```
3. Create a `.env` file in the root:
EMAIL=your_portal_email
PASSWORD=your_portal_password
SCHEDULE_ID=your_schedule_id
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

4. Configure your target date range in `src/index.js`

5. Run in dry run mode first to verify everything works:
```bash
node src/index.js
```

## Configuration

In `src/index.js` fill in the client config:

```js
const clientConfig = {
  name: "Client Name",
  email: process.env.EMAIL,
  password: process.env.PASSWORD,
  scheduleId: process.env.SCHEDULE_ID,
  facilityId: 138,        // consulate facility ID
  ascFacilityId: 139,     // ASC facility ID
  currentAppointment: "2027-04-14",  // their current appointment
  targetStart: "2026-01-01",         // earliest acceptable date
  targetEnd: "2027-01-01",           // latest acceptable date
  telegramToken: process.env.TELEGRAM_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  dryRun: true,  // set to false to enable real rescheduling
};
```

### Finding your Schedule ID

It's in the URL when you're on the appointment page:
https://ais.usvisa-info.com/es-do/niv/schedule/73896042/appointment
^^^^^^^^
this is your schedule ID
### Getting Telegram credentials

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts to get your token
3. Search for `@userinfobot` to get your chat ID

## Security Notes


- Always test with `dryRun: true` before enabling real rescheduling
- Each account has a maximum of 3 reschedule attempts — the bot only submits when a slot is within your configured target range

## Tech Stack

- Node.js v24
- Native fetch API
- Telegram Bot API

## License

MIT