import { handle } from '@astrojs/cloudflare/handler';
import { DurableObject } from 'cloudflare:workers';

// A build's lifecycle as Cloudflare Workers Builds reports it. There is no
// install/build/deploy sub-step event — only these four. The client-side
// toast simulates the intermediate labels against elapsed time; only
// `succeeded`/`failed`/`canceled` are real signals.
type BuildPhase = 'started' | 'succeeded' | 'failed' | 'canceled';

type BuildEvent = {
  phase: BuildPhase;
  commit: string;
  branch?: string;
  receivedAt: number;
};

const WS_PATH_PREFIX = '/__drystack/ws/build-status/';
const PUBLISH_PATH_PREFIX = '/__drystack/internal/build-status/';

// How long a terminal event (succeeded/failed/canceled) is kept so a client
// that connects slightly late still sees the outcome, before the hub tears
// itself down.
const RETENTION_MS = 10 * 60 * 1000;

// One instance per commit sha (see idFromName below) — every socket accepted
// by a given instance is watching the same build, so broadcast == "everyone
// connected here".
export class BuildStatusHub extends DurableObject<Env> {
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

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async alarm(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1000, 'build status retention expired');
    }
    await this.ctx.storage.deleteAll();
  }
}

// Cloudflare's documented payload shape wasn't verifiable against a live
// event at write time — these are the field paths the docs describe
// ("trigger metadata: branch, commit, author, commands"). Log and skip
// rather than throw if a real event doesn't match any of them, and adjust
// once you've inspected one real message body.
function commitFromQueueEvent(body: any): string | undefined {
  return (
    body?.payload?.trigger?.commit ??
    body?.payload?.commit ??
    body?.payload?.commitHash
  );
}

function branchFromQueueEvent(body: any): string | undefined {
  return body?.payload?.trigger?.branch ?? body?.payload?.branch;
}

function phaseFromEventType(type: string | undefined): BuildPhase | undefined {
  if (!type) return undefined;
  if (type.endsWith('build.started')) return 'started';
  if (type.endsWith('build.succeeded')) return 'succeeded';
  if (type.endsWith('build.failed')) return 'failed';
  if (type.endsWith('build.canceled')) return 'canceled';
  return undefined;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(WS_PATH_PREFIX)) {
      const commit = url.pathname.slice(WS_PATH_PREFIX.length);
      if (!commit) return new Response('Missing commit', { status: 400 });
      const id = env.BUILD_STATUS_HUB.idFromName(commit);
      return env.BUILD_STATUS_HUB.get(id).fetch(request);
    }
    return handle(request, env, ctx);
  },

  async queue(batch, env) {
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
      const id = env.BUILD_STATUS_HUB.idFromName(commit);
      await env.BUILD_STATUS_HUB.get(id).fetch(
        `https://build-status-hub${PUBLISH_PATH_PREFIX}${commit}`,
        { method: 'POST', body: JSON.stringify(event) }
      );
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;
