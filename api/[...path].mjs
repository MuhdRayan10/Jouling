import { createJoulingRequestHandler } from "../server/app.mjs";

// Reuse the store while this function instance is warm. Vercel may replace an
// instance at any time, so production multiplayer state should use a database.
const handler = createJoulingRequestHandler();

export default handler;

