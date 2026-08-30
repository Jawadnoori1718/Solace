/**
 * Solace — what the roofs are exporting right now.
 *
 * Beat two. Polled by the interface every few seconds so the figure moves as
 * the half-hour turns over.
 *
 * The reading is the real seeded value for the actual current half-hour. At
 * four in the afternoon it shows a genuine afternoon figure; at ten at night it
 * shows zero and the interface says why. Looping the day to guarantee daylight
 * would be the easiest thing here and would quietly make every other honesty
 * claim on this page worthless.
 */

import { getLiveExport } from "@/lib/dashboard/queries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const live = await getLiveExport();

    if (live === null) {
      return new Response(
        JSON.stringify({ ok: false, error: "There is no meter data yet." }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ ok: true, ...live }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
