import type { PdfTextRun } from '../lib/pdf-layout';

// Thin wrapper around pdfjs-dist for TEXT EXTRACTION ONLY — no rendering, no
// canvas, no worker thread. Everything geometric happens in lib/pdf-layout.ts
// (pure, fixture-tested); this module only turns bytes into positioned runs.
//
// pdfjs is pinned to 3.11.174 deliberately: the 4.x line requires
// Promise.withResolvers, which Hermes doesn't have. The legacy build carries
// its own compat shims.
//
// The try/catch around the import is NOT enough on native. Metro's
// guardedLoadModule (metro-runtime require.js) wraps a lazy import's module
// evaluation in ErrorUtils.reportFatalError and does not rethrow — a throw
// during pdfjs's eval kills a release build outright and our catch never runs
// at all. That is exactly what importing a statement did on-device: pdfjs's
// bundled core-js reads `DOMException.prototype` unguarded at eval time, and
// Hermes has no DOMException. So every global pdfjs touches at eval or runtime
// must exist BEFORE the import. Verified by deleting globals one at a time in
// Node until the device error reproduced, then fixed-and-rerun on the
// simulator against a real picked PDF.

/** The two web globals pdfjs needs that Hermes doesn't provide. */
function installPdfjsGlobals(): void {
  const g = globalThis as any;
  if (typeof g.DOMException === 'undefined') {
    // Minimal but spec-shaped: name + message + legacy `code`. pdfjs only
    // constructs these for error reporting; nothing introspects deeper.
    class DOMExceptionPolyfill extends Error {
      code: number;
      constructor(message = '', name = 'Error') {
        super(message);
        this.name = name;
        this.code = 0;
      }
    }
    g.DOMException = DOMExceptionPolyfill;
  }
  if (typeof g.ReadableStream === 'undefined') {
    // A real implementation, not a stub — getTextContent() streams its data
    // through one. Loaded lazily so the ~50KB ponyfill costs nothing until the
    // first PDF import, and only assigned when actually missing (web and Node
    // keep their native streams).
    const streams = require('web-streams-polyfill/ponyfill');
    g.ReadableStream = streams.ReadableStream;
    g.WritableStream = streams.WritableStream;
    g.TransformStream = streams.TransformStream;
  }
}

export type PdfExtractResult =
  | { pages: PdfTextRun[][]; fullText: string }
  | { pdfUnsupported: true; reason: string };

export async function extractPdfRuns(data: Uint8Array): Promise<PdfExtractResult> {
  let pdfjs: any;
  try {
    installPdfjsGlobals();
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
