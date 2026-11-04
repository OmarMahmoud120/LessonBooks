import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
try {
  const pdf = await getDocument({
    data: new Uint8Array(workerData.bytes),
    stopAtErrors: true,
    maxImageSize: 16000000,
    verbosity: 0,
  }).promise;
  try {
    if (pdf.numPages < 1 || pdf.numPages > 30) throw new Error('page_limit');
    if (await pdf.getJSActions()) throw new Error('active_pdf_rejected');
    const pages = [];
    let total = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      total += text.length;
      if (total > 60000) throw new Error('extracted_text_limit');
      pages.push({ page, text });
    }
    parentPort.postMessage({ pages });
  } finally {
    await pdf.destroy();
  }
} catch (error) {
  const safe = ['page_limit', 'active_pdf_rejected', 'extracted_text_limit'];
  parentPort.postMessage({
    error: safe.includes(error.message) ? error.message : 'parser_rejected_pdf',
  });
}
