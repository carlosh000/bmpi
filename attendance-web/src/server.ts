import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');
const apiBaseUrl = process.env['BMPI_API_BASE_URL'] || 'http://127.0.0.1:8080';

const app = express();
const angularApp = new AngularNodeAppEngine();

app.use('/api', async (req, res) => {
  const targetUrl = new URL(req.originalUrl, apiBaseUrl);
  const headers = new Headers();

  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) {
      return;
    }
    if (key === 'host' || key === 'connection' || key === 'content-length') {
      return;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(','));
      return;
    }
    headers.set(key, value);
  });

  try {
    const body = req.method === 'GET' || req.method === 'HEAD'
      ? undefined
      : await new Promise<Blob>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          req.on('end', () => resolve(new Blob(chunks.map((chunk) => Uint8Array.from(chunk)))));
          req.on('error', reject);
        });

    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (key === 'transfer-encoding' || key === 'content-encoding') {
        return;
      }
      res.setHeader(key, value);
    });

    const payload = Buffer.from(await response.arrayBuffer());
    res.send(payload);
  } catch {
    res.status(502).json({ error: 'api_upstream_unreachable' });
  }
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
