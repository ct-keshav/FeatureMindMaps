#!/usr/bin/env node
// Scaffold a new feature folder from templates/feature/.
//
//   npm run new-feature -- <FolderName> ["Display title"]
//
// The folder name becomes the URL: https://<user>.github.io/<repo>/<FolderName>/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [slug, ...titleWords] = process.argv.slice(2);

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

if (!slug) fail('Usage: npm run new-feature -- <FolderName> ["Display title"]');
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug) || slug === 'assets') {
  fail(`"${slug}" isn't a good folder name. Use letters, numbers, ".", "_" or "-" (it becomes part of the URL).`);
}

const target = path.join(root, 'features', slug);
if (fs.existsSync(target)) fail(`features/${slug}/ already exists.`);

const title =
  titleWords.join(' ').trim() ||
  slug
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();

const templateDir = path.join(root, 'templates', 'feature');
fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(templateDir)) {
  const text = fs
    .readFileSync(path.join(templateDir, file), 'utf8')
    .replaceAll('__TITLE__', JSON.stringify(title).slice(1, -1))
    .replaceAll('__SLUG__', slug);
  fs.writeFileSync(path.join(target, file), text);
}

console.log(`✔ Created features/${slug}/
    diagram.svg   ← replace with your exported diagram
    tracker.json  ← your blockers / open items
    feature.json  ← title, subtitle, and which tracker lists show as toolbar panels

  Preview:  npm run dev  →  http://localhost:5173/${slug}/
  Publish:  commit + push to main; GitHub Actions deploys to Pages.`);
