import { fetch, ProxyAgent } from "undici";
import dotenv from "dotenv";
import { VisaClient } from "./client.js";

dotenv.config();

const PROXIES = (process.env.PROXIES || "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

if (PROXIES.length < 2) {
  console.error("Need at least 2 proxies in PROXIES env to run this test.");
  process.exit(1);
}

function buildProxyAgent(proxyUrl) {
  const url = new URL(proxyUrl);
  const opts = { uri: `${url.protocol}//${url.host}` };
  if (url.username) {
    const auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    opts.token = `Basic ${Buffer.from(auth).toString("base64")}`;
  }
  return new ProxyAgent(opts);
}

async function egressIp(proxyUrl) {
  const res = await fetch("https://api.ipify.org?format=json", {
    dispatcher: buildProxyAgent(proxyUrl),
  });
  const data = await res.json();
  return data.ip;
}

function shortLabel(proxyUrl) {
  return new URL(proxyUrl).host;
}

async function main() {
  const proxyA = PROXIES[0];
  const proxyB = PROXIES[1];

  console.log("=== Verifying egress IPs ===");
  const ipA = await egressIp(proxyA);
  const ipB = await egressIp(proxyB);
  console.log(`Proxy A (${shortLabel(proxyA)}) → ${ipA}`);
  console.log(`Proxy B (${shortLabel(proxyB)}) → ${ipB}`);
  if (ipA === ipB) {
    console.error("Egress IPs match — test inconclusive. Aborting.");
    process.exit(1);
  }

  const client = new VisaClient({
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: 138,
    ascFacilityId: 139,
    proxies: [proxyA],
  });

  console.log("\n=== Step 1: login through Proxy A ===");
  await client.login();
  console.log(`Logged in. Cookie length: ${client.cookie?.length}`);

  console.log("\n=== Step 2: baseline request on Proxy A ===");
  try {
    const days = await client.getAvailableDays(client.facilityId);
    console.log(`OK on Proxy A. Days returned: ${days.length}`);
  } catch (err) {
    console.error(`Baseline failed on Proxy A: ${err.message}`);
    console.error("Cannot proceed — session is bad before swap.");
    process.exit(1);
  }

  console.log("\n=== Step 3: swap to Proxy B (cookie unchanged) ===");
  client.currentProxy = proxyB;
  const ipAfterSwap = await egressIp(proxyB);
  console.log(`Egress now: ${ipAfterSwap} (was ${ipA})`);

  await tryRequest(client, proxyB, "Proxy B");

  if (PROXIES[2]) {
    const proxyC = PROXIES[2];
    console.log(`\n=== Step 5: also try Proxy C (${shortLabel(proxyC)}) ===`);
    const ipC = await egressIp(proxyC);
    console.log(`Egress now: ${ipC}`);
    client.currentProxy = proxyC;
    await tryRequest(client, proxyC, "Proxy C");
  }
}

async function tryRequest(client, proxyUrl, label) {
  console.log(`\n--- Request through ${label} (${shortLabel(proxyUrl)}) with original cookie ---`);
  try {
    const days = await client.getAvailableDays(client.facilityId);
    console.log(`\n>>> ${label}: cookie WORKS. Days returned: ${days.length}`);
    return "ok";
  } catch (err) {
    if (err.message === "SESSION_EXPIRED") {
      console.log(`\n>>> ${label}: cookie REJECTED (401) on new IP — session IS IP-bound.`);
      return "rejected";
    }
    console.log(`\n>>> ${label}: request failed.`);
    console.log(`    message: ${err.message}`);
    if (err.cause) {
      console.log(`    cause.code: ${err.cause.code}`);
      console.log(`    cause.message: ${err.cause.message}`);
      if (err.cause.cause) {
        console.log(`    cause.cause: ${err.cause.cause.code || err.cause.cause.message}`);
      }
    }
    return "error";
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
