// The Cloudflare Worker entrypoint for a drystack site: the Astro request
// handler plus the build-status hub that powers the deploy progress UI.
//
// This lives in the package (not in the consuming app) because it is one half
// of a contract whose other half — `watchBuildStatus` in
// `@drystack/core/build-status` — already ships here. An app uses it as its
// worker entry directly, no source file of its own:
//
//   // wrangler.jsonc
//   "main": "@drystack/astro/worker",
//   "durable_objects": {
//     "bindings": [{ "name": "BUILD_STATUS_HUB", "class_name": "BuildStatusHub" }]
//   },
//   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BuildStatusHub"] }],
//   "queues": { "consumers": [{ "queue": "<your-build-events-queue>" }] }
//
// The Astro Cloudflare adapter resolves `main` and bundles it into
// dist/server/entry.mjs, from which Cloudflare picks up the Durable Object
// class. An app that needs its own routes on top swaps `main` back to a local
// file and re-exports {@link createDrystackWorker} with handlers of its own.

import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';
import {
  PUBLISH_PATH_PREFIX,
  WS_PATH_PREFIX,
  type BuildEvent,
  type BuildPhase,
} from '@drystack/core/build-status-protocol';

export type { BuildEvent, BuildPhase };

// The bindings drystack's worker needs. An app's generated `Env` (from
// `wrangler types`) structurally satisfies this, so it can pass its own richer
// Env through without us depending on the app's generated globals.
export type DrystackWorkerEnv = {
  BUILD_STATUS_HUB: DurableObjectNamespace;
};

// How long a terminal event (succeeded/failed/canceled) is kept so a client
// that connects slightly late still sees the outcome, before the hub tears
// itself down.
const RETENTION_MS = 10 * 60 * 1000;

// One instance per commit sha (see idFromName below) — every socket accepted
// by a given instance is watching the same build, so broadcast == "everyone
// connected here".
//
// The class name is load-bearing: it is referenced by `class_name` in the app's
// `durable_objects` binding and by the `new_sqlite_classes` migration. Renaming
// it requires a `renamed_classes` migration, so don't.
export class BuildStatusHub extends DurableObject<DrystackWorkerEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith(PUBLISH_PATH_PREFIX)) {
      const event = (await request.json()) as BuildEvent;
      await this.ctx.storage.put('latest', event);
      const message = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        ws.send(message);
      }
      if (event.phase !== 'started') {
        await this.ctx.storage.setAlarm(Date.now() + RETENTION_MS);
      }
      return new Response(null, { status: 204 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 400 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const latest = await this.ctx.storage.get<BuildEvent>('latest');
    if (latest) server.send(JSON.stringify(latest));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(): Promise<void> {
    // Server push only — the client has nothing meaningful to say.
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string
  ): Promise<void> {
    ws.close(code, reason);
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1000, 'build status retention expired');
    }
    await this.ctx.storage.deleteAll();
  }
}

function commitFromQueueEvent(body: any): string | undefined {
  return body?.payload?.buildTriggerMetadata?.commitHash;
}

function branchFromQueueEvent(body: any): string | undefined {
  return body?.payload?.buildTriggerMetadata?.branch;
}

function phaseFromEventType(type: string | undefined): BuildPhase | undefined {
  if (!type) return undefined;
  if (type.endsWith('build.started')) return 'started';
  if (type.endsWith('build.succeeded')) return 'succeeded';
  if (type.endsWith('build.failed')) return 'failed';
  if (type.endsWith('build.canceled')) return 'canceled';
  return undefined;
}

function hubFor(env: DrystackWorkerEnv, commit: string) {
  return env.BUILD_STATUS_HUB.get(env.BUILD_STATUS_HUB.idFromName(commit));
}

/**
 * Serves the build-status WebSocket; returns undefined for anything else, so a
 * caller can fall through to its own routes. Exposed for apps that hand-roll
 * their `fetch` instead of using {@link createDrystackWorker}.
 */
export function handleBuildStatusRequest(
  request: Request,
  env: DrystackWorkerEnv
): Promise<Response> | undefined {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(WS_PATH_PREFIX)) return undefined;
  const commit = url.pathname.slice(WS_PATH_PREFIX.length);
  if (!commit) return Promise.resolve(new Response('Missing commit', { status: 400 }));
  return hubFor(env, commit).fetch(request);
}

/**
 * Consumes one batch of Cloudflare Workers Builds events off the queue and
 * fans each one out to the hub for its commit. Exposed for the same reason as
 * {@link handleBuildStatusRequest}.
 */
export async function handleBuildEventBatch(
  batch: MessageBatch<unknown>,
  env: DrystackWorkerEnv
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body as any;
    const phase = phaseFromEventType(body?.type);
    const commit = commitFromQueueEvent(body);
    if (!phase || !commit) {
      console.warn('drystack: unrecognised build event, skipping', body?.type);
      message.ack();
      continue;
    }
    const event: BuildEvent = {
      phase,
      commit,
      branch: branchFromQueueEvent(body),
      receivedAt: Date.now(),
    };
    await hubFor(env, commit).fetch(
      `https://build-status-hub${PUBLISH_PATH_PREFIX}${commit}`,
      { method: 'POST', body: JSON.stringify(event) }
    );
    message.ack();
  }
}

type CreateWorkerOptions<TEnv extends DrystackWorkerEnv> = {
  /**
   * Runs before drystack's own routing. Return a Response to take the request;
   * return undefined to let drystack (and then Astro) handle it.
   */
  fetch?: (
    request: Request,
    env: TEnv,
    ctx: ExecutionContext
  ) => Response | undefined | Promise<Response | undefined>;
  /** Runs before drystack's build-event consumer, on every batch. */
  queue?: (
    batch: MessageBatch<unknown>,
    env: TEnv,
    ctx: ExecutionContext
  ) => void | Promise<void>;
};

// The Cloudflare adapter types `handle` against the app's generated global
// `Env`, which drystack can't name (it doesn't exist until `wrangler types`
// runs in the app). We only ever require the bindings in DrystackWorkerEnv, so
// widen at this one boundary rather than dragging the app's globals in here.
type AstroHandlerEnv = Parameters<typeof handle>[1];

/**
 * Builds the worker's default export: drystack's build-status routes, then the
 * Astro handler for everything else. Pass `options` to layer app-specific
 * handling on top without having to re-implement any of this.
 */
export function createDrystackWorker<
  TEnv extends DrystackWorkerEnv = DrystackWorkerEnv,
>(options: CreateWorkerOptions<TEnv> = {}): ExportedHandler<TEnv> {
  return {
    async fetch(request, env, ctx) {
      const fromApp = await options.fetch?.(request, env, ctx);
      if (fromApp) return fromApp;
      const buildStatus = handleBuildStatusRequest(request, env);
      if (buildStatus) return buildStatus;
      return handle(request, env as unknown as AstroHandlerEnv, ctx);
    },

    async queue(batch, env, ctx) {
      await options.queue?.(batch, env, ctx);
      await handleBuildEventBatch(batch, env);
    },
  };
}

export default createDrystackWorker();
