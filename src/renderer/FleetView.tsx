import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  DeleteForever,
  Download,
  ErrorOutlined,
  Memory,
  Refresh,
  Warning,
} from '@mui/icons-material';
import { useEffect, useState } from 'react';
import {
  Beamer,
  BeamerFleet,
  BeamerGame,
  BeamerPort,
  LabeledBeamer,
} from '../common/types';
import {
  beamerDeadColor,
  beamerHealthColor,
  characterNames,
  unknownCharacterId,
} from '../common/constants';
import getCharacterIcon from './getCharacterIcon';

type BeamerBusy = {
  kind: 'download' | 'refresh' | 'subscribe' | 'reset';
  target: string; // 'all' or a beamer id
};

function warningsFor(beamer: Beamer) {
  return beamer.warnings.join(', ');
}

function formatSecs(secs: number | undefined) {
  if (secs == null) {
    return '-';
  }
  if (secs < 60) {
    return `${secs}s`;
  }
  const mins = Math.floor(secs / 60);
  if (mins < 60) {
    return `${mins}m ${`${secs % 60}`.padStart(2, '0')}s`;
  }
  return `${Math.floor(mins / 60)}h ${`${mins % 60}`.padStart(2, '0')}m`;
}

function formatReplays(beamer: Beamer) {
  if (beamer.replayCount == null) {
    return '-';
  }
  return beamer.replayCap != null
    ? `${beamer.replayCount} / ${beamer.replayCap}`
    : `${beamer.replayCount}`;
}

function formatLocal(beamer: LabeledBeamer, keepOldReplays: boolean) {
  if (!beamer.local) {
    return '-';
  }
  const { downloaded, served, kept } = beamer.local;
  return keepOldReplays
    ? `${downloaded}/${served} (${kept} in back-up)`
    : `${downloaded}/${served}`;
}

function BeamersTooltip({
  showWarnings,
  beamers,
}: {
  showWarnings: boolean;
  beamers: LabeledBeamer[];
}) {
  return (
    <Stack sx={{ gap: '2px' }}>
      {beamers.map((beamer) => {
        const warnings = showWarnings ? warningsFor(beamer) : '';
        return (
          <Typography key={beamer.beamerId} variant="caption">
            {warnings ? `${beamer.label} - ${warnings}` : beamer.label}
          </Typography>
        );
      })}
    </Stack>
  );
}

function liveLightColor(beamer: Beamer) {
  if (beamer.game?.live) {
    return beamerHealthColor[beamer.health];
  }
  return beamerDeadColor[beamer.health] ?? beamerHealthColor[beamer.health];
}

function LiveLight({ beamer }: { beamer: Beamer }) {
  const dot = (
    <span
      style={{
        backgroundColor: liveLightColor(beamer),
        borderRadius: '50%',
        display: 'inline-block',
        height: '10px',
        width: '10px',
      }}
    />
  );
  let title = warningsFor(beamer);
  if (!title && beamer.health === 'error') {
    title = 'ERROR';
  }
  return title ? (
    <Tooltip arrow title={title}>
      {dot}
    </Tooltip>
  ) : (
    dot
  );
}

function PortCell({
  game,
  port,
}: {
  game: BeamerGame | null;
  port: BeamerPort | undefined;
}) {
  if (!port) {
    return <TableCell />;
  }
  const charName =
    (port.charId !== null && characterNames.get(port.charId)) || port.char;
  return (
    <TableCell>
      <Stack direction="row" sx={{ alignItems: 'center', gap: '4px' }}>
        <Tooltip arrow title={charName}>
          <Avatar
            alt={charName}
            src={getCharacterIcon(
              port.charId ?? unknownCharacterId,
              port.costume,
            )}
            style={{ height: '24px', width: '24px' }}
            variant="square"
          />
        </Tooltip>
        <Typography
          color={game?.live ? 'text.primary' : 'text.secondary'}
          variant="body2"
        >
          {port.nametag || `P${port.port}`}
        </Typography>
      </Stack>
    </TableCell>
  );
}

// counts up locally between the beamer's own reports
function LiveSecsText({ reported }: { reported: number | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const [baseline, setBaseline] = useState(() => ({ reported, at: now }));

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (baseline.reported !== reported) {
    setBaseline({ reported, at: now });
  }
  const secs =
    reported == null
      ? undefined
      : reported + Math.floor((now - baseline.at) / 1000);

  return (
    <Typography color="text.secondary" variant="body2">
      {formatSecs(secs)}
    </Typography>
  );
}

function ResetConfirmDialog({
  confirmingReset,
  beamers,
  resetting,
  onClose,
  onConfirm,
}: {
  confirmingReset: LabeledBeamer | 'all' | null;
  beamers: LabeledBeamer[];
  resetting: boolean;
  onClose: () => void;
  onConfirm: (target: LabeledBeamer | 'all') => void;
}) {
  let eraseWarning =
    "Every replay on this beamer's drive will be erased. This cannot be undone.";
  if (
    confirmingReset &&
    confirmingReset !== 'all' &&
    confirmingReset.replayCount != null
  ) {
    eraseWarning = `All ${confirmingReset.replayCount} replays on this beamer's drive will be erased. This cannot be undone.`;
  }
  return (
    <Dialog
      open={Boolean(confirmingReset)}
      onClose={() => {
        if (!resetting) {
          onClose();
        }
      }}
    >
      <DialogTitle>
        {confirmingReset === 'all'
          ? `Erase all ${beamers.length} beamers?`
          : `Erase ${confirmingReset ? confirmingReset.label : 'beamer'}?`}
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning">
          {confirmingReset === 'all'
            ? `Every replay on all ${beamers.length} of these drives will be erased. This cannot be undone.`
            : eraseWarning}
        </Alert>
        {confirmingReset === 'all' && (
          <DialogContentText variant="body2" sx={{ mt: 1 }}>
            {beamers.map((beamer) => beamer.label).join(', ')}
          </DialogContentText>
        )}
        <DialogContentText variant="body2" sx={{ mt: 1 }}>
          If a game is being played right now, let it finish first.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button disabled={resetting} onClick={onClose}>
          Cancel
        </Button>
        <Button
          color="error"
          disabled={resetting}
          endIcon={
            resetting ? <CircularProgress size="24px" /> : <DeleteForever />
          }
          onClick={() => {
            if (confirmingReset) {
              onConfirm(confirmingReset);
            }
          }}
          variant="contained"
        >
          {confirmingReset === 'all' ? 'Erase all' : 'Erase'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function FleetView() {
  const [fleet, setFleet] = useState<BeamerFleet>({
    beamers: [],
    browsing: false,
    error: '',
    ghostBeamerErrors: [],
    keepOldReplays: false,
  });
  const [busy, setBusy] = useState<BeamerBusy[]>([]);
  const [confirmingReset, setConfirmingReset] = useState<
    LabeledBeamer | 'all' | null
  >(null);
  const [error, setError] = useState('');
  const [maxGamesFromIndex, setMaxGamesFromIndex] = useState('');

  useEffect(() => {
    window.electron
      .getMaxGamesFromIndex()
      .then((maxGames) => setMaxGamesFromIndex(`${maxGames}`))
      .catch(() => {});
  }, []);

  const saveMaxGames = async (text: string) => {
    setMaxGamesFromIndex(text);
    const maxGames = Number.parseInt(text, 10);
    if (Number.isInteger(maxGames) && maxGames >= 1) {
      try {
        await window.electron.setMaxGamesFromIndex(maxGames);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  };

  useEffect(() => {
    const unsubscribe = window.electron.onBeamerFleet(setFleet);
    window.electron
      .getBeamerFleet()
      .then(setFleet)
      .catch(() => {});
    return unsubscribe;
  }, []);

  const runBusy = async (entry: BeamerBusy, action: () => Promise<unknown>) => {
    setBusy((list) => [...list, entry]);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((list) => list.filter((other) => other !== entry));
    }
  };

  const download = (beamerId: string) =>
    runBusy({ kind: 'download', target: beamerId }, () =>
      window.electron.downloadNewest(beamerId),
    );

  const refresh = (beamerId: string) =>
    runBusy({ kind: 'refresh', target: beamerId }, () =>
      window.electron.refreshBeamerStatusAndIndex(beamerId),
    );

  const toggleSubscribe = (beamer: LabeledBeamer) =>
    runBusy({ kind: 'subscribe', target: beamer.beamerId }, () =>
      window.electron.setBeamerSubscribed(beamer.beamerId, !beamer.subscribed),
    );

  const refreshAll = () =>
    runBusy({ kind: 'refresh', target: 'all' }, () =>
      window.electron.refreshAllBeamers(),
    );

  const reset = async (beamer: Beamer) => {
    await runBusy({ kind: 'reset', target: beamer.beamerId }, () =>
      window.electron.resetBeamer(beamer.beamerId),
    );
    setConfirmingReset(null);
  };

  const resetAll = async () => {
    await runBusy({ kind: 'reset', target: 'all' }, async () => {
      const failures = await window.electron.resetAllBeamers();
      if (failures.length > 0) {
        setError(
          `Erased the rest, but not these:\n${failures
            .map((failure) => `${failure.label}: ${failure.reason}`)
            .join('\n')}`,
        );
      }
    });
    setConfirmingReset(null);
  };

  const busyKind = (kind: BeamerBusy['kind']) =>
    busy.some((entry) => entry.kind === kind);
  const busyTarget = (kind: BeamerBusy['kind'], target: string) =>
    busy.some((entry) => entry.kind === kind && entry.target === target);
  const erroringBeamers = fleet.beamers.filter(
    (beamer) => beamer.health === 'error',
  );
  const warningBeamers = fleet.beamers.filter(
    (beamer) => beamer.health === 'warn',
  );
  const firmwareVersions = new Set(
    fleet.beamers.map((beamer) => beamer.firmwareVersion ?? 'not reported'),
  );
  const firmwareMismatch = firmwareVersions.size > 1;

  return (
    <Box sx={{ flexGrow: 1, overflow: 'auto', p: 2, pb: 8 }}>
      {/* the fleet never wraps - a narrow window scrolls it sideways */}
      <Box
        sx={{ minWidth: '100%', whiteSpace: 'nowrap', width: 'max-content' }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 2,
            justifyContent: 'space-between',
            mb: 1,
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Typography variant="h6">Beamers</Typography>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: '4px' }}>
              <TextField
                onChange={(event) => saveMaxGames(event.target.value)}
                size="small"
                slotProps={{
                  htmlInput: { min: 1, style: { textAlign: 'right' } },
                }}
                style={{ width: '40px' }}
                type="number"
                value={maxGamesFromIndex}
                variant="standard"
              />
              <Typography variant="body2">games downloaded</Typography>
            </Stack>
            {erroringBeamers.length > 0 && (
              <Tooltip
                arrow
                title={
                  <BeamersTooltip
                    showWarnings={false}
                    beamers={erroringBeamers}
                  />
                }
              >
                <Chip
                  color="error"
                  icon={<ErrorOutlined />}
                  label={`${erroringBeamers.length} error${
                    erroringBeamers.length === 1 ? '' : 's'
                  }`}
                  size="small"
                />
              </Tooltip>
            )}
            {warningBeamers.length > 0 && (
              <Tooltip
                arrow
                title={<BeamersTooltip showWarnings beamers={warningBeamers} />}
              >
                <Chip
                  color="warning"
                  icon={<Warning />}
                  label={`${warningBeamers.length} warning${
                    warningBeamers.length === 1 ? '' : 's'
                  }`}
                  size="small"
                />
              </Tooltip>
            )}
            {firmwareMismatch && (
              <Tooltip
                arrow
                title={`Firmware versions in use: ${[...firmwareVersions]
                  .sort()
                  .join(', ')}`}
              >
                <Chip
                  color="warning"
                  icon={<Memory />}
                  label="Firmware mismatch"
                  size="small"
                />
              </Tooltip>
            )}
          </Stack>
          {fleet.beamers.length > 0 && (
            <Stack direction="row" sx={{ alignItems: 'center', gap: '4px' }}>
              <Tooltip
                arrow
                title="Refresh the status and replays of every beamer listed here"
              >
                <span>
                  <IconButton
                    disabled={busyKind('refresh') || busyKind('reset')}
                    onClick={refreshAll}
                    size="small"
                  >
                    {busyTarget('refresh', 'all') ? (
                      <CircularProgress size="20px" />
                    ) : (
                      <Refresh />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip
                arrow
                title="Erase the replays on every beamer listed here"
              >
                <span>
                  <Button
                    color="error"
                    disabled={busyKind('reset')}
                    onClick={() => setConfirmingReset('all')}
                    size="small"
                    startIcon={<DeleteForever />}
                  >
                    Erase all
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          )}
        </Stack>
        {fleet.beamers.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>Replays</TableCell>
                <TableCell>Beamer</TableCell>
                <TableCell>Live</TableCell>
                <TableCell>Drive Space</TableCell>
                <TableCell>P1</TableCell>
                <TableCell>P2</TableCell>
                <TableCell>Ports changed</TableCell>
                <TableCell>Game started</TableCell>
                <TableCell />
                <TableCell />
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {fleet.beamers.map((beamer) => {
                const ports = [...(beamer.game?.ports ?? [])].sort(
                  (a, b) => a.port - b.port,
                );
                const beamerTitle = `${beamer.label} - ${beamer.beamerId} - ${
                  beamer.firmwareVersion ?? 'unknown firmware'
                }`;
                return (
                  <TableRow hover key={beamer.beamerId}>
                    <TableCell>
                      <Chip
                        color={beamer.subscribed ? 'primary' : 'default'}
                        disabled={busyTarget('subscribe', beamer.beamerId)}
                        label={beamer.subscribed ? 'Subscribed' : 'Subscribe'}
                        onClick={() => toggleSubscribe(beamer)}
                        size="small"
                        variant={beamer.subscribed ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography color="text.secondary" variant="body2">
                        {formatLocal(beamer, fleet.keepOldReplays)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Tooltip arrow title={beamerTitle}>
                        <Typography
                          noWrap
                          variant="body2"
                          sx={{ maxWidth: 220 }}
                        >
                          {beamer.label}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <LiveLight beamer={beamer} />
                    </TableCell>
                    <TableCell>
                      <Typography color="text.secondary" variant="body2">
                        {formatReplays(beamer)}
                      </Typography>
                    </TableCell>
                    <PortCell game={beamer.game} port={ports[0]} />
                    <PortCell game={beamer.game} port={ports[1]} />
                    <TableCell>
                      <LiveSecsText reported={beamer.secsSincePortChange} />
                    </TableCell>
                    <TableCell>
                      <LiveSecsText reported={beamer.secsSinceGameStart} />
                    </TableCell>
                    <TableCell padding="none">
                      <Tooltip
                        arrow
                        title="Refresh this beamer's status and replays"
                      >
                        <span>
                          <IconButton
                            disabled={busyKind('refresh') || busyKind('reset')}
                            onClick={() => refresh(beamer.beamerId)}
                          >
                            {busyTarget('refresh', beamer.beamerId) ? (
                              <CircularProgress size="24px" />
                            ) : (
                              <Refresh />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell padding="none">
                      <Tooltip arrow title="Erase this beamer's replays">
                        <span>
                          <IconButton
                            disabled={busyKind('reset')}
                            onClick={() => setConfirmingReset(beamer)}
                          >
                            {busyTarget('reset', beamer.beamerId) ? (
                              <CircularProgress size="24px" />
                            ) : (
                              <DeleteForever color="error" />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell padding="none">
                      <Tooltip
                        arrow
                        title="Download this beamer's newest replays"
                      >
                        <span>
                          <IconButton
                            disabled={busyTarget('download', beamer.beamerId)}
                            onClick={() => download(beamer.beamerId)}
                          >
                            {busyTarget('download', beamer.beamerId) ? (
                              <CircularProgress size="24px" />
                            ) : (
                              <Download />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Box>
      {fleet.beamers.length === 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {fleet.browsing
            ? 'Listening for Beamers. A beamer appears here within a second or two of joining the network.'
            : 'Not listening yet.'}
        </Alert>
      )}
      {fleet.error && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {`Could not listen for Beamers: ${fleet.error}`}
        </Alert>
      )}
      {fleet.ghostBeamerErrors.map((ghostError) => (
        <Alert key={ghostError} severity="error" sx={{ mt: 1 }}>
          {ghostError}
        </Alert>
      ))}
      {error && (
        <Alert severity="error" sx={{ mt: 1, whiteSpace: 'pre-line' }}>
          {error}
        </Alert>
      )}
      <ResetConfirmDialog
        beamers={fleet.beamers}
        confirmingReset={confirmingReset}
        onClose={() => setConfirmingReset(null)}
        onConfirm={(target) => {
          if (target === 'all') {
            resetAll();
          } else {
            reset(target);
          }
        }}
        resetting={busyKind('reset')}
      />
    </Box>
  );
}
