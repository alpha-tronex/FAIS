/**
 * Copies the built Angular client into server/dist/public so the server can serve it in production.
 * Run from repo root after: npm run server:build && npm run client:build
 *
 * Angular @angular/build:application default output: client/dist/client/browser
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const clientOutput = path.join(root, 'client', 'dist', 'client', 'browser');
const serverPublic = path.join(root, 'server', 'dist', 'public');

if (!fs.existsSync(clientOutput)) {
  console.error('copy-client: Angular build output not found at:', clientOutput);
  console.error('Run "npm run client:build" first.');
  process.exit(1);
}

fs.mkdirSync(serverPublic, { recursive: true });
fs.cpSync(clientOutput, serverPublic, { recursive: true, force: true });
console.log('copy-client: Copied client build to server/dist/public');
