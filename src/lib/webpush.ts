import webPush from "web-push";
import { getAllSubscriptions, removeSubscription } from "./pushStore";
import { PushNotificationPayload, SensorReading } from "@/types/sensor";

// Default fallback VAPID keys if not present in environment variables
const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BGBVNOV_EGjsuyzhp1XH8UzgvN8ewJs-71NnXkIicIeTLm0FDaDoWz44HH4hwtJck6AaBGn9XmbsRennuYjpv78";

const DEFAULT_VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "DIh4mn8Kmn89_eb2vzEoc7Y_nZ3PJmzKMgr1e1pxqjs";

const DEFAULT_VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:admin@hydrowarn.local";

// Configure web-push once
try {
  webPush.setVapidDetails(
    DEFAULT_VAPID_SUBJECT,
    DEFAULT_VAPID_PUBLIC_KEY,
    DEFAULT_VAPID_PRIVATE_KEY
  );
} catch (error) {
  console.error("Error setting VAPID details:", error);
}

export function getVapidPublicKey(): string {
  return DEFAULT_VAPID_PUBLIC_KEY;
}

export async function sendPushToAll(payload: PushNotificationPayload) {
  const subscriptions = getAllSubscriptions();
  if (subscriptions.length === 0) {
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      message: "No active push subscriptions found.",
    };
  }

  const payloadString = JSON.stringify(payload);
  let sentCount = 0;
  let failedCount = 0;

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(sub, payloadString, {
          urgency: "high",
          TTL: 60, // 60 seconds TTL so stale notifications expire quickly
        });
        sentCount++;
      } catch (err: unknown) {
        failedCount++;
        const statusCode = (err as { statusCode?: number })?.statusCode;
        // If subscription is expired or gone (404/410), prune it
        if (statusCode === 404 || statusCode === 410) {
          removeSubscription(sub.endpoint);
        }
        throw err;
      }
    })
  );

  return {
    success: true,
    total: subscriptions.length,
    sentCount,
    failedCount,
    results,
  };
}

export async function sendFireAlarmNotification(reading: SensorReading) {
  const payload: PushNotificationPayload = {
    title: "🚨 ALARM KEBAKARAN AKTIF! 🚨",
    body: `PERINGATAN: Relay aktif! Suhu: ${reading.suhu.toFixed(1)}°C, Kelembaban: ${reading.humidity.toFixed(1)}%. Bahaya kebakaran terdeteksi!`,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    tag: "hydrowarn-fire-alarm",
    vibrate: [500, 200, 500, 200, 500, 200, 500],
    requireInteraction: true,
    data: {
      url: "/",
      suhu: reading.suhu,
      humidity: reading.humidity,
      relay: reading.relay,
      timestamp: reading.timestamp,
    },
  };

  return sendPushToAll(payload);
}
