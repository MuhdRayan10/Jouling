import { createGhostGridServer } from "./app.mjs";

const port = Number(process.env.PORT || 4173);
const server = createGhostGridServer();

server.listen(port, "0.0.0.0", () => {
  const verifierMode = process.env.OPENAI_API_KEY ? "OpenAI vision" : "demo verifier";
  console.log(`GhostGrid is running at http://localhost:${port} (${verifierMode})`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
