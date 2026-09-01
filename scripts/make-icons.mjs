import { app, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets', 'icon-source.png');
const sizes = [512, 256, 128, 64, 48, 32, 16];

app.whenReady().then(() => {
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error(`图标源读取失败: ${source}`);
  for (const size of sizes) {
    const output = path.join(root, 'assets', `icon-${size}.png`);
    fs.writeFileSync(output, image.resize({ width: size, height: size, quality: 'best' }).toPNG());
    console.log(`已生成: ${output}`);
  }
  fs.copyFileSync(path.join(root, 'assets', 'icon-512.png'), path.join(root, 'assets', 'icon.png'));
  app.quit();
}).catch((error) => {
  console.error(error.message);
  app.exit(1);
});
