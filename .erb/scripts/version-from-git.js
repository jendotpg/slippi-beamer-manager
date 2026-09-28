// Stamps the version from the nearest v* tag into both package.json files, so
// a release is versioned by its tag and nobody bumps them by hand. On the tag
// itself that's the tag (v0.2.0 -> 0.2.0). N commits later it's the tag plus
// build metadata (0.2.0+3.gb4a17d7), which semver ranks equal to the tag, so a
// branch build doesn't offer to update to the release it's built on.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

const root = path.join(__dirname, '../..');
const described = execFileSync(
  'git',
  ['describe', '--tags', '--long', '--match', 'v[0-9]*'],
  { cwd: root, encoding: 'utf8' },
).trim();
const [, tag, commits, sha] = described.match(/^v(.+)-(\d+)-(g[0-9a-f]+)$/);
if (!semver.valid(tag)) {
  throw new Error(`Tag v${tag} isn't a semver version.`);
}
const version = commits === '0' ? tag : `${tag}+${commits}.${sha}`;

for (const dir of ['.', 'release/app']) {
  const file = path.join(root, dir, 'package.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`Version ${version} (from ${described})`);
