"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { SensorReading } from "@/types/sensor";
import { urlBase64ToUint8Array } from "@/lib/urlBase64ToUint8Array";

interface SensorApiResponse {
  status: string;
  latest: SensorReading | null;
  history: SensorReading[];
  isAlarmActive: boolean;
  lastAlarmAt: number | null;
  subscribersCount: number;
}

export default function Home() {
  // Sensor live state
  const [sensorData, setSensorData] = useState<SensorApiResponse | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);

  // Push notification state
  const [isSupported, setIsSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [testingPush, setTestingPush] = useState(false);

  // Audio siren state
  const [sirenMuted, setSirenMuted] = useState(true);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sirenIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Simulation test state
  const [simSuhu, setSimSuhu] = useState<number>(34.5);
  const [simHumidity, setSimHumidity] = useState<number>(32.0);
  const [simRelay, setSimRelay] = useState<boolean>(true);
  const [simLoading, setSimLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"monitor" | "simulator" | "esp32">("monitor");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  // Show temporary toast feedback
  const showToast = (type: "success" | "error" | "info", msg: string) => {
    setFeedback({ type, msg });
    setTimeout(() => setFeedback(null), 5000);
  };

  // Fetch live sensor data
  const fetchSensorStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/sensor", { cache: "no-store" });
      if (res.ok) {
        const data: SensorApiResponse = await res.json();
        setSensorData(data);
        setLastFetchTime(new Date());
      }
    } catch (err) {
      console.error("Failed to fetch sensor data:", err);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  // Poll sensor data every 3 seconds
  useEffect(() => {
    fetchSensorStatus();
    const interval = setInterval(fetchSensorStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchSensorStatus]);

  // Check Service Worker and Notification status
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      setPermission(Notification.permission);

      // Register SW and check active subscription
      navigator.serviceWorker
        .register("/sw.js")
        .then(async (reg) => {
          const sub = await reg.pushManager.getSubscription();
          setIsSubscribed(!!sub);
        })
        .catch((err) => {
          console.error("Service worker registration error:", err);
        });
    }
  }, []);

  // Handle siren audio synthesize
  useEffect(() => {
    const isAlarm = sensorData?.isAlarmActive;

    if (isAlarm && !sirenMuted) {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioCtx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") {
          ctx.resume();
        }

        if (!oscRef.current) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = "sawtooth";
          gain.gain.setValueAtTime(0.15, ctx.currentTime);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();

          oscRef.current = osc;
          gainRef.current = gain;

          let high = false;
          sirenIntervalRef.current = setInterval(() => {
            if (oscRef.current && audioCtxRef.current) {
              const targetFreq = high ? 1050 : 680;
              oscRef.current.frequency.exponentialRampToValueAtTime(
                targetFreq,
                audioCtxRef.current.currentTime + 0.35
              );
              high = !high;
            }
          }, 400);
        }
      } catch (e) {
        console.warn("Audio Context playback error:", e);
      }
    } else {
      // Stop oscillator if alarm is off or muted
      if (sirenIntervalRef.current) {
        clearInterval(sirenIntervalRef.current);
        sirenIntervalRef.current = null;
      }
      if (oscRef.current) {
        try {
          oscRef.current.stop();
          oscRef.current.disconnect();
        } catch {}
        oscRef.current = null;
      }
    }

    return () => {
      if (sirenIntervalRef.current) {
        clearInterval(sirenIntervalRef.current);
      }
    };
  }, [sensorData?.isAlarmActive, sirenMuted]);

  // Otomatis matikan sirene web setelah 5 detik berbunyi
  useEffect(() => {
    if (sensorData?.isAlarmActive && !sirenMuted) {
      const timer = setTimeout(() => {
        setSirenMuted(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [sensorData?.isAlarmActive, sirenMuted]);

  // Push Subscription toggle handler
  const handleToggleSubscription = async () => {
    if (!isSupported) {
      showToast("error", "Browser Anda tidak mendukung Web Push Notification.");
      return;
    }

    setSubscribing(true);
    try {
      const registration = await navigator.serviceWorker.ready;

      if (isSubscribed) {
        // Unsubscribe
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await fetch("/api/push/subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
        }
        setIsSubscribed(false);
        showToast("info", "Notifikasi push PWA berhasil dinonaktifkan.");
      } else {
        // Request browser permission
        const perm = await Notification.requestPermission();
        setPermission(perm);
        if (perm !== "granted") {
          showToast("error", "Izin notifikasi ditolak oleh browser.");
          setSubscribing(false);
          return;
        }

        // Get VAPID public key
        const keyRes = await fetch("/api/push/vapid-public-key");
        const { publicKey } = await keyRes.json();

        // Subscribe to PushManager
        const newSub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });

        // Register to server
        const saveRes = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub),
        });

        if (!saveRes.ok) {
          throw new Error("Gagal menyimpan subscription ke server");
        }

        setIsSubscribed(true);
        showToast("success", "PWA Push Notification Aktif! Perangkat akan menerima alarm kebakaran.");
        fetchSensorStatus();
      }
    } catch (err) {
      console.error(err);
      showToast("error", "Gagal memproses langganan notifikasi: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubscribing(false);
    }
  };

  // Trigger test notification
  const handleTestPush = async () => {
    setTestingPush(true);
    try {
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "🚨 UJI ALARM KEBAKARAN HYDROWARN",
          body: "Tes notifikasi darurat berhasil diterima pada perangkat Anda!",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast("success", data.message || "Uji notifikasi berhasil dikirim!");
      } else {
        showToast("error", data.message || data.error || "Gagal mengirim uji coba.");
      }
    } catch (err) {
      showToast("error", "Koneksi gagal saat mengirim uji notifikasi.");
    } finally {
      setTestingPush(false);
    }
  };

  // Send simulated data to endpoint
  const handleSendSimulation = async () => {
    setSimLoading(true);
    try {
      const res = await fetch("/api/sensor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suhu: Number(simSuhu),
          humidity: Number(simHumidity),
          relay: simRelay,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          "success",
          `Data berhasil diproses! Alarm: ${data.alarm?.active ? "AKTIF 🔥" : "NORMAL ✅"}`
        );
        fetchSensorStatus();
      } else {
        showToast("error", data.error || "Gagal mengirim data sensor.");
      }
    } catch (err) {
      showToast("error", "Gagal menghubungi endpoint /api/sensor.");
    } finally {
      setSimLoading(false);
    }
  };

  const isAlarm = sensorData?.isAlarmActive;
  const latest = sensorData?.latest;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col selection:bg-red-500 selection:text-white">
      {/* Toast Notification */}
      {feedback && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3 rounded-xl shadow-2xl backdrop-blur-md border text-sm font-medium transition-all duration-300 animate-in fade-in slide-in-from-top-4 ${
            feedback.type === "success"
              ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
              : feedback.type === "error"
              ? "bg-red-950/90 border-red-500/50 text-red-200"
              : "bg-blue-950/90 border-blue-500/50 text-blue-200"
          }`}
        >
          <span className="text-lg">
            {feedback.type === "success" ? "✓" : feedback.type === "error" ? "⚠️" : "ℹ️"}
          </span>
          <p>{feedback.msg}</p>
        </div>
      )}

      {/* Top Emergency Status Bar */}
      <header
        className={`w-full border-b transition-colors duration-500 sticky top-0 z-40 backdrop-blur-md ${
          isAlarm
            ? "bg-red-950/80 border-red-600/60 shadow-[0_4px_30px_rgba(239,68,68,0.25)]"
            : "bg-zinc-900/70 border-zinc-800"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3.5 h-3.5 rounded-full ${
                isAlarm
                  ? "bg-red-500 animate-ping shadow-[0_0_12px_#ef4444]"
                  : "bg-emerald-500 shadow-[0_0_8px_#10b981]"
              }`}
            />
            <div className="flex flex-col">
              <span className="font-bold tracking-wider text-base sm:text-lg flex items-center gap-2">
                HYDRO<span className="text-red-500">WARN</span>
                <span className="text-[10px] tracking-normal font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300">
                  ESP32 • PWA
                </span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {/* Siren Mute Toggle */}
            <button
              onClick={() => setSirenMuted(!sirenMuted)}
              title={sirenMuted ? "Aktifkan Sirene Web" : "Bisukan Sirene Web"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                sirenMuted
                  ? "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  : "bg-amber-500/20 border-amber-500/50 text-amber-300 animate-pulse"
              }`}
            >
              <span>{sirenMuted ? "🔇 Sirene Hening" : "🔊 Sirene Aktif"}</span>
            </button>

            {/* PWA Push Notification Button */}
            <button
              onClick={handleToggleSubscription}
              disabled={subscribing || !isSupported}
              className={`flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all shadow-sm ${
                isSubscribed
                  ? "bg-emerald-950/70 border-emerald-500/50 text-emerald-300 hover:bg-emerald-900/60"
                  : "bg-red-600 hover:bg-red-500 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]"
              }`}
            >
              <span className="text-sm">{isSubscribed ? "🔔" : "🔕"}</span>
              <span className="hidden sm:inline">
                {subscribing
                  ? "Memproses..."
                  : isSubscribed
                  ? "Notifikasi Push Aktif"
                  : "Aktifkan Notifikasi PWA"}
              </span>
              <span className="sm:hidden">
                {isSubscribed ? "Push ON" : "Aktifkan Push"}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Dynamic Fire Alarm Alert Banner */}
        {isAlarm ? (
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-950 via-red-900 to-rose-950 border-2 border-red-500 p-6 sm:p-8 shadow-[0_0_40px_rgba(239,68,68,0.4)] animate-pulse">
            <div className="absolute top-0 right-0 -mt-8 -mr-8 w-44 h-44 bg-red-500/20 rounded-full blur-3xl pointer-events-none" />
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-red-600 flex items-center justify-center text-3xl shadow-lg shadow-red-600/50 shrink-0 animate-bounce">
                  🚨
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full bg-red-500 text-white">
                      DARURAT
                    </span>
                    <span className="text-xs text-red-200">
                      Relay Terpicu oleh Sensor ESP32
                    </span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
                    ALARM KEBAKARAN AKTIF!
                  </h1>
                  <p className="text-red-200 text-sm mt-1 max-w-2xl">
                    Kondisi sensor mendeteksi ambang batas bahaya (Suhu ≥ 33°C atau Kelembaban ≥ 30%).
                    Push notification darurat dikirim otomatis ke perangkat PWA terdaftar.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleTestPush}
                  disabled={testingPush}
                  className="px-4 py-2 bg-zinc-900/90 hover:bg-black border border-red-400 text-red-100 rounded-xl text-xs font-semibold transition-all hover:scale-105"
                >
                  {testingPush ? "Mengirim..." : "Kirim Ulang Notifikasi"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-2xl">
                🛡️
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/40 text-emerald-400">
                    SISTEM NORMAL
                  </span>
                  <span className="text-xs text-zinc-400">Standby & Siaga</span>
                </div>
                <h1 className="text-xl font-bold text-zinc-100 mt-1">
                  Semua Indikator dalam Batas Aman
                </h1>
                <p className="text-zinc-400 text-xs">
                  Relay dalam keadaan OFF. Pemantauan aktif tiap 5 detik dari ESP32.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleTestPush}
                disabled={testingPush}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-xs font-semibold transition"
              >
                {testingPush ? "Mengirim Tes..." : "Tes Push Notification"}
              </button>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-800 gap-6">
          <button
            onClick={() => setActiveTab("monitor")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "monitor"
                ? "border-red-500 text-red-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            📊 Monitor Sensor Real-Time
          </button>
          <button
            onClick={() => setActiveTab("simulator")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "simulator"
                ? "border-red-500 text-red-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            🧪 Simulator Payload ESP32
          </button>
          <button
            onClick={() => setActiveTab("esp32")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
              activeTab === "esp32"
                ? "border-red-500 text-red-400"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            📡 Konfigurasi ESP32 & Endpoint
          </button>
        </div>

        {/* TAB 1: Live Sensor Telemetry Monitor */}
        {activeTab === "monitor" && (
          <div className="space-y-6">
            {/* Metric Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Temperature Card */}
              <div
                className={`rounded-2xl p-6 border transition-all duration-300 relative overflow-hidden ${
                  (latest?.suhu ?? 0) >= 33
                    ? "bg-red-950/40 border-red-500/60 shadow-[0_0_25px_rgba(239,68,68,0.2)]"
                    : "bg-zinc-900/60 border-zinc-800"
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                      Sensor Suhu (DHT)
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-300">Suhu Lingkungan</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-xl">
                    🌡️
                  </div>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
                    {latest?.suhu !== undefined ? latest.suhu.toFixed(1) : "--.-"}
                  </span>
                  <span className="text-2xl font-semibold text-zinc-400">°C</span>
                </div>

                {/* Progress bar threshold */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Normal: &lt; 33°C</span>
                    <span className={(latest?.suhu ?? 0) >= 33 ? "text-red-400 font-bold" : ""}>
                      Trigger: ≥ 33.0°C
                    </span>
                  </div>
                  <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        (latest?.suhu ?? 0) >= 33 ? "bg-red-500" : "bg-emerald-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, (((latest?.suhu ?? 25) - 20) / 30) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Humidity Card */}
              <div
                className={`rounded-2xl p-6 border transition-all duration-300 relative overflow-hidden ${
                  (latest?.humidity ?? 0) >= 30
                    ? "bg-amber-950/40 border-amber-500/60 shadow-[0_0_25px_rgba(245,158,11,0.2)]"
                    : "bg-zinc-900/60 border-zinc-800"
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                      Sensor Kelembaban
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-300">Relative Humidity</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-xl">
                    💧
                  </div>
                </div>

                <div className="flex items-baseline gap-2">
                  <span className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
                    {latest?.humidity !== undefined ? latest.humidity.toFixed(1) : "--.-"}
                  </span>
                  <span className="text-2xl font-semibold text-zinc-400">%</span>
                </div>

                {/* Progress bar threshold */}
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-zinc-400">
                    <span>Ambang Batas: 30%</span>
                    <span className={(latest?.humidity ?? 0) >= 30 ? "text-amber-400 font-bold" : ""}>
                      Trigger: ≥ 30.0%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        (latest?.humidity ?? 0) >= 30 ? "bg-amber-500" : "bg-blue-500"
                      }`}
                      style={{
                        width: `${Math.min(100, Math.max(0, latest?.humidity ?? 0))}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Relay & PWA Push Card */}
              <div
                className={`rounded-2xl p-6 border transition-all duration-300 relative overflow-hidden ${
                  latest?.relay
                    ? "bg-red-950/50 border-red-500/80 shadow-[0_0_30px_rgba(239,68,68,0.3)]"
                    : "bg-zinc-900/60 border-zinc-800"
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                      Aktuator & Notifikasi
                    </span>
                    <h3 className="text-sm font-semibold text-zinc-300">Status Relay PIN 18</h3>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-xl">
                    ⚡
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className={`px-4 py-2 rounded-xl font-bold font-mono text-lg tracking-wider border ${
                      latest?.relay
                        ? "bg-red-600 text-white border-red-400 animate-pulse"
                        : "bg-zinc-800 text-zinc-300 border-zinc-700"
                    }`}
                  >
                    {latest?.relay ? "RELAY ON (LOW)" : "RELAY OFF (HIGH)"}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
                  <span>Perangkat Terdaftar:</span>
                  <span className="font-semibold text-zinc-200">
                    {sensorData?.subscribersCount ?? 0} PWA client
                  </span>
                </div>
              </div>
            </div>

            {/* Status footer with telemetry timing */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/40 border border-zinc-800 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  Koneksi Endpoint: Aktif • Refresh otomatis setiap 3 detik
                </span>
              </div>
              <div className="flex items-center gap-4">
                {latest?.timestamp && (
                  <span>
                    Data ESP32 Terakhir:{" "}
                    <strong className="text-zinc-200">
                      {new Date(latest.timestamp).toLocaleTimeString("id-ID")}
                    </strong>
                  </span>
                )}
                {lastFetchTime && (
                  <span>
                    Sinkronisasi UI: {lastFetchTime.toLocaleTimeString("id-ID")}
                  </span>
                )}
              </div>
            </div>

            {/* Telemetry History Table */}
            <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-200">Riwayat Telemetri ESP32</h3>
                  <p className="text-xs text-zinc-400">Daftar paket data HTTP POST terbaru yang masuk ke server</p>
                </div>
                <button
                  onClick={fetchSensorStatus}
                  className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs transition"
                >
                  Segarkan
                </button>
              </div>

              {sensorData?.history && sensorData.history.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-950/60 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-6 font-medium">Waktu</th>
                        <th className="py-3 px-6 font-medium">Suhu (°C)</th>
                        <th className="py-3 px-6 font-medium">Kelembaban (%)</th>
                        <th className="py-3 px-6 font-medium">Relay State</th>
                        <th className="py-3 px-6 font-medium">Status Alarm</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {sensorData.history.map((item, idx) => (
                        <tr
                          key={idx}
                          className={item.relay ? "bg-red-950/20 text-red-200" : "hover:bg-zinc-800/30"}
                        >
                          <td className="py-3 px-6 text-zinc-400">
                            {new Date(item.timestamp).toLocaleTimeString("id-ID")}
                          </td>
                          <td className="py-3 px-6 font-semibold">
                            <span className={item.suhu >= 33 ? "text-red-400 font-bold" : "text-zinc-200"}>
                              {item.suhu.toFixed(1)}°C
                            </span>
                          </td>
                          <td className="py-3 px-6">
                            <span className={item.humidity >= 30 ? "text-amber-400 font-bold" : "text-zinc-200"}>
                              {item.humidity.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-3 px-6">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                item.relay
                                  ? "bg-red-600/80 text-white"
                                  : "bg-zinc-800 text-zinc-300"
                              }`}
                            >
                              {item.relay ? "TRUE (ON)" : "FALSE (OFF)"}
                            </span>
                          </td>
                          <td className="py-3 px-6">
                            {item.relay ? (
                              <span className="text-red-400 font-bold flex items-center gap-1">
                                🚨 ALARM TRIGGERED
                              </span>
                            ) : (
                              <span className="text-emerald-400">Normal</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-500 text-sm">
                  Belum ada riwayat data. Nyalakan ESP32 Anda atau gunakan menu Simulator di atas untuk menguji.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ESP32 Payload Simulator */}
        {activeTab === "simulator" && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>🧪</span> Simulator Payload ESP32
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Uji coba pengiriman JSON ke endpoint <code className="text-red-400">/api/sensor</code> langsung tanpa perlu menunggu alat fisik ESP32.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs font-medium text-zinc-300 mb-1">
                    <span>Suhu: {simSuhu}°C</span>
                    <span className="text-zinc-500">Ambang: 33°C</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="50"
                    step="0.5"
                    value={simSuhu}
                    onChange={(e) => setSimSuhu(parseFloat(e.target.value))}
                    className="w-full accent-red-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-medium text-zinc-300 mb-1">
                    <span>Kelembaban: {simHumidity}%</span>
                    <span className="text-zinc-500">Ambang: 30%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="90"
                    step="0.5"
                    value={simHumidity}
                    onChange={(e) => setSimHumidity(parseFloat(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>

                <div className="pt-2">
                  <label className="text-xs font-medium text-zinc-300 block mb-2">
                    Relay State (Pemicu Alarm):
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSimRelay(true)}
                      className={`py-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
                        simRelay
                          ? "bg-red-600 border-red-500 text-white shadow-lg shadow-red-600/30"
                          : "bg-zinc-800/80 border-zinc-700 text-zinc-400"
                      }`}
                    >
                      <span>🔥</span> RELAY AKTIF (true)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimRelay(false)}
                      className={`py-3 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-2 ${
                        !simRelay
                          ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-600/30"
                          : "bg-zinc-800/80 border-zinc-700 text-zinc-400"
                      }`}
                    >
                      <span>🛡️</span> RELAY MATI (false)
                    </button>
                  </div>
                </div>

                {/* JSON Preview */}
                <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 text-xs font-mono text-zinc-300">
                  <div className="text-zinc-500 mb-1">// Preview Payload yang akan dikirim:</div>
                  <pre>
                    {JSON.stringify(
                      {
                        suhu: simSuhu,
                        humidity: simHumidity,
                        relay: simRelay,
                      },
                      null,
                      2
                    )}
                  </pre>
                </div>

                <button
                  onClick={handleSendSimulation}
                  disabled={simLoading}
                  className="w-full py-3.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-red-600/30 transition-all hover:scale-[1.01] active:scale-[0.99]"
                >
                  {simLoading ? "Mengirim Payload..." : "Kirim Data Uji Coba ke Endpoint"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ESP32 Code & Guide */}
        {activeTab === "esp32" && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="rounded-2xl bg-zinc-900/70 border border-zinc-800 p-6 sm:p-8 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <span>📡</span> Petunjuk Integrasi ESP32 & Endpoint Vercel
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  Pastikan konfigurasi URL pada sketch ESP32 Anda diarahkan ke endpoint yang tepat.
                </p>
              </div>

              {/* Endpoint Highlights */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-[11px] font-mono uppercase text-zinc-500">Method & Endpoint</span>
                  <p className="font-mono text-sm text-emerald-400 font-bold mt-1">
                    POST /api/sensor
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">
                    Atau <code className="text-zinc-300">https://hydrowarn.vercel.app/api/sensor</code>
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
                  <span className="text-[11px] font-mono uppercase text-zinc-500">Header Wajib</span>
                  <p className="font-mono text-sm text-blue-400 font-bold mt-1">
                    Content-Type: application/json
                  </p>
                  <p className="text-xs text-zinc-400 mt-1">Payload JSON sesuai DHT & Relay</p>
                </div>
              </div>

              {/* Arduino Code adjustment */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-200">
                  Perubahan pada baris ESP32 Arduino Anda:
                </span>
                <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800 text-xs font-mono overflow-x-auto text-zinc-300">
                  <span className="text-zinc-500">// Ubah baris ini di sketch ESP32 Anda:</span>
                  <div className="text-red-400 mt-1">
                    - const char* serverUrl = &quot;https://hydrowarn.vercel.app/&quot;;
                  </div>
                  <div className="text-emerald-400 mt-1">
                    + const char* serverUrl = &quot;https://hydrowarn.vercel.app/api/sensor&quot;;
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  *Catatan: Sistem kami juga menyertakan middleware otomatis sehingga jika ESP32 tetap mengirim ke root (&quot;/&quot;), request tetap akan dialihkan ke /api/sensor secara mulus.
                </p>
              </div>

              {/* How Fire Alarm Logic Works */}
              <div className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-700/60 space-y-2 text-xs text-zinc-300">
                <h4 className="font-semibold text-white">Alur Kerja Notifikasi:</h4>
                <ol className="list-decimal list-inside space-y-1.5 text-zinc-400">
                  <li>
                    ESP32 membaca suhu DHT22/DHT11. Jika suhu ≥ 33°C atau kelembaban ≥ 30%, pin relay 18 diaktifkan (LOW) dan <code className="text-zinc-200">relay = true</code>.
                  </li>
                  <li>
                    ESP32 mengirim POST JSON ke <code className="text-zinc-200">/api/sensor</code>.
                  </li>
                  <li>
                    Server Next.js mendeteksi <code className="text-red-400">relay: true</code>.
                  </li>
                  <li>
                    Server secara instan mengirimkan <strong>Web Push Notification VAPID</strong> ke semua browser/HP yang telah mengaktifkan PWA HydroWarn.
                  </li>
                  <li>
                    Perangkat pengguna bergetar dan menampilkan alarm bahaya kebakaran walaupun aplikasi sedang ditutup di latar belakang.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-800/60 py-6 text-center text-xs text-zinc-500">
        HydroWarn © 2026 • Sistem Monitoring ESP32 DHT & Alarm Kebakaran PWA
      </footer>
    </div>
  );
}
