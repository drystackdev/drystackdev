// Watches a Cloudflare Workers Build for one specific commit over WebSocket,
// server side in `src/worker.ts` (BuildStatusHub Durable Object). Cloudflare
// only reports four lifecycle events for a build — `started`, `succeeded`,
// `failed`, `canceled` — there is no native "installing deps" / "building" /
// "deploying" sub-step signal. The install/build/deploy labels shown while a
// build is `started` are therefore simulated against elapsed time, not real
// progress; only the terminal phases are a genuine signal from Cloudflare.

export type BuildPhase = 'started' | 'succeeded' | 'failed' | 'canceled';

export type BuildStatusUpdate =
  | { kind: 'connecting' }
  | { kind: 'phase'; phase: BuildPhase }
  | { kind: 'label'; label: string }
  | { kind: 'disconnected' }
  | { kind: 'timeout' };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 8000;
const OVERALL_TIMEOUT_MS = 5 * 60 * 1000;

// Paced against typical Workers Builds durations. Purely cosmetic — if a real
// build runs faster or slower these just drift out of sync with reality,
// which is an acceptable tradeoff since Cloudflare doesn't expose real
// sub-step timing to key this off instead.
const SIMULATED_STEPS: { atMs: number; label: string }[] = [
  { atMs: 0, label: 'Đang cài đặt dependencies…' },
  { atMs: 15_000, label: 'Đang build…' },
  { atMs: 45_000, label: 'Đang deploy…' },
];

export function watchBuildStatus(
  commitOid: string,
  onUpdate: (update: BuildStatusUpdate) => void
): () => void {
  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let simulateTimers: ReturnType<typeof setTimeout>[] = [];
  let overallTimeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSimulateTimers = () => {
    simulateTimers.forEach(clearTimeout);
    simulateTimers = [];
  };

  const startSimulatedProgress = () => {
    clearSimulateTimers();
    for (const step of SIMULATED_STEPS) {
      simulateTimers.push(
        setTimeout(() => onUpdate({ kind: 'label', label: step.label }), step.atMs)
      );
    }
  };

  const stop = () => {
    closed = true;
    clearSimulateTimers();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (overallTimeoutTimer) clearTimeout(overallTimeoutTimer);
    ws?.close();
  };

  const handlePhase = (phase: BuildPhase) => {
    onUpdate({ kind: 'phase', phase });
    if (phase === 'started') {
      startSimulatedProgress();
      return;
    }
    stop();
  };

  const connect = () => {
    if (closed) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${location.host}/__drystack/ws/build-status/${encodeURIComponent(commitOid)}`
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
