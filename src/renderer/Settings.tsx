import { CloudDownload, Settings as SettingsIcon } from '@mui/icons-material';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Fab,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { lt, valid } from 'semver';
import LabeledCheckbox from './LabeledCheckbox';
import { KeepOldReplays, ReplaysSize } from '../common/types';

function toMegabytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

function NumberField({
  disabled = false,
  min,
  value,
  onChange,
}: {
  disabled?: boolean;
  min: number;
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <TextField
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      slotProps={{ htmlInput: { min, style: { textAlign: 'right' } } }}
      style={{ width: '48px' }}
      type="number"
      value={value}
      variant="standard"
    />
  );
}

const parseAtLeast = (text: string, min: number) => {
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed >= min ? parsed : null;
};

export default function Settings() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  const [appVersion, setAppVersion] = useState('');
  const [latestAppVersion, setLatestAppVersion] = useState('');
  const [location, setLocation] = useState('');
  const [choosingLocation, setChoosingLocation] = useState(false);
  const [autoSubscribe, setAutoSubscribe] = useState(true);
  const [keepOld, setKeepOld] = useState<KeepOldReplays>({
    on: true,
    count: 10,
  });
  const [keepOldCount, setKeepOldCount] = useState('');
  useEffect(() => {
    (async () => {
      const appVersionPromise = window.electron.getVersion();
      const locationPromise = window.electron.getBeamerReplaysLocation();
      const autoSubscribePromise = window.electron.getBeamersAutoSubscribe();
      const keepOldPromise = window.electron.getKeepOldReplays();
      setAppVersion(await appVersionPromise);
      setLocation(await locationPromise);
      setAutoSubscribe(await autoSubscribePromise);
      const initialKeepOld = await keepOldPromise;
      setKeepOld(initialKeepOld);
      setKeepOldCount(`${initialKeepOld.count}`);
      try {
        setLatestAppVersion(await window.electron.getLatestVersion());
      } catch {
        // offline
      }
    })();
  }, []);

  const needUpdate = useMemo(
    () =>
      Boolean(
        valid(appVersion) &&
        valid(latestAppVersion) &&
        lt(appVersion, latestAppVersion),
      ),
    [appVersion, latestAppVersion],
  );
  const [hasAutoOpened, setHasAutoOpened] = useState(false);
  if (needUpdate && !hasAutoOpened) {
    setOpen(true);
    setHasAutoOpened(true);
  }

  const [replaysSize, setReplaysSize] = useState<ReplaysSize>({
    files: 0,
    bytes: 0,
  });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const measure = () => {
      window.electron
        .getDownloadedReplaysSize()
        .then(setReplaysSize)
        .catch(() => {});
    };
    measure();
    return window.electron.onBeamerFleet(measure);
  }, [open]);

  const saveKeepOld = async (on: boolean, countText: string) => {
    setKeepOldCount(countText);
    const count = parseAtLeast(countText, 0);
    if (count === null) {
      return;
    }
    try {
      setKeepOld(await window.electron.setKeepOldReplays(on, count));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <>
      <Tooltip arrow title="Settings">
        <Fab
          onClick={() => setOpen(true)}
          size="small"
          style={{ position: 'absolute', bottom: 8, left: 8 }}
          sx={{
            zIndex: (theme) => theme.zIndex.modal + 1,
          }}
        >
          <SettingsIcon />
        </Fab>
      </Tooltip>
      <Dialog fullWidth open={open} onClose={() => setOpen(false)}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            mr: 3,
          }}
        >
          <DialogTitle>Settings</DialogTitle>
          <Typography variant="caption">
            Slippi Beamer Manager version {appVersion}
          </Typography>
        </Stack>
        <DialogContent>
          <Stack sx={{ gap: 1 }}>
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="caption" sx={{ flexShrink: 0 }}>
                Beamer replays location:
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  direction: 'rtl',
                  flexGrow: 1,
                  opacity: 0.5,
                  overflow: 'hidden',
                  textAlign: 'left',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {`\u200e${location}\u200e`}
              </Typography>
              <Button
                disabled={choosingLocation}
                endIcon={
                  choosingLocation ? (
                    <CircularProgress size="24px" />
                  ) : undefined
                }
                onClick={async () => {
                  setChoosingLocation(true);
                  try {
                    setLocation(
                      await window.electron.chooseBeamerReplaysLocation(),
                    );
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setChoosingLocation(false);
                  }
                }}
                sx={{ flexShrink: 0 }}
                variant="contained"
              >
                Change
              </Button>
            </Stack>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Typography variant="caption">
                {replaysSize.files > 0
                  ? `Downloaded replays: ${replaysSize.files} (${toMegabytes(
                      replaysSize.bytes,
                    )})`
                  : 'No downloaded replays'}
              </Typography>
              <Button
                color="error"
                disabled={replaysSize.files === 0 || deleting}
                onClick={() => setConfirmingDelete(true)}
                variant="contained"
              >
                Delete downloaded replays
              </Button>
            </Stack>
            <LabeledCheckbox
              checked={autoSubscribe}
              label="Auto-subscribe to all Beamers"
              set={async (checked) => {
                try {
                  await window.electron.setBeamersAutoSubscribe(checked);
                  setAutoSubscribe(checked);
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <LabeledCheckbox
                checked={keepOld.on}
                label="Keep old replays"
                set={(checked) => saveKeepOld(checked, keepOldCount)}
                style={{ marginRight: 0 }}
              />
              <NumberField
                disabled={!keepOld.on}
                min={0}
                value={keepOldCount}
                onChange={(text) => saveKeepOld(keepOld.on, text)}
              />
            </Stack>
          </Stack>
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
          {needUpdate && (
            <Alert
              severity="warning"
              sx={{ mt: 1 }}
              action={
                <Button
                  endIcon={<CloudDownload />}
                  variant="contained"
                  onClick={() => {
                    window.electron.update();
                  }}
                >
                  Quit and download
                </Button>
              }
            >
              Update available! Version {latestAppVersion}
            </Alert>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmingDelete}
        onClose={() => {
          if (!deleting) {
            setConfirmingDelete(false);
          }
        }}
      >
        <DialogTitle>Delete downloaded replays?</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            {`All ${replaysSize.files} downloaded replays (${toMegabytes(
              replaysSize.bytes,
            )}) will be deleted from this computer. The beamers keep theirs.`}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deleting}
            onClick={() => setConfirmingDelete(false)}
          >
            Cancel
          </Button>
          <Button
            color="error"
            disabled={deleting}
            endIcon={deleting ? <CircularProgress size="24px" /> : undefined}
            onClick={async () => {
              setDeleting(true);
              try {
                await window.electron.deleteDownloadedReplays();
                setReplaysSize(
                  await window.electron.getDownloadedReplaysSize(),
                );
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setDeleting(false);
                setConfirmingDelete(false);
              }
            }}
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
