export function resolveCollectExitCode({ ok, err, allowPartialSuccess = false }) {
  if (err === 0) return 0;
  if (ok === 0) return 1;
  if (allowPartialSuccess) return 0;
  return 2;
}
