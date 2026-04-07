# Consular Appointment Bot

A Tampermonkey userscript that monitors the US Visa portal (`ais.usvisa-info.com`) for available appointment slots and sends real-time alerts via Telegram.

## Features

- Auto-login: detects session expiration and logs back in automatically
- Calendar scanning: checks the next 4 months for available slots on every page load
- Telegram notifications: alerts you instantly when an appointment opens up
- Human-like delays: randomized wait times to avoid bot detection
- Page routing: handles every step of the scheduling flow automatically

## How It Works

```text
Session expires -> Auto login -> Navigate to reschedule flow
     |
Open calendar -> Scan N months for available dates
     |
Found? -> Send Telegram alert
     |
Not found? -> Wait 15-30s -> Reload -> Repeat
```

## Prerequisites

- [Tampermonkey](https://www.tampermonkey.net/) browser extension
- A Telegram bot token and chat ID
- An active account on [ais.usvisa-info.com](https://ais.usvisa-info.com)

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension for your browser.
2. Click the Tampermonkey icon and create a new script.
3. Copy the contents of [`consular-bot.user.js`](./consular-bot.user.js) and paste them in.
4. Fill in your credentials and Telegram config.
5. Save and enable the script.

## Configuration

At the top of the script, fill in the `CONFIG` object:

```js
const CONFIG = {
  telegram: {
    token: "YOUR_BOT_TOKEN",
    chatId: "YOUR_CHAT_ID",
  },
  credentials: {
    email: "you@example.com",
    password: "yourpassword",
  },
  // ...
};
```

### Getting your Telegram credentials

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to copy the token.
3. Search for `@userinfobot` and start it to get your Chat ID.

## Configuration Options

| Option | Default | Description |
|---|---|---|
| `timing.monthsToCheck` | `4` | How many months ahead to scan |
| `timing.reloadWait` | `15-30s` | Wait time between full page reloads |
| `timing.calendarWait` | `2-3s` | Wait time between checking each month |
| `timing.loginDelay` | `2-3s` | Delay before submitting the login form |

## Security Notes

Never commit your credentials or bot token to a public repository.

Before pushing to GitHub, make sure the `CONFIG` block has empty strings:

```js
token: "",
chatId: "",
email: "",
password: "",
```

## Project Structure

```text
consular-appointment-bot/
`-- consular-bot.user.js
```

## Tech Stack

- Vanilla JavaScript
- Tampermonkey
- DOM manipulation with polling via `setInterval`
- Telegram Bot API

## License

MIT - free to use and modify.
