import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server';
import { JsonFileStore } from './store';

const here = dirname(fileURLToPath(import.meta.url));
const webDist = join(here, '..', '..', 'web', 'dist');

const port = Number(process.env.PORT ?? 8080);

// Persist identities, ratings, and history to a JSON file so they survive
// restarts. Override the path with HNB_DATA_FILE; set it to "" to disable.
const dataFileEnv = process.env.HNB_DATA_FILE;
const dataFile =
  dataFileEnv === '' ? null : resolve(dataFileEnv ?? 'data/hnb.json');

startServer({
  port,
  staticDir: existsSync(webDist) ? webDist : undefined,
  store: dataFile ? new JsonFileStore(dataFile) : undefined,
}).then((server) => {
  console.log(`Hand & Brain server listening on :${server.port} (ws at /ws)`);
  if (existsSync(webDist)) {
    console.log(`Serving web app from ${webDist}`);
  } else {
    console.log('No web build found; running WebSocket-only.');
  }
  console.log(dataFile ? `Persisting to ${dataFile}` : 'Persistence disabled.');
});
