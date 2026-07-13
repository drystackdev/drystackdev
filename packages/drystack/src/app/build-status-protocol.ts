// The wire contract between the build-status client (`build-status.ts`, runs in
// the browser) and the Durable Object hub that serves it (`@drystack/astro/worker`).
// Both sides import from here so the paths and the event shape can't drift apart.

// A build's lifecycle as Cloudflare Workers Builds reports it. There is no
// install/build/deploy sub-step event — only these four — so clients show a
// single "building" state between `started` and the terminal phase instead of
// fabricating sub-step progress.
export type BuildPhase = 'started' | 'succeeded' | 'failed' | 'canceled';

export type BuildEvent = {
  phase: BuildPhase;
  commit: string;
  branch?: string;
  receivedAt: number;
};

// Client-facing: the WebSocket a browser opens to watch one commit's build.
export const WS_PATH_PREFIX = '/__drystack/ws/build-status/';

// Worker-internal: how the queue consumer hands an event to the hub. Never
// reached from outside the worker — the DO is not routable from the internet.
export const PUBLISH_PATH_PREFIX = '/__drystack/internal/build-status/';

export function buildStatusSocketPath(commitOid: string): string {
  return `${WS_PATH_PREFIX}${encodeURIComponent(commitOid)}`;
}
