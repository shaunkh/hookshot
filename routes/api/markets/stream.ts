import { define } from "@/utils.ts";
import { subscribePrices } from "@/lib/ostium/priceHub.ts";

/** SSE stream of live price updates (coalesced to ~1/s by the price hub). */
export const handler = define.handlers({
  GET(ctx) {
    if (!ctx.state.user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const enc = new TextEncoder();
    let unsubscribe = () => {};
    let ping: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller closed
          }
        };
        try {
          unsubscribe = await subscribePrices((points) => send({ type: "prices", points }));
        } catch {
          // hub couldn't start (RPC/WS down) - tell the client to fall back to REST
          send({ type: "error" });
        }
        ping = setInterval(() => {
          try {
            controller.enqueue(enc.encode(": ping\n\n"));
          } catch {
            // ignore
          }
        }, 25_000);
      },
      cancel() {
        unsubscribe();
        if (ping !== undefined) clearInterval(ping);
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      },
    });
  },
});
