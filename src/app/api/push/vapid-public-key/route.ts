import { NextResponse } from "next/server";
import { getVapidPublicKey } from "@/lib/webpush";

export async function GET() {
  const publicKey = getVapidPublicKey();
  return NextResponse.json({
    publicKey,
  });
}
