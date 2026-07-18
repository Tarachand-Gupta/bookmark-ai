import Redis from "ioredis";

/**
 * ioredis wiring. A connection in SUBSCRIBE mode cannot issue normal commands,
 * so we keep TWO connections: `command` for reads/writes, and a single dedicated
 * `subscriber` multiplexed across every user's channel. `SubscriptionManager`
 * ref-counts handlers per channel so N SSE streams for one user open zero extra
 * Redis connections — the shared subscriber SUBSCRIBEs a channel on the first
 * listener and UNSUBSCRIBEs on the last.
 */
export interface RedisBundle {
  command: Redis;
  subscriptions: SubscriptionManager;
  close: () => Promise<void>;
}

export type MessageHandler = (payload: string) => void;

export class SubscriptionManager {
  private readonly handlers = new Map<string, Set<MessageHandler>>();

  constructor(private readonly subscriber: Redis) {
    this.subscriber.on("message", (channel: string, message: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(message);
        } catch {
          // a broken stream handler must never take down delivery to the others
        }
      }
    });
  }

  /** Register a handler for a channel; returns an unsubscribe fn (idempotent). */
  subscribe(channel: string, handler: MessageHandler): () => void {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      void this.subscriber.subscribe(channel).catch(() => {
        // transient — the reader still gets its initial snapshot; live updates
        // resume when ioredis auto-reconnects and re-subscribes.
      });
    }
    set.add(handler);

    let done = false;
    return () => {
      if (done) return;
      done = true;
      const current = this.handlers.get(channel);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(channel);
        void this.subscriber.unsubscribe(channel).catch(() => {});
      }
    };
  }
}

export function createRedis(url: string): RedisBundle {
  const command = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  const subscriberConn = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
  const subscriptions = new SubscriptionManager(subscriberConn);

  // ioredis auto-reconnects and (for the subscriber) re-subscribes to its active
  // channels on its own — no manual reconnect logic needed here.
  return {
    command,
    subscriptions,
    close: async () => {
      await Promise.allSettled([command.quit(), subscriberConn.quit()]);
    },
  };
}
