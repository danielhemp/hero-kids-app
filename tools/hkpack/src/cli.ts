#!/usr/bin/env node
/**
 * hkpack — turn a Hero Kids PDF you own into a .hkpack for the Hero Kids App.
 *
 *   npm run pack -- ../../pdfs/Hero_Kids_-_Fantasy_RPG.pdf
 *
 * Writes packs/<name>.hkpack and build/<name>/preview.html. Open the preview
 * and check the grid overlays before loading the pack onto an iPad.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, cp, rm, stat } from 'node:fs/promises';
import { buildPack } from './pack.ts';
import { preflight } from './preflight.ts';
import { renderPreview } from './preview.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

interface Args {
  files: string[];
  outDir: string;
  buildDir: string;
  noOcr: boolean;
  keepAssets: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    outDir: path.join(repoRoot, 'packs'),
    buildDir: path.join(repoRoot, 'build'),
    noOcr: false,
    keepAssets: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--no-ocr') args.noOcr = true;
    else if (a === '--keep-assets') args.keepAssets = true;
    else if (a === '--out') args.outDir = path.resolve(argv[++i] ?? args.outDir);
    else if (a === '--build') args.buildDir = path.resolve(argv[++i] ?? args.buildDir);
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else args.files.push(path.resolve(a));
  }
  return args;
}

function usage(): never {
  console.error(
    [
      'usage: npm run pack -- <file.pdf> [more.pdf ...] [options]',
      '',
      '  --no-ocr        do not try to read card names with tesseract',
      '  --keep-assets   leave the unzipped assets in the build directory',
      '  --out <dir>     where to write .hkpack files   (default: packs/)',
      '  --build <dir>   where to write previews        (default: build/)',
    ].join('\n'),
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) usage();

  const ready = await preflight();
  if (!ready.ok) {
    console.error(ready.message);
    process.exit(1);
  }
  for (const note of ready.notes) console.log(`note: ${note}`);

  for (const file of args.files) {
    try {
      await stat(file);
    } catch {
      console.error(`no such file: ${file}`);
      process.exitCode = 1;
      continue;
    }

    const name = path.basename(file, '.pdf');
    const workDir = path.join(args.buildDir, name);
    await mkdir(workDir, { recursive: true });

    const started = Date.now();
    const { manifest } = await buildPack({
      pdfFile: file,
      outDir: args.outDir,
      workDir,
      noOcr: args.noOcr,
      log: (m) => process.stdout.write(`${m}\n`),
    });

    // The preview needs the assets unzipped beside it to display them.
    const previewAssets = path.join(workDir, 'preview');
    await rm(previewAssets, { recursive: true, force: true });
    await cp(path.join(workDir, 'assets'), previewAssets, { recursive: true });
    await writeFile(path.join(previewAssets, 'preview.html'), renderPreview(manifest), 'utf8');

    if (!args.keepAssets) {
      await rm(path.join(workDir, 'assets'), { recursive: true, force: true });
      await rm(path.join(workDir, 'images'), { recursive: true, force: true });
    }

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`  preview: ${path.join(previewAssets, 'preview.html')}`);
    console.log(`  done in ${seconds}s\n`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
