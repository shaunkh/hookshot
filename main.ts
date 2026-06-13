import "@std/dotenv/load";
import { App, staticFiles } from "fresh";
import { define, type State } from "./utils.ts";
import { runMigrations } from "@/lib/db/migrations.ts";
import { startWorker } from "@/lib/worker/runner.ts";
import { delegateSafeAddress } from "@/lib/ostium/clients.ts";
import { getUserById } from "@/lib/db/repo.ts";
import { readCookie, verifySession } from "@/lib/auth/session.ts";

// ── Boot: migrate, start the execution worker, log the delegate Safe ──
runMigrations();
startWorker();
delegateSafeAddress()
  .then((safe) => console.log(`[boot] delegate Safe address: ${safe}`))
  .catch((e) =>
    console.error(
      "[boot] could not derive delegate Safe (check DELEGATE_PRIVATE_KEY / RPC):",
      e instanceof Error ? e.message : e,
    )
  );

export const app = new App<State>();

app.use(staticFiles());

// Attach the signed-in User to ctx.state when a valid session cookie is present.
app.use(define.middleware(async (ctx) => {
  const token = readCookie(ctx.req.headers.get("cookie"));
  if (token) {
    const session = await verifySession(token);
    if (session) {
      const user = getUserById(session.userId);
      if (user) ctx.state.user = user;
    }
  }
  return ctx.next();
}));

app.fsRoutes();
