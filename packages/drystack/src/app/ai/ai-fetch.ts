import { Config } from "../../config";
import { isDemoConfig } from "../storage-mode";
import { getDemoAiModel, getDemoAiUrl } from "./demo-ai-env";

// Shared by useMagicWrite.ts and useRewriteSelection.ts - the only two AI
// routes demo mode actually calls. status/models/models-verify have no demo
// counterpart at all: status is synthesized client-side (useAiStatus.tsx) and
// the model picker never shows in demo mode (useAiModels.tsx never fetches),
// so there's nothing else for this to redirect.
//
// In demo mode there's no `/api/<base>/ai/*` to call - the build is fully
// static (see app/demo-source.ts) - so generate/rewrite go to the site
// owner's own proxy instead, at `DRYSTACK_AI_URL` (see demo-ai-env.ts and
// ai-proxy/src/worker.ts for what that server is expected to do). Callers
// that need to know whether this is even available should check
// `getDemoAiUrl()`/useAiStatus first - this always returns a route, even an
// unusable `undefined/${route}` one, once already committed to sending.
export function aiRouteUrl(
  config: Config,
  basePath: string,
  route: "generate" | "rewrite",
): string {
  if (isDemoConfig(config)) {
    return `${(getDemoAiUrl() ?? "").replace(/\/+$/, "")}/${route}`;
  }
  return `/api${basePath}/ai/${route}`;
}

// The picker-selected model is always undefined in demo mode (the picker
// never shows there - see useAiModels.tsx), so this is what actually decides
// what's sent: `DRY_AI_MODEL`, shared with the real ai route rather than a
// demo-only duplicate - the proxy expects the client to name a model.
export function aiRouteModel(
  config: Config,
  pickedModel: string | undefined,
): string | undefined {
  if (isDemoConfig(config)) return getDemoAiModel();
  return pickedModel;
}
