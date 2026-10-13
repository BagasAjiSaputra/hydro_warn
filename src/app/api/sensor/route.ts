import { NextRequest, NextResponse } from "next/server";
import { recordSensorReading, getSensorStatus } from "@/lib/sensorStore";
import { sendFireAlarmNotification } from "@/lib/webpush";
import { countSubscriptions } from "@/lib/pushStore";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.suhu === undefined || body.humidity === undefined || body.relay === undefined) {
      return NextResponse.json(
        {
          error: "Invalid payload format. Required keys: suhu, humidity, relay",
          received: body,
        },
        { status: 400 }
      );
    }

    const suhu = typeof body.suhu === "number" ? body.suhu : parseFloat(body.suhu);
    const humidity = typeof body.humidity === "number" ? body.humidity : parseFloat(body.humidity);
    const relay =
      typeof body.relay === "boolean"
        ? body.relay
        : body.relay === "true" || body.relay === 1 || body.relay === "1";

    if (isNaN(suhu) || isNaN(humidity)) {
      return NextResponse.json(
        {
          error: "Invalid numeric values for suhu or humidity",
        },
        { status: 400 }
      );
    }

    // Record reading and evaluate alarm condition
    const { current, shouldNotify, reason } = recordSensorReading({
      suhu,
      humidity,
      relay,
    });

    let pushResult = null;
    if (shouldNotify) {
      console.log(`[ALARM TRIGGERED] ${reason}. Sending Web Push to subscribers...`);
      pushResult = await sendFireAlarmNotification(current);
    }

    return NextResponse.json({
      success: true,
      message: "Data sensor berhasil diterima",
      data: current,
      alarm: {
        active: current.relay,
        notified: shouldNotify,
        reason: reason || null,
        pushResult,
      },
      subscribersCount: countSubscriptions(),
    });
  } catch (error) {
    console.error("Error processing sensor data:", error);
    return NextResponse.json(
      {
        error: "Gagal memproses data sensor",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const status = getSensorStatus();
  return NextResponse.json({
    status: "ok",
    ...status,
    subscribersCount: countSubscriptions(),
    serverTime: new Date().toISOString(),
  });
}
