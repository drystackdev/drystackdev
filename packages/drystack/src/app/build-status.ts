// Watches Cloudflare's current build status over WebSocket, served by the
// single global BuildStatusHub Durable Object in `@drystack/astro/worker`.
// Cloudflare only reports four lifecycle events for a build — `started`,
// `succeeded`, `failed`, `canceled` — there is no native "installing deps" /
// "building" / "deploying" sub-step signal, so callers just show one accurate
// "building" state between `started` and the terminal phase rather than
// fabricating sub-step timing (real builds run ~20-25s end to end, too fast and
// too variable for a fake staged countdown to track).
//
// This is a single always-on connection, not "watch this one build and stop":
// there's no specific commit to wait for and no terminal condition that ends
// the watch — it just keeps reflecting whatever Cloudflare is doing, for as
// long as something is mounted and listening (see useLatestBuildStatus).

import { useEffect, useState } from 'react';
import { WS_PATH, type BuildEvent, type BuildPhase } from './build-status-protocol';

export type { BuildEvent, BuildPhase } from './build-status-protocol';

export type BuildStatusUpdate =
  | { kind: 'connecting' }
  | { kind: 'open' }
  | { kind: 'event'; event: BuildEvent }
  | { kind: 'disconnected' };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 8000;

export function watchBuildStatus(
  onUpdate: (update: BuildStatusUpdate) => void
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };

  const connect = () => {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}${WS_PATH}`);
    ws = socket;
    onUpdate({ kind: 'connecting' });
    socket.onopen = () => {
      reconnectAttempt = 0;
      onUpdate({ kind: 'open' });
    };
    socket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data?.phase) onUpdate({ kind: 'event', event: data as BuildEvent });
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
  return stop;
}

export type LatestBuildStatus = {
  event: BuildEvent | null;
  connection: 'connecting' | 'open' | 'disconnected';
};

// Drives the standalone Cloudflare status indicator (admin sidebar and VEI
// toolbar) — mount once near the top of the tree and it stays live for as
// long as the component is mounted, independent of whether/when a Deploy
// button was pressed.
export function useLatestBuildStatus(): LatestBuildStatus {
  const [state, setState] = useState<LatestBuildStatus>({
    event: null,
    connection: 'connecting',
  });

  useEffect(() => {
    return watchBuildStatus(update => {
      if (update.kind === 'event') {
        setState(s => ({ ...s, event: update.event, connection: 'open' }));
      } else if (update.kind === 'open') {
        setState(s => ({ ...s, connection: 'open' }));
      } else if (update.kind === 'connecting') {
        setState(s => ({ ...s, connection: 'connecting' }));
      } else {
        setState(s => ({ ...s, connection: 'disconnected' }));
      }
    });
  }, []);

  return state;
}
