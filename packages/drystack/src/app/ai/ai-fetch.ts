import { Config } from "../../config";
import { isDemoConfig } from "../storage-mode";

// Shared by useMagicWrite.ts and useRewriteSelection.ts - the only two AI
// routes demo mode actually calls. status/models/models-verify have no demo
// counterpart at all: status is synthesized client-side (useAiStatus.tsx) and
// the model picker never shows in demo mode (useAiModels.tsx never fetches),
// so there's nothing else for this to redirect.
//
// In demo mode there's no `/api/<base>/ai/*` to call - the build is fully
// static (see app/demo-source.ts) - so generate/rewrite go to the site
// owner's own proxy instead (storage.ai.url, a separate origin, see
// config.tsx's LocalStorageConfig for what that server is expected to do).
export function aiRouteUrl(
  config: Config,
  basePath: string,
  route: "generate" | "rewrite",
): string {
  if (isDemoConfig(config) && config.storage.ai) {
    return `${config.storage.ai.url.replace(/\/+$/, "")}/${route}`;
  }
  return `/api${basePath}/ai/${route}`;
}

// The picker-selected model is always undefined in demo mode (the picker
// never shows there - see useAiModels.tsx), so this is what actually decides
// what's sent: the config's own `storage.ai.model`, which the site owner set
// specifically because their proxy expects the client to name a model.
export function aiRouteModel(
  config: Config,
  pickedModel: string | undefined,
): string | undefined {
  if (isDemoConfig(config)) return config.storage.ai?.model;
  return pickedModel;
}
