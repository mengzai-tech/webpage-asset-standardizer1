# Webpage Asset Standardizer

Codex skill for collecting public webpage text, images, and video URLs, then converting selected store assets into fixed PNG deliverable sizes.

This was designed for workflows like:

- collect a game listing page's English description
- download icon, cover, and screenshot assets
- output `512x512`, `1920x1080`, and `1200x628` PNG files
- return video URLs without downloading protected video streams

## Install

From a public GitHub repo:

```bash
npx skills add https://github.com/<your-github-name>/webpage-asset-standardizer --skill webpage-asset-standardizer
```

Or with owner/repo syntax:

```bash
npx skills add <your-github-name>/webpage-asset-standardizer@webpage-asset-standardizer
```

Restart Codex after installation.

## First-Time Setup

After installation, install the script dependencies:

```bash
cd ~/.codex/skills/webpage-asset-standardizer/scripts
npm install
npx playwright install chromium
```

If your Codex uses a workspace-local `.agents/skills` directory, use that installed path instead.

## Example Use

Ask Codex:

```text
Use $webpage-asset-standardizer to extract this page's icon, store images, video URLs, and English description, then output icon 512x512 PNG and each cover/screenshot as 1920x1080 and 1200x628 PNG.
https://example.com/app/123#info
```

Manual script run:

```bash
cd ~/.codex/skills/webpage-asset-standardizer/scripts
node collect-page-assets.js "https://example.com/app/123#info" --output "./outputs/example"
node standardize-assets.js "./outputs/example" --config "../references/asset-spec.json"
```

## Publish To Your GitHub

```bash
cd /path/to/webpage-asset-standardizer
git init
git add .
git commit -m "Add webpage asset standardizer skill"
git branch -M main
git remote add origin https://github.com/<your-github-name>/webpage-asset-standardizer.git
git push -u origin main
```

## Notes

- The skill only targets public webpage resources.
- Do not commit generated `outputs/` folders.
- Do not commit cookies, API keys, private browser profiles, or protected media.
