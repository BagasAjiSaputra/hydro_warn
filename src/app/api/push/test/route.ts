import { NextRequest, NextResponse } from "next/server";
import { sendPushToAll } from "@/lib/webpush";
import { countSubscriptions } from "@/lib/pushStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const count = countSubscriptions();

    if (count === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "Belum ada perangkat yang berlangganan PWA push notification. Silakan klik tombol 'Aktifkan Notifikasi' di web terlebih dahulu.",
          subscribersCount: 0,
        },
        { status: 400 }
      );
    }

    const testTitle = body.title || "🚨 UJI COBA ALARM KEBAKARAN 🚨";
    const testBody =
      body.body ||
      "Ini adalah uji coba notifikasi push PWA HydroWarn. Jika Anda melihat ini, sistem notifikasi darurat berfungsi dengan baik!";

    const result = await sendPushToAll({
      title: testTitle,
      body: testBody,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: "test-fire-alarm-" + Date.now(),
      vibrate: [300, 100, 300, 100, 300],
      requireInteraction: true,
      data: {
        url: "/",
        type: "test",
        timestamp: Date.now(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Notifikasi uji coba dikirim ke ${result.sentCount} perangkat.`,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Gagal mengirim notifikasi uji coba",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
