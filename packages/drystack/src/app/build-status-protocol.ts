// The wire contract between the build-status client (`build-status.ts`, runs in
// the browser) and the Durable Object hub that serves it (`@drystack/astro/worker`).
// Both sides import from here so the paths and the event shape can't drift apart.
//
// One global hub for the whole site, not one per commit/branch. Per-(branch,
// commit) hubs required the client to know in advance exactly which build it
// was about to watch and to connect inside that build's short lifecycle window
// - fragile, and it still doesn't answer what people actually want to see:
// "what is Cloudflare doing right now". A single always-on hub sidesteps the
// whole class of "wrong/late hub" bugs by not having a key to get wrong.

// A build's lifecycle as Cloudflare Workers Builds reports it. There is no
// install/build/deploy sub-step event - only these four - so clients show a
// single "building" state between `started` and the terminal phase instead of
// fabricating sub-step progress.
export type BuildPhase = "started" | "succeeded" | "failed" | "canceled";

export type BuildEvent = {
  phase: BuildPhase;
  commit: string;
  branch: string;
  receivedAt: number;
};

// Client-facing: the one WebSocket every browser opens to watch build status.
export const WS_PATH = "/__drystack/ws/build-status";

// Worker-internal: how the queue consumer hands an event to the hub. Never
// reached from outside the worker - the DO is not routable from the internet.
export const PUBLISH_PATH = "/__drystack/internal/build-status";

// The fixed name every caller resolves the hub through (`idFromName`) - a
// named singleton, not one instance per commit/branch.
export const HUB_NAME = "build-status";
