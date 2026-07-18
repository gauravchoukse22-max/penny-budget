// pdfjs-dist ships no types for the worker-entry side module. Importing it
// only sets globalThis.pdfjsWorker (the in-process "fake worker"); it has no
// exports we use.
declare module 'pdfjs-dist/legacy/build/pdf.worker.entry.js';
