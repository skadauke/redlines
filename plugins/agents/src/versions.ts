// Comparing the versions of an agent's program (#527), as `x.y.z`.

/** Whether `latest` is a newer version than `installed`; nothing that isn't `x.y.z` is newer. */
export function isNewer(latest: string, installed: string): boolean {
  const pattern = /^(\d+)\.(\d+)\.(\d+)$/;
  const a = pattern.exec(latest);
  const b = pattern.exec(installed);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const [x, y] = [Number(a[i]), Number(b[i])];
    if (x !== y) return x > y;
  }
  return false;
}
