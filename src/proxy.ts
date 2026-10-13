import { NextRequest, NextResponse } from "next/server";

export function proxy(req: NextRequest) {
  // If ESP32 sends a POST directly to root "/"
  if (req.method === "POST" && req.nextUrl.pathname === "/") {
    const url = req.nextUrl.clone();
    url.pathname = "/api/sensor";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
