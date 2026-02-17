import fs from 'node:fs';
import path from 'node:path';

const envExamplePath = path.join(process.cwd(), 'server', '.env.example');
const envPath = path.join(process.cwd(), 'server', '.env');

if (!fs.existsSync(envExamplePath)) {
  console.error('setup:dev: Missing server/.env.example');
  process.exit(2);
}

if (fs.existsSync(envPath)) {
  console.log('setup:dev: server/.env already exists');
  process.exit(0);
}

fs.copyFileSync(envExamplePath, envPath);
console.log('setup:dev: Created server/.env from server/.env.example');
