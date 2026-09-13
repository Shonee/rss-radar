// T-P3-02 公共组件库 — 错误横幅（加载失败，红色）
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';

export interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  testId?: string;
}

export default function ErrorBanner({ message, onRetry, testId = 'error-banner' }: ErrorBannerProps) {
  return (
    <Alert
      data-testid={testId}
      data-component="error-banner"
      severity="error"
      action={
        onRetry ? (
          <Button color="inherit" size="small" onClick={onRetry}>
            重试
          </Button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  );
}
