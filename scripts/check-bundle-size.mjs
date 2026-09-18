import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('../dist/', import.meta.url);
const maxTotalBytes = 900 * 1024;
const maxChunkBytes = 350 * 1024;
const assets = [];
async function collect(dir, prefix = '') {
  for (const file of await readdir(dir)) {
    const absolute = join(dir.pathname, file);
    const entry = await stat(absolute);
    if (entry.isDirectory()) await collect(new URL(`${file}/`, dir), `${prefix}${file}/`);
    else if (['.js', '.css', '.html'].includes(extname(file))) assets.push({ file: `${prefix}${file}`, size: entry.size });
  }
}
await collect(root);
const total = assets.reduce((sum, asset) => sum + asset.size, 0);
const largest = assets.reduce((max, asset) => Math.max(max, asset.size), 0);
console.log(`[perf] runtime assets: ${(total / 1024).toFixed(1)} KiB; largest chunk: ${(largest / 1024).toFixed(1)} KiB`);
if (total > maxTotalBytes) throw new Error(`[perf] runtime assets exceed ${maxTotalBytes} bytes`);
const oversized = assets.filter((asset) => asset.size > maxChunkBytes);
if (oversized.length > 0) throw new Error(`[perf] chunk exceeds ${maxChunkBytes} bytes: ${oversized.map((asset) => asset.file).join(', ')}`);
