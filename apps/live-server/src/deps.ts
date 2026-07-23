import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config";
import type { LiveFanout } from "./fanout";
import type { LiveStore } from "./live-store";

/** Shared dependencies handed to each route registrar. */
export interface Deps {
  store: LiveStore;
  config: Config;
  auth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  fanout: LiveFanout;
}
