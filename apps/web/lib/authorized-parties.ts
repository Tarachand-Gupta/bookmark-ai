/** Origins allowed to hold a session for this app: the web app's own origins
 * plus the extension's pinned CRX id. Used as the API CORS allowlist
 * (middleware) and the token `azp` allowlist (require-user). Native clients
 * (mobile, curl with a minted token) carry no azp and pass — same semantics
 * as the Express server's @clerk/backend verifyToken. */
export const AUTHORIZED_PARTIES = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://bookmark-ai-theta.vercel.app",
  "https://bookmark-ai-wine.vercel.app",
  "https://bookmark-ai-dev.vercel.app",
  "https://bookmark-ai.cloud",
  "https://www.bookmark-ai.cloud",
  "chrome-extension://ffhbgpgebpmofjkehpjcemepbgcmoelp",
];
