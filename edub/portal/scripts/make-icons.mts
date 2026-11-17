// Regenerates public/*.png + favicon.ico from public/icon.svg (Playwright, dev tool; output is committed).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/home/ubuntu/apps/edub-apps-travels/");
const { chromium } = require("playwright");
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ channel: "chrome" });
const render = async (size: number, maskable = false) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#0b0b0f;display:flex;align-items:center;justify-content:center"><div style="width:${size * 0.72}px;height:${size * 0.72}px">${svg}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<body style="margin:0;background:transparent">${inner}<style>svg{width:100%;height:100%;display:block}</style></body>`);
  const buf = await page.screenshot({ omitBackground: true });
  await page.close();
  return buf;
};
const out = (n: string, b: Buffer) => writeFileSync(new URL(`../public/${n}`, import.meta.url), b);
out("icon-192.png", await render(192));
out("icon-512.png", await render(512));
out("icon-maskable-512.png", await render(512, true));
out("apple-touch-icon.png", await render(180, true));
out("favicon-32.png", await render(32));
const png = await render(48);
const hdr = Buffer.alloc(22);
hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(1, 4); hdr[6] = 48; hdr[7] = 48; hdr.writeUInt16LE(1, 10); hdr.writeUInt16LE(32, 12);
hdr.writeUInt32LE(png.length, 14); hdr.writeUInt32LE(22, 18);
out("favicon.ico", Buffer.concat([hdr, png]));
await browser.close();
