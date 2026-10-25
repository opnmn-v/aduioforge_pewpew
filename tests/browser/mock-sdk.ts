const root = window.top as any;
root.__listeners ??= [];
root.__messages ??= [];
const noop = () => () => undefined;
export default {
  onReady: (callback: () => void) => { queueMicrotask(callback); },
  player: { getRole: async () => "GM", getConnectionId: async () => "test-gm", onChange: noop },
  party: { getPlayers: async () => [], onChange: noop },
  broadcast: {
    onMessage: (channel: string, callback: (event: unknown) => void) => { root.__listeners.push({ channel, callback }); return () => undefined; },
    sendMessage: async (channel: string, data: unknown) => {
      root.__messages.push({ channel, data: structuredClone(data) });
      for (const listener of root.__listeners) if (listener.channel === channel) listener.callback({ data: structuredClone(data), connectionId: "test-gm" });
    },
  },
};
