import * as pdfjs from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
export { mergePdfs } from './pdfCore'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker

export type PdfPagePreview = {
  id: string
  fileIndex: number
  pageIndex: number
  fileName: string
  pageNumber: number
  widthPt: number
  heightPt: number
  preview: string
}

export async function renderPdfPages(files: File[], scale = 0.55): Promise<PdfPagePreview[]> {
  const result: PdfPagePreview[] = []
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const source = new Uint8Array(await files[fileIndex].arrayBuffer())
    const pdf = await pdfjs.getDocument({ data: source }).promise
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const page = await pdf.getPage(pageIndex + 1)
      const baseViewport = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      const context = canvas.getContext('2d')!
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport, canvas }).promise
      result.push({
        id: `${fileIndex}-${pageIndex}-${files[fileIndex].name}-${files[fileIndex].lastModified}`,
        fileIndex,
        pageIndex,
        fileName: files[fileIndex].name,
        pageNumber: pageIndex + 1,
        widthPt: baseViewport.width,
        heightPt: baseViewport.height,
        preview: canvas.toDataURL('image/jpeg', 0.72),
      })
    }
  }
  return result
}

export async function renderPdfCover(file: File) {
  const source = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: source }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 0.7 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport, canvas }).promise
  return { preview: canvas.toDataURL('image/jpeg', 0.74), pageCount: pdf.numPages }
}

export function downloadBlob(data: Uint8Array | Blob, filename: string, type: string) {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data).buffer], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function pdfToPlt(file: File, quality = 2) {
  const source = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: source }).promise
  const lines: string[] = ['IN;', 'SP1;']

  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1.3 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    await page.render({ canvasContext: context, viewport, canvas }).promise
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const step = Math.max(2, 7 - quality)
    const scale = 1016 / (96 * 1.3)
    lines.push(`CO "PAGE ${pageNo}";`)

    for (let y = step; y < canvas.height - step; y += step) {
      let drawing = false
      for (let x = step; x < canvas.width - step; x += step) {
        const i = (y * canvas.width + x) * 4
        const left = (y * canvas.width + x - step) * 4
        const gray = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
        const grayLeft = (pixels[left] + pixels[left + 1] + pixels[left + 2]) / 3
        const edge = Math.abs(gray - grayLeft) > 55 && gray < 210
        const px = Math.round(x * scale)
        const py = Math.round((canvas.height - y) * scale)
        if (edge && !drawing) {
          lines.push(`PU${px},${py};PD;`)
          drawing = true
        } else if (!edge && drawing) {
          lines.push(`PU${px},${py};`)
          drawing = false
        } else if (edge && drawing) {
          lines.push(`PA${px},${py};`)
        }
      }
      if (drawing) lines.push('PU;')
    }
  }
  lines.push('SP0;')
  return new Blob([lines.join('\n')], { type: 'application/vnd.hp-hpgl' })
}

async function bitmapFromFile(file: File) {
  return createImageBitmap(file)
}

type FabricMockupOptions = { seeds: { x: number; y: number }[]; tolerance?: number; fabricMode?: 'solid' | 'pattern' }

function yCbCr(r: number, g: number, b: number) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  }
}

function erodeMask(input: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(input.length)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x
    let keep = 1
    for (let dy = -1; dy <= 1 && keep; dy++) for (let dx = -1; dx <= 1; dx++) if (!input[index + dy * width + dx]) { keep = 0; break }
    output[index] = keep
  }
  return output
}

function dilateMask(input: Uint8Array, width: number, height: number) {
  const output = new Uint8Array(input.length)
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x
    let keep = 0
    for (let dy = -1; dy <= 1 && !keep; dy++) for (let dx = -1; dx <= 1; dx++) if (input[index + dy * width + dx]) { keep = 1; break }
    output[index] = keep
  }
  return output
}

function smartGarmentMask(source: ImageData, width: number, height: number, seeds: { x: number; y: number }[], tolerance = 8) {
  const combined = new Uint8Array(width * height)
  for (const seedPoint of seeds) {
    const seedX = Math.max(0, Math.min(width - 1, Math.round(seedPoint.x * (width - 1))))
    const seedY = Math.max(0, Math.min(height - 1, Math.round(seedPoint.y * (height - 1))))
    const seedOffset = (seedY * width + seedX) * 4
    const seed = yCbCr(source.data[seedOffset], source.data[seedOffset + 1], source.data[seedOffset + 2])
    const candidate = new Uint8Array(width * height)
    const minX = Math.max(0, Math.floor(seedX - width * 0.34))
    const maxX = Math.min(width - 1, Math.ceil(seedX + width * 0.34))
    const minY = Math.max(0, Math.floor(seedY - height * 0.36))
    const maxY = Math.min(height - 1, Math.ceil(seedY + height * 0.55))
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const pixel = y * width + x
      const offset = pixel * 4
      const color = yCbCr(source.data[offset], source.data[offset + 1], source.data[offset + 2])
      const likelySkin = color.y > 65 && color.cb >= 82 && color.cb <= 123 && color.cr >= 148 && color.cr <= 180
      if (!likelySkin && source.data[offset + 3] > 30 && color.y >= Math.max(25, seed.y * 0.4) && Math.hypot(color.cb - seed.cb, color.cr - seed.cr) <= tolerance) candidate[pixel] = 1
    }
    let opened = erodeMask(erodeMask(candidate, width, height), width, height)
    opened = dilateMask(dilateMask(opened, width, height), width, height)
    let start = seedY * width + seedX
    if (!opened[start]) {
      let found = -1
      for (let radius = 1; radius <= 16 && found < 0; radius++) for (let dy = -radius; dy <= radius && found < 0; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const x = seedX + dx; const y = seedY + dy
        if (x >= 0 && x < width && y >= 0 && y < height && opened[y * width + x]) { found = y * width + x; break }
      }
      if (found < 0) continue
      start = found
    }
    const visited = new Uint8Array(width * height)
    const queue = new Int32Array(width * height)
    let head = 0; let tail = 0
    queue[tail++] = start; visited[start] = 1
    while (head < tail) {
      const pixel = queue[head++]
      combined[pixel] = 1
      const x = pixel % width; const y = Math.floor(pixel / width)
      const neighbors = [x > 0 ? pixel - 1 : -1, x + 1 < width ? pixel + 1 : -1, y > 0 ? pixel - width : -1, y + 1 < height ? pixel + width : -1]
      for (const next of neighbors) if (next >= 0 && opened[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next }
    }
  }
  return combined
}

export async function createGarmentMaskPreview(styleFile: File, seeds: { x: number; y: number }[], tolerance = 8) {
  if (!seeds.length) return null
  const style = await bitmapFromFile(styleFile)
  const ratio = Math.min(1, 1000 / Math.max(style.width, style.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(style.width * ratio)); canvas.height = Math.max(1, Math.round(style.height * ratio))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(style, 0, 0, canvas.width, canvas.height)
  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  const selected = smartGarmentMask(source, canvas.width, canvas.height, seeds, tolerance)
  const overlay = context.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < selected.length; i++) if (selected[i]) { const offset = i * 4; overlay.data[offset] = 20; overlay.data[offset + 1] = 150; overlay.data[offset + 2] = 95; overlay.data[offset + 3] = 105 }
  context.clearRect(0, 0, canvas.width, canvas.height); context.putImageData(overlay, 0, 0)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('选区预览生成失败。')), 'image/png'))
}

export async function createFabricMockup(styleFile: File, fabricFile: File, textureScale = 1, strength = 78, options?: FabricMockupOptions) {
  const [style, fabric] = await Promise.all([bitmapFromFile(styleFile), bitmapFromFile(fabricFile)])
  const maxSide = 1400
  const ratio = Math.min(1, maxSide / Math.max(style.width, style.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(style.width * ratio))
  canvas.height = Math.max(1, Math.round(style.height * ratio))
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(style, 0, 0, canvas.width, canvas.height)

  const source = context.getImageData(0, 0, canvas.width, canvas.height)
  const seeds = options?.seeds ?? []
  if (!seeds.length) throw new Error('请在衣服主体上点击至少一个取样点。')
  const hardMask = document.createElement('canvas')
  hardMask.width = canvas.width
  hardMask.height = canvas.height
  const hardMaskContext = hardMask.getContext('2d', { willReadFrequently: true })!
  const selectedPixels = smartGarmentMask(source, canvas.width, canvas.height, seeds, options?.tolerance ?? 8)
  const mask = hardMaskContext.createImageData(canvas.width, canvas.height)
  let selectedCount = 0
  for (let pixel = 0; pixel < selectedPixels.length; pixel++) if (selectedPixels[pixel]) {
    const offset = pixel * 4
    mask.data[offset] = mask.data[offset + 1] = mask.data[offset + 2] = 255
    mask.data[offset + 3] = 255
    selectedCount++
  }
  if (selectedCount < canvas.width * canvas.height * 0.002) throw new Error('智能选区太小，请点击衣服中间的大块纯色区域，或适当调大识别范围。')

  const texture = document.createElement('canvas')
  texture.width = canvas.width
  texture.height = canvas.height
  const textureContext = texture.getContext('2d')!
  const tileSize = Math.max(48, Math.round(220 * textureScale))
  const fabricCropSide = Math.max(1, Math.round(Math.min(fabric.width, fabric.height) * 0.48))
  const fabricCropX = Math.max(0, Math.round((fabric.width - fabricCropSide) / 2))
  const fabricCropY = Math.max(0, Math.round((fabric.height - fabricCropSide) * 0.52))
  const fabricTile = document.createElement('canvas')
  fabricTile.width = fabricTile.height = tileSize
  const fabricTileContext = fabricTile.getContext('2d', { willReadFrequently: true })!
  fabricTileContext.drawImage(fabric, fabricCropX, fabricCropY, fabricCropSide, fabricCropSide, 0, 0, tileSize, tileSize)
  if (options?.fabricMode !== 'pattern') {
    const tilePixels = fabricTileContext.getImageData(0, 0, tileSize, tileSize)
    let red = 0
    let green = 0
    let blue = 0
    let count = 0
    for (let i = 0; i < tilePixels.data.length; i += 4) {
      const color = yCbCr(tilePixels.data[i], tilePixels.data[i + 1], tilePixels.data[i + 2])
      if (color.y < 20 || color.y > 245) continue
      red += tilePixels.data[i]
      green += tilePixels.data[i + 1]
      blue += tilePixels.data[i + 2]
      count++
    }
    fabricTileContext.fillStyle = `rgb(${Math.round(red / Math.max(1, count))}, ${Math.round(green / Math.max(1, count))}, ${Math.round(blue / Math.max(1, count))})`
    fabricTileContext.fillRect(0, 0, tileSize, tileSize)
  }
  for (let y = 0; y < texture.height; y += tileSize) {
    for (let x = 0; x < texture.width; x += tileSize) {
      textureContext.drawImage(fabricTile, x, y)
    }
  }
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = canvas.width
  maskCanvas.height = canvas.height
  hardMask.getContext('2d')!.putImageData(mask, 0, 0)
  const maskContext = maskCanvas.getContext('2d')!
  maskContext.filter = 'blur(1.2px)'
  maskContext.drawImage(hardMask, 0, 0)
  textureContext.globalCompositeOperation = 'destination-in'
  textureContext.drawImage(maskCanvas, 0, 0)

  context.save()
  context.globalAlpha = Math.max(0.1, Math.min(1, strength / 100))
  context.globalCompositeOperation = 'source-over'
  context.drawImage(texture, 0, 0)
  context.restore()

  const shading = document.createElement('canvas')
  shading.width = canvas.width
  shading.height = canvas.height
  const shadingContext = shading.getContext('2d')!
  const shadeData = shadingContext.createImageData(canvas.width, canvas.height)
  for (let i = 0; i < source.data.length; i += 4) {
    const light = Math.max(35, Math.min(245, 0.299 * source.data[i] + 0.587 * source.data[i + 1] + 0.114 * source.data[i + 2]))
    shadeData.data[i] = shadeData.data[i + 1] = shadeData.data[i + 2] = light
    shadeData.data[i + 3] = mask.data[i + 3]
  }
  shadingContext.putImageData(shadeData, 0, 0)
  shadingContext.globalCompositeOperation = 'destination-in'
  shadingContext.drawImage(maskCanvas, 0, 0)
  context.save()
  context.globalAlpha = 0.72
  context.globalCompositeOperation = 'multiply'
  context.drawImage(shading, 0, 0)
  context.restore()

  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('效果图生成失败。')),
    'image/png',
  ))
}
