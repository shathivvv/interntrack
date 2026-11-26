// Reads the text out of a PDF *in the browser*. The file is never uploaded:
// only the extracted text is saved, through the normal PATCH /api/profile.
// That keeps "no resume upload / file storage" on the SPEC cut list true, and the
// server never has to parse an untrusted file.

export const MAX_PDF_BYTES = 5 * 1024 * 1024 // 5 MB: plenty for a resume
const MAX_PAGES = 6

// Turns pdf.js text items into plain text. Each item is a run of text;
// hasEOL marks the end of a line in the original layout.
export function itemsToText(items) {
  let text = ''
  for (const item of items) {
    if (!('str' in item)) continue // marked-content markers carry no text
    text += item.str
    if (item.hasEOL) text += '\n'
  }
  return text
}

// Tidies the joined text: no trailing spaces, at most one blank line in a row.
export function cleanText(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractPdfText(file) {
  if (file.type && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.')
  if (file.size > MAX_PDF_BYTES) throw new Error('That PDF is larger than 5 MB.')

  // Loaded only when someone actually picks a PDF, so the rest of the app stays small.
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl // parsing runs in a background worker

  // In pdf.js v6, destroy() lives on the loading task, not on the document.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const pdf = await loadingTask.promise
    if (pdf.numPages > MAX_PAGES) throw new Error(`That PDF has ${pdf.numPages} pages; a resume should be at most ${MAX_PAGES}.`)
    const pages = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      pages.push(itemsToText(content.items))
    }
    const text = cleanText(pages.join('\n\n'))
    // A scanned PDF is just pictures of text, so there's nothing to extract.
    if (text.length < 50) throw new Error("Couldn't find text in that PDF. If it's a scan, paste the text instead.")
    return text
  } finally {
    // Free the worker's memory. A failure here must never hide the real result or error.
    loadingTask.destroy().catch(() => {})
  }
}
