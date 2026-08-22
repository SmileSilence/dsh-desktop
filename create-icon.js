// 简单的图标生成脚本（需要 canvas 库）
// npm install canvas --save-dev
// 然后运行 node create-icon.js

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // 背景渐变
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(1, '#764ba2');
  ctx.fillStyle = gradient;

  // 圆角矩形
  const radius = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.fill();

  // 文字 "DSH"
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.35}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DSH', size / 2, size / 2);

  return canvas.toBuffer('image/png');
}

// 生成不同尺寸
const sizes = [16, 32, 64, 128, 256, 512];
const assetsDir = path.join(__dirname, 'assets');

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir);
}

sizes.forEach(size => {
  const icon = createIcon(size);
  fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), icon);
  console.log(`Created icon-${size}.png`);
});

console.log('Done! Icons saved to assets/');
