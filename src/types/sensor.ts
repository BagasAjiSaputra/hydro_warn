export interface SensorReading {
  suhu: number;
  humidity: number;
  relay: boolean;
  timestamp: number;
}

export interface SensorStatus {
  latest: SensorReading | null;
  history: SensorReading[];
  isAlarmActive: boolean;
  lastAlarmAt: number | null;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}
