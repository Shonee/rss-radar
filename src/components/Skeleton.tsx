// T-P3-02 公共组件库 — 骨架屏
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import { tokens } from '../theme/tokens';

export interface SkeletonListProps {
  /** 占位卡片数量，默认 3 */
  count?: number;
  testId?: string;
}

/** 列表骨架屏（aria-busy 便于无障碍与 QA） */
export default function SkeletonList({ count = 3, testId = 'skeleton' }: SkeletonListProps) {
  const items = Array.from({ length: Math.max(count, 0) }, (_, i) => i);
  return (
    <Box data-testid={testId} data-component="skeleton" aria-busy="true" aria-live="polite">
      {items.map((i) => (
        <Box
          key={i}
          sx={{
            border: `1px solid ${tokens.surface.border}`,
            borderRadius: tokens.radius.md,
            bgcolor: tokens.surface.surface,
            p: 2,
            mb: 1.5,
          }}
        >
          <Skeleton variant="text" width="60%" height={22} />
          <Skeleton variant="text" width="88%" height={16} />
          <Skeleton variant="text" width="70%" height={16} />
          <Skeleton variant="text" width="40%" height={16} />
        </Box>
      ))}
    </Box>
  );
}
