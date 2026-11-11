export type FleetSession = { name: string; cookie: string };
export type FleetTransport = {
  join(name: string): Promise<FleetSession>;
  connect(session: FleetSession, disconnected: () => void): Promise<{ close(): void }>;
  save(sessions: FleetSession[]): Promise<void>;
};

export function createDummyFleet(transport: FleetTransport, options: {
  count: number; intervalMs?: number; restored?: FleetSession[];
  wait?: (ms: number) => Promise<void>; retryMs?: number;
}) {
  if (!Number.isInteger(options.count) || options.count < 1 || options.count > 50) throw Error("count must be 1–50");
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const sessions = new Map((options.restored ?? []).map(s => [s.name, s]));
  const connections = new Map<string, { close(): void }>();
  const failed = new Set<string>();
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => { queue = queue.then(task).catch(() => {}); return queue; };
  async function connect(name: string) {
    if (stopped) return;
    try {
      let session = sessions.get(name);
      if (!session) {
        session = await transport.join(name);
        sessions.set(name, session);
        await transport.save([...sessions.values()]);
      }
      const connection = await transport.connect(session, () => {
        connections.delete(name);
        if (!stopped) void enqueue(async () => { await wait(options.retryMs ?? 65000); await connect(name); });
      });
      if (stopped) connection.close();
      else { connections.set(name, connection); failed.delete(name); }
    } catch {
      failed.add(name);
      if (!stopped) void enqueue(async () => { await wait(options.retryMs ?? 65000); await connect(name); });
    }
  }
  return {
    async start() {
      for (let i = 1; i <= options.count && !stopped; i++) {
        await connect(`ダミー参加者${i}`);
        if (i < options.count) await wait(options.intervalMs ?? 7000);
      }
    },
    status: () => ({ requested: options.count, connected: connections.size, failed: failed.size }),
    async stop() { stopped = true; for (const c of connections.values()) c.close(); connections.clear(); },
  };
}
