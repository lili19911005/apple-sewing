import { PDFDocument } from 'pdf-lib'

const MM_TO_PT = 72 / 25.4

export type StitchPage = {
  fileIndex: number
  pageIndex: number
  crop: { left: number; right: number; top: number; bottom: number }
}

export type StitchOptions = {
  direction?: 'horizontal' | 'vertical'
  perLine?: number
  pages?: StitchPage[]
  horizontalGapMm?: number
  verticalGapMm?: number
}

export async function mergePdfs(
  files: File[],
  layout: 'sequence' | 'sheet' = 'sequence',
  columns = 0,
  gapMm = 0,
  stitchOptions: StitchOptions = {},
) {
  const output = await PDFDocument.create()
  if (layout === 'sheet') {
    const sources = await Promise.all(files.map(async (file) => PDFDocument.load(await file.arrayBuffer())))
    const requestedPages = stitchOptions.pages?.length
      ? stitchOptions.pages
      : sources.flatMap((source, fileIndex) => source.getPageIndices().map((pageIndex) => ({
        fileIndex, pageIndex, crop: { left: 0, right: 0, top: 0, bottom: 0 },
      })))
    const embedded = []
    for (const item of requestedPages) {
      const sourcePage = sources[item.fileIndex]?.getPage(item.pageIndex)
      if (!sourcePage) continue
      const crop = item.crop ?? { left: 0, right: 0, top: 0, bottom: 0 }
      const left = Math.max(0, crop.left * MM_TO_PT)
      const bottom = Math.max(0, crop.bottom * MM_TO_PT)
      const right = Math.max(left + 1, sourcePage.getWidth() - Math.max(0, crop.right * MM_TO_PT))
      const top = Math.max(bottom + 1, sourcePage.getHeight() - Math.max(0, crop.top * MM_TO_PT))
      embedded.push(await output.embedPage(sourcePage, { left, bottom, right, top }))
    }
    if (!embedded.length) throw new Error('PDF 中没有可拼合的页面。')
    const direction = stitchOptions.direction ?? 'horizontal'
    const perLine = Math.max(1, stitchOptions.perLine || columns || Math.ceil(Math.sqrt(embedded.length)))
    const columnCount = direction === 'horizontal' ? Math.min(perLine, embedded.length) : Math.ceil(embedded.length / perLine)
    const rowCount = direction === 'vertical' ? Math.min(perLine, embedded.length) : Math.ceil(embedded.length / perLine)
    const cellWidth = Math.max(...embedded.map((page) => page.width))
    const cellHeight = Math.max(...embedded.map((page) => page.height))
    const horizontalTighten = Math.max(0, stitchOptions.horizontalGapMm ?? gapMm) * MM_TO_PT
    const verticalTighten = Math.max(0, stitchOptions.verticalGapMm ?? gapMm) * MM_TO_PT
    const columnStep = Math.max(1, cellWidth - horizontalTighten)
    const rowStep = Math.max(1, cellHeight - verticalTighten)
    const sheet = output.addPage([
      cellWidth + columnStep * Math.max(0, columnCount - 1),
      cellHeight + rowStep * Math.max(0, rowCount - 1),
    ])
    embedded.forEach((item, index) => {
      const column = direction === 'horizontal' ? index % columnCount : Math.floor(index / rowCount)
      const row = direction === 'vertical' ? index % rowCount : Math.floor(index / columnCount)
      sheet.drawPage(item, {
        x: column * columnStep + (cellWidth - item.width) / 2,
        y: (rowCount - row - 1) * rowStep + (cellHeight - item.height) / 2,
        width: item.width,
        height: item.height,
      })
    })
    return output.save()
  }
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer())
    const pages = await output.copyPages(source, source.getPageIndices())
    pages.forEach((page) => output.addPage(page))
  }
  return output.save()
}
