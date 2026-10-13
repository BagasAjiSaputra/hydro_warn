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

  const isRelayActive = current.relay;
  // Deteksi kondisi bahaya: jika relay aktif ATAU suhu >= 33°C ATAU kelembaban >= 30%
  const isDanger = isRelayActive || current.suhu >= 33.0 || current.humidity >= 30.0;
  const now = Date.now();

  let shouldNotify = false;
  let reason = "";

  // SELAMA MASIH BAHAYA: Kirim spam push notif di setiap paket data yang masuk!
  if (isDanger) {
    shouldNotify = true;
    reason = `BAHAYA MASIH BERLANGSUNG (Suhu: ${current.suhu.toFixed(1)}°C, Kelembaban: ${current.humidity.toFixed(1)}%, Relay: ${isRelayActive ? "ON" : "OFF"}) -> Spam Notifikasi Push`;
    store.lastAlarmTime = now;
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
    isAlarmActive: Boolean(
      store.latest?.relay ||
      (store.latest?.suhu !== undefined && store.latest.suhu >= 33.0) ||
      (store.latest?.humidity !== undefined && store.latest.humidity >= 30.0)
    ),
    lastAlarmAt: store.lastAlarmTime > 0 ? store.lastAlarmTime : null,
  };
}

export function resetAlarmCooldown() {
  store.lastAlarmTime = 0;
}
