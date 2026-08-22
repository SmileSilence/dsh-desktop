// 创建 Windows ICO 图标文件
// 需要安装: npm install to-ico --save-dev

const fs = require('fs');
const path = require('path');

// 简单的 ICO 文件创建器
function createSimpleICO() {
  // ICO 文件格式头
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);    // 保留字段
  icoHeader.writeUInt16LE(1, 2);    // 类型: 1 = 图标
  icoHeader.writeUInt16LE(1, 4);    // 图像数量

  // ICO 目录条目 (16x16, 32位)
  const icoDir = Buffer.alloc(16);
  icoDir.writeUInt8(16, 0);     // 宽度
  icoDir.writeUInt8(16, 1);     // 高度
  icoDir.writeUInt8(0, 2);      // 颜色数
  icoDir.writeUInt8(0, 3);      // 保留
  icoDir.writeUInt16LE(1, 4);   // 颜色平面
  icoDir.writeUInt16LE(32, 6);  // 位深
  icoDir.writeUInt32LE(40 + 16*16*4, 8);  // 图像数据大小
  icoDir.writeUInt32LE(22, 12); // 图像数据偏移

  // BMP 信息头 (40 字节)
  const bmpHeader = Buffer.alloc(40);
  bmpHeader.writeUInt32LE(40, 0);      // 头大小
  bmpHeader.writeInt32LE(16, 4);       // 宽度
  bmpHeader.writeInt32LE(32, 8);       // 高度 (包含掩码)
  bmpHeader.writeUInt16LE(1, 12);      // 平面数
  bmpHeader.writeUInt16LE(32, 14);     // 位深
  bmpHeader.writeUInt32LE(0, 16);      // 压缩方式
  bmpHeader.writeUInt32LE(16*16*4, 20); // 图像大小

  // 图像数据 (32位 BGRA)
  const imageData = Buffer.alloc(16 * 16 * 4);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const idx = (y * 16 + x) * 4;
      // 紫色渐变
      imageData[idx] = 234;     // B (#667eea)
      imageData[idx + 1] = 126; // G
      imageData[idx + 2] = 102; // R
      imageData[idx + 3] = 255; // A
    }
  }

  // 组合 ICO 文件
  const icoFile = Buffer.concat([icoHeader, icoDir, bmpHeader, imageData]);

  // 保存文件
  const icoPath = path.join(__dirname, 'icon.ico');
  fs.writeFileSync(icoPath, icoFile);

  console.log('✅ 已创建 icon.ico:', icoPath);
  console.log('文件大小:', icoFile.length, '字节');

  return icoPath;
}

// 运行
createSimpleICO();
console.log('\n现在重启应用，托盘应该使用 .ico 图标了');
