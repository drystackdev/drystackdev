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
  branch: string;
  receivedAt: number;
};

// Client-facing: the WebSocket a browser opens to watch one (branch, commit)
// build.
export const WS_PATH_PREFIX = '/__drystack/ws/build-status/';

// Worker-internal: how the queue consumer hands an event to the hub. Never
// reached from outside the worker — the DO is not routable from the internet.
export const PUBLISH_PATH_PREFIX = '/__drystack/internal/build-status/';

// Branch is part of the path (not just the event payload) because a commit
// can be live on more than one branch at once — e.g. drystack rotates the
// brand branch to a fresh ref pointing at the same commit it just merged to
// the default branch, so that commit gets its own build on two branches.
// Keying purely by commit would let one branch's lifecycle clobber the
// other's in the hub; see BuildStatusHub.
export function buildStatusSocketPath(branch: string, commitOid: string): string {
  return `${WS_PATH_PREFIX}${encodeURIComponent(branch)}/${encodeURIComponent(commitOid)}`;
}
