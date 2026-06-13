import { define } from "@/utils.ts";
import { subscribe } from "@/lib/events/bus.ts";

/** Per-User SSE stream of live signal status transitions. */
export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.json({ error: "unauthorized" }, { status: 401 });
    const enc = new TextEncoder();
    let unsubscribe = () => {};
    let ping: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
      start(controller) {
        const send = (data: unknown) => {
          // Drop events for a stalled client rather than buffering unboundedly.
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller closed
          }
        };
        send({ type: "hello" });
        unsubscribe = subscribe(user.id, send);
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
