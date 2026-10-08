import { ReactNode, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Paper,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Close, Download, Remove } from '@mui/icons-material';
import { MAX_DOWNLOAD_ATTEMPTS } from '../common/constants';
import { DownloadStatus } from '../common/types';

const MAX_VISIBLE_SOURCES = 3;

function CloseIconButton({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <Tooltip arrow title={title}>
      <IconButton size="small" onClick={onClick}>
        <Close />
      </IconButton>
    </Tooltip>
  );
}

function MinimizeIconButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip arrow title="Minimize (download continues)">
      <IconButton size="small" onClick={onClick}>
        <Remove />
      </IconButton>
    </Tooltip>
  );
}

function LinearProgressWithLabel({ value }: { value: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
      <Box sx={{ width: '100%', mr: 1 }}>
        <LinearProgress variant="determinate" value={value} />
      </Box>
      <Box sx={{ minWidth: 35 }}>
        <Typography variant="body2" color="text.secondary">{`${Math.round(
          value,
        )}%`}</Typography>
      </Box>
    </Box>
  );
}

function TitleRow({ title, action }: { title: string; action: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
    >
      <Typography variant="subtitle2">{title}</Typography>
      {action}
    </Stack>
  );
}

export default function DownloadSnackbar({
  status,
  onClose,
  onCancel,
}: {
  status: DownloadStatus;
  onClose: () => void;
  onCancel: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  const [shownStatus, setShownStatus] = useState(status);
  if (status !== shownStatus) {
    setShownStatus(status);
    if (status.status === 'error') {
      setHidden(false); // errors always surface
    }
  }

  if (hidden && status.status === 'downloading') {
    return (
      <Tooltip arrow title="Show downloads">
        <Chip
          color="primary"
          icon={<Download />}
          label={`${Math.round(status.progress)}%`}
          onClick={() => setHidden(false)}
          sx={{
            position: 'absolute',
            left: 56,
            bottom: 8,
            height: 40,
            borderRadius: 20,
            zIndex: (t) => t.zIndex.snackbar,
          }}
        />
      </Tooltip>
    );
  }

  const open =
    !hidden &&
    (status.status === 'downloading' ||
      status.status === 'cancelled' ||
      status.status === 'error');

  let content = null;
  if (status.status === 'downloading') {
    const { filesDone, totalFiles, failedCount, attempt } = status;
    const names = status.sources.map((source) => source.label);
    const visible = names.slice(0, MAX_VISIBLE_SOURCES).join(', ');
    const overflow = names.length - MAX_VISIBLE_SOURCES;
    const failed = failedCount === 0 ? '' : `${failedCount} failed, `;
    content = (
      <Stack sx={{ gap: 1 }}>
        <TitleRow
          title="Downloading replays..."
          action={<MinimizeIconButton onClick={() => setHidden(true)} />}
        />
        <LinearProgressWithLabel value={status.progress} />
        <Typography variant="body2" color="text.secondary">
          {failed}
          {visible}
          {overflow > 0 && (
            <Typography component="span" variant="body2" color="text.disabled">
              {` + ${overflow} more`}
            </Typography>
          )}
          {` (${filesDone} of ${totalFiles} done)`}
        </Typography>
        {attempt !== undefined && (
          <Typography variant="body2" color="text.secondary">
            {`Connection dropped, retrying (attempt ${attempt} of ${MAX_DOWNLOAD_ATTEMPTS})...`}
          </Typography>
        )}
        <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
        </Stack>
      </Stack>
    );
  } else if (status.status === 'cancelled') {
    content = (
      <Stack sx={{ gap: 1 }}>
        <TitleRow
          title="Download Cancelled"
          action={<CloseIconButton title="Close" onClick={onClose} />}
        />
        <Typography variant="body2" color="text.secondary">
          {`Stopped after ${status.filesDone} of ${status.totalFiles} files. ` +
            'Partly downloaded files are kept, so the next download picks up ' +
            'where this left off.'}
        </Typography>
      </Stack>
    );
  } else if (status.status === 'error') {
    content = (
      <Stack sx={{ gap: 1, minHeight: 0 }}>
        <TitleRow
          title="Error Downloading Replays"
          action={<CloseIconButton title="Close" onClick={onClose} />}
        />
        <Typography variant="body2" color="text.secondary">
          Failed to download the following replays:
        </Typography>
        <Stack sx={{ gap: 1, minHeight: 0, overflowY: 'auto' }}>
          {status.failedFiles.map((file) => (
            <Typography
              key={`${file.label}|${file.fileName ?? ''}|${file.reason}`}
              variant="body2"
              color="text.secondary"
            >
              {`${file.label}${file.fileName ? ` - ${file.fileName}` : ''}: ${
                file.reason
              }`}
            </Typography>
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {"These won't retry on their own - use a beamer's Download button " +
            'to try again.'}
        </Typography>
      </Stack>
    );
  }

  return (
    <Snackbar
      open={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      onClose={(event, reason) => {
        if (reason === 'clickaway' || status.status === 'downloading') {
          return; // not dismissable - click the cancel button...
        }
        onClose();
      }}
      sx={{
        left: 8,
        bottom: 8,
        right: 'auto',
      }}
    >
      <Paper
        elevation={6}
        sx={{
          p: 1.5,
          width: 360,
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 48px)',
        }}
      >
        {content}
      </Paper>
    </Snackbar>
  );
}
