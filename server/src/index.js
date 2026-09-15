import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { env } from './config/env.js';
import { checkConnection } from './config/wpClient.js';
import { mediaRouter } from './routes/media.js';
import { statusRouter } from './routes/status.js';
import { errorHandler } from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, '../../client/dist');

const app = express();

app.use('/api', mediaRouter);
app.use('/api', statusRouter);

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use(errorHandler);

await checkConnection();

app.listen(env.port, () => {
  console.log(`Server listening on http://localhost:${env.port}`);
});
