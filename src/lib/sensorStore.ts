import { SensorReading } from "@/types/sensor";

// Global cache to persist across hot reloads and serverless instance reuse
const globalForSensor = globalThis as unknown as {
  hydroWarnSensorStore?: {
    latest: SensorReading | null;
    history: SensorReading[];
    lastAlarmTime: number;
    lastRelayState: boolean;
  };
};

const store = globalForSensor.hydroWarnSensorStore || {
  latest: null,
  history: [],
  lastAlarmTime: 0,
  lastRelayState: false,
};

if (process.env.NODE_ENV !== "production") {
  globalForSensor.hydroWarnSensorStore = store;
}

const MAX_HISTORY = 30;
const ALARM_COOLDOWN_MS = 30000; // 30 seconds cooldown between repeat push notifications if relay stays on

export function recordSensorReading(reading: {
  suhu: number;
  humidity: number;
  relay: boolean;
}): {
  current: SensorReading;
  shouldNotify: boolean;
  reason?: string;
} {
  const current: SensorReading = {
    suhu: Number(reading.suhu),
    humidity: Number(reading.humidity),
    relay: Boolean(reading.relay),
    timestamp: Date.now(),
  };

  const wasRelayActive = store.lastRelayState;
  const isRelayActive = current.relay;
  const now = Date.now();
  const timeSinceLastAlarm = now - store.lastAlarmTime;

  let shouldNotify = false;
  let reason = "";

  if (isRelayActive) {
    if (!wasRelayActive) {
      // Just triggered (transition from OFF to ON) -> notify immediately
      shouldNotify = true;
      reason = "Relay baru saja aktif (Transisi OFF -> ON)";
      store.lastAlarmTime = now;
    } else if (timeSinceLastAlarm > ALARM_COOLDOWN_MS) {
      // Still ON after cooldown window -> re-notify
      shouldNotify = true;
      reason = `Relay masih aktif (Pemberitahuan berkala setelah ${Math.round(ALARM_COOLDOWN_MS / 1000)} detik)`;
      store.lastAlarmTime = now;
    }
  }

  // Update store state
  store.latest = current;
  store.lastRelayState = isRelayActive;
  store.history.unshift(current);
  if (store.history.length > MAX_HISTORY) {
    store.history.pop();
  }

  return { current, shouldNotify, reason };
}

export function getSensorStatus() {
  return {
    latest: store.latest,
    history: store.history,
    isAlarmActive: Boolean(store.latest?.relay),
    lastAlarmAt: store.lastAlarmTime > 0 ? store.lastAlarmTime : null,
  };
}

export function resetAlarmCooldown() {
  store.lastAlarmTime = 0;
}
