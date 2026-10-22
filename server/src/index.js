import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../../client/dist');
const port = Number(process.env.PORT) || 3001;

// Serves client/dist when it exists (after `npm run build`). In dev, Vite serves the client.
const server = createGameServer({ staticDir });

server.listen(port).then((p) => {
  console.log(`Lane server listening on http://localhost:${p}`);
});

const shutdown = () => {
  server.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
