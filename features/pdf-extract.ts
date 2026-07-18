import type { PdfTextRun } from '../lib/pdf-layout';

// Thin wrapper around pdfjs-dist for TEXT EXTRACTION ONLY — no rendering, no
// canvas, no worker thread. Everything geometric happens in lib/pdf-layout.ts
// (pure, fixture-tested); this module only turns bytes into positioned runs.
//
// pdfjs is pinned to 3.11.174 deliberately: the 4.x line requires
// Promise.withResolvers, which Hermes doesn't have. The legacy build carries
// its own compat shims. Verified on Node/web; on native Hermes it is loaded
// lazily inside a try/catch, so an environment it can't run in degrades to a
// clear "use CSV instead" message rather than a crash at app startup.

export type PdfExtractResult =
  | { pages: PdfTextRun[][]; fullText: string }
  | { pdfUnsupported: true; reason: string };

export async function extractPdfRuns(data: Uint8Array): Promise<PdfExtractResult> {
  let pdfjs: any;
  try {
    // Importing pdf.worker.entry sets globalThis.pdfjsWorker, which pdf.js
    // detects and uses as an in-process "fake worker" — the documented way to
    // run without a real Worker thread, and the only way that works across
    // Metro web, Hermes, and Node alike.
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.js');
    await import('pdfjs-dist/legacy/build/pdf.worker.entry.js');
  } catch (e) {
    return { pdfUnsupported: true, reason: 'PDF reading isn’t supported on this device yet.' };
  }

  try {
    const task = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      // Text extraction needs no fonts rendered and no external resources.
      disableFontFace: true,
    });
    const doc = await task.promise;

    const pages: PdfTextRun[][] = [];
    const textParts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const runs: PdfTextRun[] = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.transform) continue;
        runs.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width ?? 0,
        });
        if (item.str.trim()) textParts.push(item.str);
      }
      pages.push(runs);
    }
    await doc.destroy();
    return { pages, fullText: textParts.join('\n') };
  } catch (e) {
    return {
      pdfUnsupported: true,
      reason: 'That PDF couldn’t be read. If it opens fine elsewhere, export a CSV from your bank instead.',
    };
  }
}
