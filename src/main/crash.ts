import os from 'os';
import { app, clipboard, dialog } from 'electron';
import { hideSeenBeamers } from './beamer';

let crashed = false;
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
});

export default function quitAfterCrash(what: string) {
  if (crashed || quitting) {
    return;
  }
  crashed = true;
  hideSeenBeamers();

  const details = [
    `Slippi Beamer Manager ${app.getVersion()} (Electron ${
      process.versions.electron
    }, ${process.platform} ${os.release()})`,
    what,
  ].join('\n');
  const choice = dialog.showMessageBoxSync({
    type: 'error',
    message: 'Slippi Beamer Manager stopped working',
    detail: `Restart it to keep downloading replays. Replays already downloaded are kept.\n\n${details}`,
    buttons: ['Copy Error and Quit', 'Quit'],
    defaultId: 0,
    cancelId: 1,
  });
  if (choice === 0) {
    clipboard.writeText(details);
  }
  app.quit();
}
