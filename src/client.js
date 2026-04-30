import { fetch, ProxyAgent } from "undici";
const BASE_URL = "https://ais.usvisa-info.com/es-do/niv";

// undici's ProxyAgent doesn't reliably parse user:pass embedded in the URL,
// so split credentials out and pass them as a pre-built Basic auth token.
function buildProxyAgent(proxyUrl) {
  const url = new URL(proxyUrl);
  const opts = { uri: `${url.protocol}//${url.host}` };
  if (url.username) {
    const auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    opts.token = `Basic ${Buffer.from(auth).toString("base64")}`;
  }
  return new ProxyAgent(opts);
}

// Shared browser-like headers to avoid being detected as a bot
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};

export class VisaClient {
  constructor({ email, password, scheduleId, facilityId, ascFacilityId, proxies }) {
    this.email = email;
    this.password = password;
    this.scheduleId = scheduleId;
    this.facilityId = facilityId;
    this.ascFacilityId = ascFacilityId;
    this.cookie = null;
    this.proxies= proxies || [];
      this.currentProxy = null;
  }
pickProxy() {
  if (this.proxies.length === 0) return null;
  return this.proxies[Math.floor(Math.random() * this.proxies.length)];
}

banCurrentProxy() {
  this.proxies = this.proxies.filter(p => p !== this.currentProxy);
  this.currentProxy = null;
  this.log("warn", `Proxy banned. ${this.proxies.length} proxies remaining.`);
}

// Swap to a different proxy without dropping the session cookie.
// Used after a network-level abort (the portal accepts the cookie from any IP — verified).
rotateProxy() {
  if (this.proxies.length <= 1) return false;
  const others = this.proxies.filter(p => p !== this.currentProxy);
  if (others.length === 0) return false;
  const previous = this.currentProxy;
  this.currentProxy = others[Math.floor(Math.random() * others.length)];
  this.log("info", `Rotated proxy: ${previous} → ${this.currentProxy}`);
  return true;
}
  log(level, message) {
    console.log(`[${level.toUpperCase()}] ${message}`);
  }


getRequestOptions(extraHeaders = {}, extraOptions = {}) {
  const options = {
    headers: this.getAuthHeaders(extraHeaders), ...extraOptions
  };

  if (this.currentProxy) {
    options.dispatcher = buildProxyAgent(this.currentProxy);
  }

  return options;
}

  // Builds headers for authenticated requests, merging browser defaults with any extras
  getAuthHeaders(extra = {}) {
    return {
      ...BROWSER_HEADERS,
      Cookie: this.cookie,
      Referer: `${BASE_URL}/schedule/${this.scheduleId}/appointment`,
      ...extra,
    };
  }

  // Extracts and stores the _yatri_session cookie from a response
  saveCookie(response) {
    const raw = response.headers.get("set-cookie");
    console.log("[DEBUG] Raw cookies:", raw ? raw.substring(0, 80) : "null");

    if (!raw) return;

    const match = raw.match(/_yatri_session=[^;]+/);
    if (match) {
      this.cookie = match[0];
      this.log("info", `Session cookie saved. Length: ${this.cookie.length}`);
    }
  }

  async getAvailableDays(facilityId) {
    this.log("info", "Fetching available days...");

    const url = `${BASE_URL}/schedule/${this.scheduleId}/appointment/days/${facilityId}.json?appointments[expedite]=false`;
    console.log("[DEBUG] Cookie being sent:", this.cookie ? `length ${this.cookie.length}` : "none");
console.log("[DEBUG] Cookie starts with:", this.cookie?.substring(0, 30));

    const response = await fetch(url, this.getRequestOptions({ Accept: "application/json" },),
    );

    if (response.status === 401) throw new Error("SESSION_EXPIRED");
    if (!response.ok) throw new Error(`Failed to get days: ${response.status}`);

    const data = await response.json();
    return Array.isArray(data) ? data.map((d) => d.date) : [];
  }

  async getAvailableTimes(date, facilityId) {
    this.log("info", "Fetching available times...");

    const url = `${BASE_URL}/schedule/${this.scheduleId}/appointment/times/${facilityId}.json?date=${date}&appointments[expedite]=false`;
    const response = await fetch(url, this.getRequestOptions({ Accept: "application/json" }),
    );

    if (response.status === 401) throw new Error("SESSION_EXPIRED");
    if (!response.ok) throw new Error(`Failed to get times: ${response.status}`);

    const data = await response.json();
    return  data.available_times || [];
  }

  // Fetches the CSRF token from the appointment page (required for POST requests)
  async getCsrfToken() {
    this.log("info", "Fetching CSRF token...");

    const url = `${BASE_URL}/schedule/${this.scheduleId}/appointment`;
    const response = await fetch(url,this.getRequestOptions({ Accept: "text/html" }) , 
    );

    if (response.status === 401) throw new Error("SESSION_EXPIRED");

    const html = await response.text();
    const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);

    if (!match) throw new Error("CSRF token not found on page.");

    this.log("info", "CSRF token obtained.");
    return match[1];
  }

  // Submits the reschedule form with both consular and ASC appointment details
  async reschedule({ consularDate, consularTime, ascDate, ascTime }) {
    this.log("info", `Submitting appointment for ${consularDate} at ${consularTime}...`);

    const token = await this.getCsrfToken();

    const body = new URLSearchParams({
      authenticity_token: token,
      confirmed_limit_message: "1",
      use_consulate_appointment_capacity: "true",
      "appointments[consulate_appointment][facility_id]": String(this.facilityId),
      "appointments[consulate_appointment][date]": consularDate,
      "appointments[consulate_appointment][time]": consularTime,
      "appointments[asc_appointment][facility_id]": String(this.ascFacilityId),
      "appointments[asc_appointment][date]": ascDate,
      "appointments[asc_appointment][time]": ascTime,
    });

    const response = await fetch(
      `${BASE_URL}/schedule/${this.scheduleId}/appointment`,
      this.getRequestOptions(
        { "Content-Type": "application/x-www-form-urlencoded" },
        { method: "POST", redirect: "manual", body }
      )
    );

    if (response.status === 401) throw new Error("SESSION_EXPIRED");

    // The portal responds with a redirect (302) or 200 on success
    if (response.status !== 302 && response.status !== 200) {
      throw new Error(`Reschedule failed with status: ${response.status}`);
    }

    this.log("info", "Reschedule successful!");
    return true;
  }

  async login() {
    this.currentProxy = this.pickProxy();
this.log("info", `Using proxy: ${this.currentProxy || "none"}`);
    this.log("info", `Logging in as ${this.email}...`);

    // Step 1: GET login page — capture the unauthenticated session cookie and CSRF token
    let loginPage;
    try {
      loginPage = await fetch(`${BASE_URL}/users/sign_in`,this.getRequestOptions({ Accept: "text/html" },) ,
      );
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message || err.message;
      if (this.currentProxy) this.banCurrentProxy();
      throw new Error(`Network error reaching the portal: ${cause}. Check your VPN or internet connection.`);
    }

    this.saveCookie(loginPage);
    const html = await loginPage.text();
    const match = html.match(/name="csrf-token"\s+content="([^"]+)"/);
    const token = match ? match[1] : null;

    console.log("[DEBUG] CSRF token:", token ? "found" : "not found");
    console.log("[DEBUG] Cookie after GET:", this.cookie ? `length ${this.cookie.length}` : "none");

    // Step 2: POST credentials — must send the GET cookie so the server can validate the CSRF token
    const body = new URLSearchParams({
      authenticity_token: token,
      "user[email]": this.email,
      "user[password]": this.password,
      policy_confirmed: "1",
      commit: "Iniciar sesión",
    });

    const response = await fetch(
      `${BASE_URL}/users/sign_in`,
      this.getRequestOptions(
        { "Content-Type": "application/x-www-form-urlencoded" },
        { method: "POST", redirect: "manual", body }
      )
    );

    console.log("[DEBUG] POST status:", response.status);
    this.saveCookie(response); // overwrite with the authenticated session cookie

    console.log("[DEBUG] Cookie after POST:", this.cookie ? `length ${this.cookie.length}` : "none");

    if (!this.cookie) throw new Error("Login failed — no session cookie received.");

    this.log("info", "Login successful.");
    return true;
  }

  // Finds the earliest available slot in the target date range and reschedules (or dry-runs)
  async findAndReschedule({ start, end, currentDate, dryRun = false }) {
    this.log("info", `Checking slots between ${start} and ${end}...`);

    const consularDays = await this.getAvailableDays(this.facilityId);
    await new Promise(r => setTimeout(r, 1000));
const ascDays = await this.getAvailableDays(this.ascFacilityId);

    const validConsularDays = consularDays.filter((d) => d >= start && d <= end);
    const validAscDays = ascDays.filter((d) => d >= start && d <= end);

    if (validConsularDays.length === 0) {
      this.log("info", "No consular slots in target range.");
      return null;
    }

    if (validAscDays.length === 0) {
      this.log("info", "No ASC slots in target range.");
      return null;
    }

    this.log("info", `Consular slots: ${validConsularDays.join(", ")}`);
    this.log("info", `ASC slots: ${validAscDays.join(", ")}`);

    // Find the earliest consular day that has times available
    let consularDate = null;
    let consularTime = null;
    for (const date of validConsularDays) {
      const times = await this.getAvailableTimes(date, this.facilityId);
      if (times.length > 0) {
        consularDate = date;
        consularTime = times[0];
        break;
      }
      this.log("info", `No consular times for ${date}, trying next...`);
    }

    if (!consularDate) {
      this.log("info", "All consular slots in range had no available times.");
      return null;
    }

    // Find the earliest ASC day that has times available (independent of consular date)
    let ascDate = null;
    let ascTime = null;
    for (const date of validAscDays) {
      const times = await this.getAvailableTimes(date, this.ascFacilityId);
      if (times.length > 0) {
        ascDate = date;
        ascTime = times[0];
        break;
      }
      this.log("info", `No ASC times for ${date}, trying next...`);
    }

    if (!ascDate) {
      this.log("info", "All ASC slots in range had no available times.");
      return null;
    }

    this.log("info", `Consular: ${consularDate} at ${consularTime} | ASC: ${ascDate} at ${ascTime}`);

    if (dryRun) {
      this.log("info", `[DRY RUN] Would reschedule consular to ${consularDate} at ${consularTime}, ASC to ${ascDate} at ${ascTime}`);
      return { consularDate, consularTime, ascDate, ascTime, rescheduled: false };
    }

    await this.reschedule({ consularDate, consularTime, ascDate, ascTime });
    return { consularDate, consularTime, ascDate, ascTime, rescheduled: true };
  }
}
