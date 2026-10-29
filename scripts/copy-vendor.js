const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'client', 'js', 'vendor');
fs.mkdirSync(out, { recursive: true });
const jobs = [
  [path.join(root, 'node_modules', 'jsqr', 'dist', 'jsQR.js'), 'jsQR.js'],
  [path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), 'chart.umd.js'],
];
for (const [src, dest] of jobs) {
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(out, dest)); console.log('[vendor] copied', dest); }
  else console.warn('[vendor] not found:', src);
}
