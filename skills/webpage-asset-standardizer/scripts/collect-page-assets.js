#!/usr/bin/env node

import { chromium } from 'playwright';
import sharp from 'sharp';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.m3u8'];

function parseArgs(argv) {
  const args = {
    url: argv[0],
    help: argv.length === 0 || argv[0] === '--help' || argv[0] === '-h',
    output: './outputs/page-assets',
    waitMs: 3000,
    scrolls: 6,
    maxImages: 80
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--output' && value) {
      args.output = value;
      i += 1;
    } else if (arg === '--wait-ms' && value) {
      args.waitMs = Number(value);
      i += 1;
    } else if (arg === '--scrolls' && value) {
      args.scrolls = Number(value);
      i += 1;
    } else if (arg === '--max-images' && value) {
      args.maxImages = Number(value);
      i += 1;
    }
  }

  return args;
}

function usage() {
  console.error(`Usage: node collect-page-assets.js <url> [--output <dir>] [--wait-ms 3000] [--scrolls 6] [--max-images 80]`);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toAbsoluteUrl(value, baseUrl) {
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) {
    return null;
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseSrcset(srcset, baseUrl) {
  if (!srcset) return [];
  return srcset
    .split(',')
    .map((item) => item.trim().split(/\s+/)[0])
    .map((item) => toAbsoluteUrl(item, baseUrl))
    .filter(Boolean);
}

function filenameFromUrl(url, fallbackExt = '.png') {
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  let ext = fallbackExt;
  try {
    const parsed = new URL(url);
    const parsedExt = path.extname(parsed.pathname).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(parsedExt)) {
      ext = parsedExt === '.jpeg' ? '.jpg' : parsedExt;
    }
  } catch {
    // Keep fallback.
  }
  return `${hash}${ext}`;
}

async function ensureDirs(outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.join(outputDir, 'media'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'raw-images'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'standardized'), { recursive: true });
}

async function scrollPage(page, scrolls) {
  for (let i = 0; i < scrolls; i += 1) {
    await page.evaluate(() => window.scrollBy(0, Math.max(window.innerHeight, 700)));
    await page.waitForTimeout(450);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function extractPageData(page, url) {
  return page.evaluate((baseUrl) => {
    const abs = (value) => {
      if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return null;
      }
    };

    const srcsetUrls = (srcset) => {
      if (!srcset) return [];
      return srcset
        .split(',')
        .map((item) => item.trim().split(/\s+/)[0])
        .map(abs)
        .filter(Boolean);
    };

    const metadata = {};
    const title = document.querySelector('title')?.textContent?.trim() || '';
    if (title) metadata.title = title;

    document.querySelectorAll('meta').forEach((meta) => {
      const key = meta.getAttribute('name') || meta.getAttribute('property');
      const content = meta.getAttribute('content');
      if (key && content) metadata[key] = content.trim();
    });

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    if (canonical) metadata.canonical = abs(canonical);

    const visibleText = [...document.body.querySelectorAll('h1,h2,h3,p,li,figcaption,[class*="description"],[class*="Description"]')]
      .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
      .filter((text) => text.length >= 2);

    const imageUrls = [];
    document.querySelectorAll('img').forEach((img) => {
      imageUrls.push(abs(img.currentSrc || img.src || img.getAttribute('src')));
      imageUrls.push(...srcsetUrls(img.getAttribute('srcset')));
      imageUrls.push(abs(img.getAttribute('data-src')));
      imageUrls.push(abs(img.getAttribute('data-original')));
    });

    document.querySelectorAll('source').forEach((source) => {
      imageUrls.push(abs(source.getAttribute('src')));
      imageUrls.push(...srcsetUrls(source.getAttribute('srcset')));
    });

    document.querySelectorAll('[style]').forEach((node) => {
      const style = node.getAttribute('style') || '';
      const matches = [...style.matchAll(/url\(["']?([^"')]+)["']?\)/g)];
      matches.forEach((match) => imageUrls.push(abs(match[1])));
    });

    const videoUrls = [];
    document.querySelectorAll('video, video source').forEach((node) => {
      videoUrls.push(abs(node.getAttribute('src')));
      videoUrls.push(abs(node.getAttribute('poster')));
    });
    document.querySelectorAll('a[href], iframe[src]').forEach((node) => {
      const value = node.getAttribute('href') || node.getAttribute('src');
      videoUrls.push(abs(value));
    });

    return {
      metadata,
      text: [...new Set(visibleText)],
      imageUrls: [...new Set(imageUrls.filter(Boolean))],
      videoUrls: [...new Set(videoUrls.filter(Boolean))]
    };
  }, url);
}

function classifyVideoUrls(urls) {
  return urls.filter((url) => {
    const lower = url.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => lower.includes(ext))
      || lower.includes('youtube.com')
      || lower.includes('youtu.be')
      || lower.includes('vimeo.com')
      || lower.includes('video');
  });
}

async function downloadImage(url, outputDir) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; webpage-asset-standardizer/1.0)'
    }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const input = Buffer.from(arrayBuffer);
  const image = sharp(input, { animated: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Missing image dimensions');
  }

  const filename = filenameFromUrl(url, '.png').replace(/\.(webp|avif|gif)$/i, '.png');
  const filePath = path.join(outputDir, 'raw-images', filename);
  await image.png({ compressionLevel: 9 }).toFile(filePath);

  return {
    url,
    file: path.relative(outputDir, filePath),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    area: metadata.width * metadata.height
  };
}

function roleScore(image) {
  const ratio = image.width / image.height;
  const squareScore = Math.abs(1 - ratio);
  const landscapeScore = Math.abs((16 / 9) - ratio);
  return {
    icon: squareScore + (image.area > 2048 * 2048 ? 3 : 0),
    landscape: landscapeScore - Math.min(image.area / 10000000, 1)
  };
}

function assignRoles(images) {
  const usable = images.filter((image) => image.width >= 120 && image.height >= 120);
  const sortedSquare = [...usable].sort((a, b) => roleScore(a).icon - roleScore(b).icon);
  const icon = sortedSquare[0] || null;

  const landscapes = usable
    .filter((image) => image !== icon && image.width > image.height && image.width >= 500)
    .sort((a, b) => roleScore(a).landscape - roleScore(b).landscape);

  const roles = {};
  if (icon) roles.icon = icon.file;
  if (landscapes[0]) roles.cover = landscapes[0].file;
  landscapes.slice(1).forEach((image, index) => {
    roles[`screenshot_${index + 1}`] = image.file;
  });
  return roles;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const outputDir = path.resolve(args.output);
  await ensureDirs(outputDir);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  try {
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(args.waitMs);
    await scrollPage(page, args.scrolls);
    await page.screenshot({ path: path.join(outputDir, 'page-screenshot.png'), fullPage: true });

    const data = await extractPageData(page, args.url);
    const imageUrls = unique([
      ...data.imageUrls,
      data.metadata['og:image'],
      data.metadata['twitter:image']
    ].map((item) => toAbsoluteUrl(item, args.url) || item));
    const videoUrls = classifyVideoUrls(data.videoUrls);

    const downloaded = [];
    for (const imageUrl of imageUrls.slice(0, args.maxImages)) {
      try {
        downloaded.push(await downloadImage(imageUrl, outputDir));
      } catch (error) {
        downloaded.push({ url: imageUrl, error: error.message });
      }
    }

    const successfulImages = downloaded.filter((item) => item.file);
    const descriptionParts = [
      data.metadata.title,
      data.metadata.description,
      data.metadata['og:description'],
      ...data.text
    ].filter(Boolean);
    const descriptionText = unique(descriptionParts).join('\n\n').trim();
    const suggestedRoles = assignRoles(successfulImages);

    await fs.writeFile(path.join(outputDir, 'description.txt'), `${descriptionText}\n`, 'utf8');
    await fs.writeFile(path.join(outputDir, 'media', 'image-urls.txt'), `${imageUrls.join('\n')}\n`, 'utf8');
    await fs.writeFile(path.join(outputDir, 'media', 'video-urls.txt'), `${videoUrls.join('\n')}\n`, 'utf8');

    const manifest = {
      sourceUrl: args.url,
      collectedAt: new Date().toISOString(),
      metadata: data.metadata,
      text: data.text,
      videoUrls,
      images: successfulImages,
      failedImages: downloaded.filter((item) => item.error),
      suggestedRoles,
      outputs: []
    };
    await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
