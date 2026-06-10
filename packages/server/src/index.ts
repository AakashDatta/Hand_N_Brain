import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', '..', 'web', 'dist');

const port = Number(process.env.PORT ?? 8080);

startServer({
  port,
  staticDir: existsSync(webDist) ? webDist : undefined,
}).then((server) => {
  console.log(`Hand & Brain server listening on :${server.port} (ws at /ws)`);
  if (existsSync(webDist)) {
    console.log(`Serving web app from ${webDist}`);
  } else {
    console.log('No web build found; running WebSocket-only.');
  }
});
