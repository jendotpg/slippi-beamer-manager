import { useEffect, useState } from 'react';
import { DownloadStatus } from '../common/types';
import DownloadSnackbar from './DownloadSnackbar';
import FleetView from './FleetView';
import Settings from './Settings';

export default function App() {
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>({
    status: 'idle',
  });
  useEffect(() => window.electron.onDownloadStatus(setDownloadStatus), []);

  return (
    <>
      <FleetView />
      <Settings />
      <DownloadSnackbar
        status={downloadStatus}
        onClose={() => {
          setDownloadStatus({ status: 'idle' });
        }}
        onCancel={() => {
          window.electron.cancelDownloads();
        }}
      />
    </>
  );
}
