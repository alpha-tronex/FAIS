/**
 * Ensures .angular/cache/<version>/client/vite/deps/ has a package-lock.json when it has package.json.
 * Fixes RHDA error: "package.json requires a lock file" when analyzing the Vite deps cache.
 */
const fs = require('fs');
const path = require('path');

const cacheRoot = path.join(__dirname, '..', '.angular', 'cache');
const lockfileContent = JSON.stringify(
  {
    name: '',
    version: '0.0.0',
    lockfileVersion: 2,
    packages: {}
  },
  null,
  2
);

if (!fs.existsSync(cacheRoot)) process.exit(0);

const versions = fs.readdirSync(cacheRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
for (const v of versions) {
  const depsDir = path.join(cacheRoot, v.name, 'client', 'vite', 'deps');
  const pkgPath = path.join(depsDir, 'package.json');
  const lockPath = path.join(depsDir, 'package-lock.json');
  if (fs.existsSync(pkgPath) && !fs.existsSync(lockPath)) {
    fs.writeFileSync(lockPath, lockfileContent, 'utf8');
  }
}
