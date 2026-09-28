import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(
  container,
  import.meta.env.PROD
    ? {
        onUncaughtError: (error, errorInfo) => {
          window.electron.reportRendererError(
            `${
              error instanceof Error ? (error.stack ?? error.message) : error
            }${errorInfo.componentStack ?? ''}`,
          );
        },
      }
    : {},
);
root.render(<App />);
