import { createDefine } from "fresh";
import type { UserRow } from "@/lib/types.ts";

/** Request-scoped state shared across middleware/handlers/pages. */
export interface State {
  /** Set by the session middleware when a valid session cookie is present. */
  user?: UserRow;
}

export const define = createDefine<State>();
