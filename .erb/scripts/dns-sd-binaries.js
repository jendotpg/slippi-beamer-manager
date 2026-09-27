// npm installs dns-sd's native binary for this machine's arch only, but each
// half of a universal build loads the one for its own arch. Add whichever is
// missing, at the version dns-sd pins, without touching package.json or the
// lockfile. --force is what lets npm install a binary for another arch.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const run = promisify(execFile);

exports.default = async function dnsSdBinaries(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const { appDir } = context.packager.info;
  const nodeModulesPath = path.join(appDir, 'node_modules');
  const { optionalDependencies } = JSON.parse(
    fs.readFileSync(
      path.join(nodeModulesPath, '@fugood', 'dns-sd', 'package.json'),
      'utf8',
    ),
  );
  const missing = ['x64', 'arm64']
    .map((arch) => `@fugood/dns-sd-darwin-${arch}`)
    .filter((name) => !fs.existsSync(path.join(nodeModulesPath, name)))
    .map((name) => `${name}@${optionalDependencies[name]}`);
  if (missing.length === 0) {
    return;
  }

  await run(
    'npm',
    ['install', '--no-save', '--force', '--ignore-scripts', ...missing],
    { cwd: appDir },
  );
};
