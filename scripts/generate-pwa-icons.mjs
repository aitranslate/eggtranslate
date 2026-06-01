// scripts/generate-pwa-icons.mjs
// 从 public/favicon.svg 生成 PWA 必需的 PNG 图标。
// 幂等：可重复运行，结果一致。

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svgPath = join(root, 'public', 'favicon.svg');
const iconsDir = join(root, 'public', 'icons');

const SIZES = [
  { name: '192.png', size: 192 },
  { name: '512.png', size: 512 },
  // Maskable：safe zone 是中心 80%，所以图标缩放到 80% 后居中
  { name: 'maskable-512.png', size: 512, safeZone: true },
];

async function main() {
  const svg = await readFile(svgPath);

  for (const { name, size, safeZone } of SIZES) {
    if (safeZone) {
      // 缩放到 80%，透明背景，留 10% safe zone padding on each side
      const inner = Math.floor(size * 0.8);
      const padding = Math.floor((size - inner) / 2);
      const resized = await sharp(svg).resize(inner, inner).toBuffer();
      await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite([{ input: resized, left: padding, top: padding }])
        .png()
        .toFile(join(iconsDir, name));
    } else {
      await sharp(svg).resize(size, size).png().toFile(join(iconsDir, name));
    }
    console.log(`Generated ${name} (${size}x${size}${safeZone ? ', maskable' : ''})`);
  }

  console.log('All PWA icons generated successfully.');
}

main().catch((err) => {
  console.error('Icon generation failed:', err);
  process.exit(1);
});
