import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createJoulingServer } from "./app.mjs";

try {
  loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const port = Number(process.env.PORT || 4173);
const server = createJoulingServer();

server.listen(port, "0.0.0.0", () => {
  const verifierMode = process.env.OPENAI_API_KEY ? "OpenAI vision" : "demo verifier";
  console.log(`Jouling is running at http://localhost:${port} (${verifierMode})`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
