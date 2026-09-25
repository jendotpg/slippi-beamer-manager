// macOS keys local-network permission to the executable's LC_UUID, which is
// otherwise the same for every app built on the same Electron. Give each
// universal build its own, then re-sign ad hoc.
const { execFile } = require('child_process');
const { promisify } = require('util');

const run = promisify(execFile);

exports.default = async function machOUuid(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin' || context.arch !== 4) {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  const executablePath = `${appPath}/Contents/MacOS/${appName}`;
  const { stdout } = await run('python3', [
    `${__dirname}/mach-o-uuid.py`,
    executablePath,
  ]);
  console.log(stdout);

  await run('codesign', ['--deep', '-s', '-', appPath]);
};
