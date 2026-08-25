/**
 * Check the external tools are actually there before doing any work.
 *
 * Everything here is a shell-out to poppler, so a missing binary surfaces as
 * `Error: spawn pdfinfo ENOENT` several seconds into a run — accurate, and
 * useless. This turns that into a sentence naming the thing to install.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const run = promisify(execFile);

interface Requirement {
  binary: string;
  provides: string;
  required: boolean;
  /** what stops working without it */
  usedFor: string;
}

const REQUIREMENTS: Requirement[] = [
  { binary: 'pdfinfo', provides: 'poppler', required: true, usedFor: 'reading PDFs' },
  { binary: 'pdfimages', provides: 'poppler', required: true, usedFor: 'reading PDFs' },
  { binary: 'pdftotext', provides: 'poppler', required: true, usedFor: 'reading PDFs' },
  { binary: 'pdftohtml', provides: 'poppler', required: true, usedFor: 'reading PDFs' },
  {
    binary: 'tesseract',
    provides: 'tesseract',
    required: false,
    usedFor: 'reading card names by OCR — without it, names are left blank',
  },
];

function installHint(packages: string[]): string {
  const list = packages.join(' ');
  switch (platform()) {
    case 'darwin':
      return `brew install ${list}`;
    case 'linux':
      return `sudo apt install ${list.replace('poppler', 'poppler-utils')}`;
    default:
      return `install: ${list}`;
  }
}

async function present(binary: string): Promise<boolean> {
  try {
    await run(binary, ['-v'], { timeout: 5000 });
    return true;
  } catch (err) {
    // Most of these exit non-zero for -v but still exist; only ENOENT means
    // the binary is genuinely not on PATH.
    return (err as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

export interface Preflight {
  ok: boolean;
  message: string;
  /** warnings about optional tooling, safe to continue past */
  notes: string[];
}

export async function preflight(): Promise<Preflight> {
  const missing: Requirement[] = [];
  for (const requirement of REQUIREMENTS) {
    if (!(await present(requirement.binary))) missing.push(requirement);
  }

  const notes = missing
    .filter((m) => !m.required)
    .map((m) => `${m.binary} is not installed — ${m.usedFor}. Install with: ${installHint([m.provides])}`);

  const blocking = missing.filter((m) => m.required);
  if (blocking.length === 0) return { ok: true, message: '', notes };

  const packages = [...new Set(blocking.map((m) => m.provides))];
  const binaries = blocking.map((m) => m.binary).join(', ');
  return {
    ok: false,
    notes,
    message: [
      `Missing required command${blocking.length === 1 ? '' : 's'}: ${binaries}`,
      '',
      `hkpack reads PDFs with poppler. Install it and run again:`,
      '',
      `    ${installHint(packages)}`,
      '',
    ].join('\n'),
  };
}
