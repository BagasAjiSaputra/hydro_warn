import { NextRequest, NextResponse } from "next/server";
import { addSubscription, removeSubscription, countSubscriptions } from "@/lib/pushStore";

export async function POST(req: NextRequest) {
  try {
    const subscription = await req.json();

    if (!subscription || !subscription.endpoint) {
      return NextResponse.json(
        { error: "Invalid subscription object. 'endpoint' is required." },
        { status: 400 }
      );
    }

    const added = addSubscription(subscription);

    return NextResponse.json({
      success: added,
      message: "Subscription successfully registered for PWA fire alerts.",
      subscribersCount: countSubscriptions(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to save push subscription",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const endpoint = body.endpoint;

    if (!endpoint) {
      return NextResponse.json(
        { error: "Endpoint string is required to unsubscribe." },
        { status: 400 }
      );
    }

    const removed = removeSubscription(endpoint);

    return NextResponse.json({
      success: removed,
      message: removed ? "Successfully unsubscribed" : "Subscription not found",
      subscribersCount: countSubscriptions(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to remove subscription",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
