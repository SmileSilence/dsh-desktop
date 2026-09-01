// 统一图标流水线（P4.3 / E3）：把多尺寸 PNG 合成标准 Windows ICO（PNG-in-ICO，零依赖）。
// 运行: node scripts/pack-ico.mjs <pngDir> <out.ico> [sizesCsv]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pngDir = process.argv[2] || path.join(__dirname, '..', 'assets');
const outPath = process.argv[3] || path.join(pngDir, 'app.ico');
const sizes = (process.argv[4] || '256,128,64,48,32,16').split(',').map(Number);

const pngs = [];
for (const s of sizes) {
  const p = path.join(pngDir, `icon-${s}.png`);
  if (!fs.existsSync(p)) {
    console.error('缺少尺寸文件:', p);
    process.exit(1);
  }
  pngs.push({ size: s, data: fs.readFileSync(p) });
}
pngs.sort((a, b) => b.size - a.size);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);

let offset = 6 + 16 * pngs.length;
const entries = [];
const dataParts = [];
for (const p of pngs) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
  entry.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(p.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  dataParts.push(p.data);
  offset += p.data.length;
}

const out = Buffer.concat([header, ...entries, ...dataParts]);
fs.writeFileSync(outPath, out);
console.log('已生成 ICO:', outPath, `(${pngs.length} sizes, ${out.length} bytes)`);
