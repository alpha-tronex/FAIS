import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function runCapture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const containerName = process.env.MSSQL_CONTAINER_NAME || 'fais-sqlserver';
const dbName = getArg('--db') || 'financialAff';
const mdfHostPath = getArg('--mdf') || path.resolve(repoRoot, '../FAIS/sql scripts/financialAff.mdf');
const ldfHostPath = getArg('--ldf') || path.resolve(repoRoot, '../FAIS/sql scripts/financialAff_log.ldf');
const saPassword = process.env.MSSQL_SA_PASSWORD || 'ChangeMe123!';

if (hasFlag('--help') || hasFlag('-h')) {
  console.log([
    'Usage:',
    '  MSSQL_SA_PASSWORD=... node scripts/attach-legacy-sqlserver.mjs [--db financialAff] [--mdf /path/to/file.mdf] [--ldf /path/to/file.ldf]',
    '',
    'Defaults:',
    '  --mdf ../FAIS/sql scripts/financialAff.mdf',
    '  --ldf ../FAIS/sql scripts/financialAff_log.ldf',
    '  container fais-sqlserver (from docker compose)',
    '',
    'Notes:',
    '  - Requires Docker Desktop and `docker compose up -d sqlserver` first.',
    '  - Copies MDF/LDF into the container data dir and runs CREATE DATABASE ... FOR ATTACH.'
  ].join('\n'));
  process.exit(0);
}

for (const p of [mdfHostPath, ldfHostPath]) {
  if (!fs.existsSync(p)) {
    console.error(`Missing file: ${p}`);
    process.exit(2);
  }
}

// Quick check container exists/running.
try {
  const status = runCapture('docker', ['inspect', '-f', '{{.State.Status}}', containerName]).trim();
  if (status !== 'running') {
    console.error(`Container ${containerName} is not running (status=${status}). Run: docker compose up -d sqlserver`);
    process.exit(2);
  }
} catch {
  console.error(`Container ${containerName} not found. Run: docker compose up -d sqlserver`);
  process.exit(2);
}

// Copy MDF/LDF into SQL Server data dir.
const mdfContainerPath = `/var/opt/mssql/data/${path.basename(mdfHostPath)}`;
const ldfContainerPath = `/var/opt/mssql/data/${path.basename(ldfHostPath)}`;

run('docker', ['cp', mdfHostPath, `${containerName}:${mdfContainerPath}`]);
run('docker', ['cp', ldfHostPath, `${containerName}:${ldfContainerPath}`]);

// docker cp typically creates root-owned files; SQL Server runs as the `mssql` user and
// needs write access to upgrade/recover the database.
run('docker', [
  'exec',
  '-u',
  '0',
  containerName,
  'sh',
  '-lc',
  [
    `ls -l "${mdfContainerPath}" "${ldfContainerPath}"`,
    `chown mssql:root "${mdfContainerPath}" "${ldfContainerPath}"`,
    `chmod 660 "${mdfContainerPath}" "${ldfContainerPath}"`,
    `ls -l "${mdfContainerPath}" "${ldfContainerPath}"`
  ].join(' && ')
]);

// Use sqlcmd inside the container to attach.
// sqlcmd path varies; use the 18.x tools path used in current images.
const sqlcmd = '/opt/mssql-tools18/bin/sqlcmd';
const safeDbNameForQuery = dbName.replaceAll("'", "''");
const safeDbNameForIdent = dbName.replaceAll(']', ']]');

const query = `
IF DB_ID(N'${safeDbNameForQuery}') IS NOT NULL
BEGIN
  BEGIN TRY
    ALTER DATABASE [${safeDbNameForIdent}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
  END TRY BEGIN CATCH END CATCH;
  BEGIN TRY
    DROP DATABASE [${safeDbNameForIdent}];
  END TRY BEGIN CATCH END CATCH;
END

CREATE DATABASE [${safeDbNameForIdent}]
ON (FILENAME = N'${mdfContainerPath}'), (FILENAME = N'${ldfContainerPath}')
FOR ATTACH;
`.trim();

// -C: trust server certificate, needed in many container defaults.
run('docker', [
  'exec',
  containerName,
  sqlcmd,
  '-C',
  '-S',
  'localhost',
  '-U',
  'sa',
  '-P',
  saPassword,
  '-Q',
  query
]);

// Basic verification.
run('docker', [
  'exec',
  containerName,
  sqlcmd,
  '-C',
  '-S',
  'localhost',
  '-U',
  'sa',
  '-P',
  saPassword,
  '-Q',
  `SELECT name, state_desc, is_read_only FROM sys.databases WHERE name = '${safeDbNameForQuery}';`
]);

run('docker', [
  'exec',
  containerName,
  sqlcmd,
  '-C',
  '-S',
  'localhost',
  '-U',
  'sa',
  '-P',
  saPassword,
  '-d',
  dbName,
  '-Q',
  'SELECT DB_NAME() as db, COUNT(*) as tables FROM INFORMATION_SCHEMA.TABLES;'
]);

console.log('\nAttached legacy DB successfully. Next:');
console.log(`  export LEGACY_SQLSERVER_CONNECTION_STRING='Server=tcp:127.0.0.1,1433;Database=${dbName};User Id=sa;Password=${saPassword};Encrypt=false;TrustServerCertificate=true;'`);
console.log('  npm run migrate:export:legacy-sql -- export-all --out legacy-export --dir tables');
