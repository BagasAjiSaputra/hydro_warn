import fs from "fs";
import path from "path";
import type { PushSubscription } from "web-push";

const globalForPush = globalThis as unknown as {
  hydroWarnSubscriptions?: PushSubscription[];
};

// In-memory subscription list
let subscriptions: PushSubscription[] =
  globalForPush.hydroWarnSubscriptions || [];

if (process.env.NODE_ENV !== "production") {
  globalForPush.hydroWarnSubscriptions = subscriptions;
}

// Optional local file fallback for dev persistence
const STORAGE_FILE = path.join(process.cwd(), ".subscriptions.json");

function loadFromFile() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        subscriptions = parsed;
        globalForPush.hydroWarnSubscriptions = subscriptions;
      }
    }
  } catch (err) {
    console.warn("Could not load subscriptions from file:", err);
  }
}

function saveToFile() {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(subscriptions, null, 2));
  } catch {
    // Ignore in read-only environments like Vercel serverless
  }
}

// Initial load
loadFromFile();

export function addSubscription(sub: PushSubscription): boolean {
  if (!sub || !sub.endpoint) return false;

  const existingIndex = subscriptions.findIndex((s) => s.endpoint === sub.endpoint);
  if (existingIndex >= 0) {
    subscriptions[existingIndex] = sub; // Update existing
  } else {
    subscriptions.push(sub);
  }

  saveToFile();
  return true;
}

export function removeSubscription(endpoint: string): boolean {
  const initialLen = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  globalForPush.hydroWarnSubscriptions = subscriptions;
  saveToFile();
  return subscriptions.length < initialLen;
}

export function getAllSubscriptions(): PushSubscription[] {
  return [...subscriptions];
}

export function countSubscriptions(): number {
  return subscriptions.length;
}
