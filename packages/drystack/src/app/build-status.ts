// Watches a Cloudflare Workers Build for one specific commit over WebSocket,
// served by the BuildStatusHub Durable Object in `@drystack/astro/worker`.
// Cloudflare only reports four lifecycle events for a build — `started`,
// `succeeded`, `failed`, `canceled` — there is no native "installing deps" /
// "building" / "deploying" sub-step signal, so callers just show one accurate
// "building" state between `started` and the terminal phase rather than
// fabricating sub-step timing (real builds run ~20-25s end to end, too fast and
// too variable for a fake staged countdown to track).

import { buildStatusSocketPath } from './build-status-protocol';

export type { BuildPhase } from './build-status-protocol';
import type { BuildPhase } from './build-status-protocol';

export type BuildStatusUpdate =
  | { kind: 'connecting' }
  | { kind: 'phase'; phase: BuildPhase }
  | { kind: 'disconnected' }
  | { kind: 'timeout' };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 8000;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

export function watchBuildStatus(
  commitOid: string,
  onUpdate: (update: BuildStatusUpdate) => void
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let overallTimeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (overallTimeoutTimer) clearTimeout(overallTimeoutTimer);
    ws?.close();
  };

  const handlePhase = (phase: BuildPhase) => {
    onUpdate({ kind: 'phase', phase });
    if (phase !== 'started') stop();
  };

  const connect = () => {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${location.host}${buildStatusSocketPath(commitOid)}`
    );
    ws = socket;
    onUpdate({ kind: 'connecting' });
    socket.onopen = () => {
      reconnectAttempt = 0;
    };
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data?.phase) handlePhase(data.phase as BuildPhase);
      } catch {
        // ignore malformed message
      }
    };
    socket.onclose = () => {
      if (closed) return;
      onUpdate({ kind: 'disconnected' });
      reconnectAttempt++;
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** reconnectAttempt,
        RECONNECT_MAX_MS
      );
      reconnectTimer = setTimeout(connect, delay);
    };
    socket.onerror = () => {
      socket.close();
    };
  };

  connect();
  overallTimeoutTimer = setTimeout(() => {
    if (closed) return;
    onUpdate({ kind: 'timeout' });
    stop();
  }, OVERALL_TIMEOUT_MS);

  return stop;
}
