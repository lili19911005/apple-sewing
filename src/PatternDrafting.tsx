import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, FileDown, RotateCcw, Ruler, Save, Shirt, SlidersHorizontal } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { downloadBlob } from './converters'

type Measurements = {
  bust: number
  waist: number
  neck: number
  shoulder: number
  backLength: number
  armLength: number
  upperArm: number
}

type DraftProps = {
  onSavePattern: (file: File, title: string, size: string) => Promise<void>
}

const defaults: Measurements = { bust: 84, waist: 68, neck: 36, shoulder: 38, backLength: 40, armLength: 56, upperArm: 28 }

const easePresets = {
  fitted: { label: '梭织合体', bust: 5, waist: 3, arm: 5 },
  relaxed: { label: '梭织宽松', bust: 12, waist: 10, arm: 8 },
  knit: { label: '针织弹力', bust: 0, waist: 0, arm: 3 },
}

function number(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

const measurementLimits: Record<keyof Measurements, { min: number; max: number }> = {
  bust: { min: 50, max: 180 }, waist: { min: 45, max: 170 }, neck: { min: 25, max: 70 },
  shoulder: { min: 25, max: 65 }, backLength: { min: 25, max: 75 }, armLength: { min: 35, max: 85 },
  upperArm: { min: 15, max: 65 },
}

export default function PatternDrafting({ onSavePattern }: DraftProps) {
  const [measurements, setMeasurements] = useState(defaults)
  const [preset, setPreset] = useState<keyof typeof easePresets>('fitted')
  const [size, setSize] = useState('M')
  const [seamAllowance, setSeamAllowance] = useState(1)
  const [saving, setSaving] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const ease = easePresets[preset]

  const draft = useMemo(() => {
    const quarterBust = Math.max(12, (measurements.bust + ease.bust) / 4)
    const quarterWaist = Math.max(10, (measurements.waist + ease.waist) / 4)
    const neckWidth = measurements.neck / 5 + 0.3
    const frontNeckDepth = measurements.neck / 5 + 1.5
    const armholeDepth = measurements.bust / 6 + 7.5
    const shoulderHalf = Math.max(10, measurements.shoulder / 2)
    const waistSuppression = Math.max(0, quarterBust - quarterWaist)
    const dart = Math.min(4.5, Math.max(1.5, waistSuppression * 0.55))
    const sleeveWidth = Math.max(12, measurements.upperArm + ease.arm)
    const sleeveCap = armholeDepth * 0.43
    const backX = 5
    const frontX = backX + quarterBust + 14
    const sleeveX = frontX + quarterBust + 16
    const top = 7
    const totalWidth = sleeveX + sleeveWidth + 8
    const waistY = top + measurements.backLength
    const bustY = top + Math.min(measurements.backLength * 0.56, armholeDepth + 8)
    const dartX = frontX + quarterWaist * 0.54
    const dartTipY = bustY + 2
    const totalHeight = Math.max(waistY + 18, measurements.armLength + sleeveCap + 15)
    return { quarterBust, quarterWaist, neckWidth, frontNeckDepth, armholeDepth, shoulderHalf, waistSuppression, dart, sleeveWidth, sleeveCap, backX, frontX, sleeveX, top, waistY, bustY, dartX, dartTipY, totalWidth, totalHeight }
  }, [measurements, ease])

  const validation = useMemo(() => {
    const messages: { ok: boolean; text: string }[] = []
    messages.push({ ok: measurements.bust > measurements.waist, text: measurements.bust > measurements.waist ? '胸腰尺寸关系正常' : '胸围通常应大于腰围，请检查输入' })
    messages.push({ ok: draft.waistSuppression <= 7, text: draft.waistSuppression <= 7 ? `单侧收腰量 ${draft.waistSuppression.toFixed(1)} cm` : '收腰量过大，建议增加省道或分割线' })
    messages.push({ ok: draft.armholeDepth > 18 && draft.armholeDepth < 27, text: `袖窿深 ${draft.armholeDepth.toFixed(1)} cm${draft.armholeDepth > 18 && draft.armholeDepth < 27 ? '，处于常用范围' : '，建议复核'}` })
    messages.push({ ok: ease.arm >= 2, text: `袖肥松量 ${ease.arm.toFixed(1)} cm` })
    messages.push({ ok: measurements.shoulder < measurements.bust * 0.58, text: measurements.shoulder < measurements.bust * 0.58 ? '肩宽与胸围比例正常' : '肩宽偏大，建议复核肩宽输入' })
    return messages
  }, [measurements, draft, ease])

  function update(field: keyof Measurements, value: number) {
    const { min, max } = measurementLimits[field]
    setMeasurements((old) => ({ ...old, [field]: Math.min(max, Math.max(min, number(value))) }))
  }

  function resetDraft() {
    setMeasurements(defaults)
    setPreset('fitted')
    setSize('M')
    setSeamAllowance(1)
  }

  function updateSeamAllowance(value: number) {
    setSeamAllowance(Math.min(5, Math.max(0, Number.isFinite(value) ? value : 0)))
  }

  function downloadParameters() {
    const payload = { type: '女装基础上衣原型', size, measurements, easePreset: easePresets[preset], seamAllowance, exportedAt: new Date().toISOString() }
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `女装基础上衣原型-${size}-参数.json`, 'application/json')
  }

  function serializeSvg() {
    if (!svgRef.current) throw new Error('版型预览尚未生成。')
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', `${draft.totalWidth}cm`)
    clone.setAttribute('height', `${draft.totalHeight}cm`)
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
    style.textContent = `.draft-grid line{stroke:#dce4dc;stroke-width:.08}.draft-main-lines path,.draft-main-lines line{fill:#fff;stroke:#145c43;stroke-width:.28;stroke-linejoin:round;stroke-linecap:round}.draft-main-lines line{fill:none}.seam-lines path{fill:none;stroke:#d28b42;stroke-width:calc(var(--seam) * 2);stroke-dasharray:1.4 1;stroke-linejoin:round;opacity:.75}.grain-lines line{stroke:#80958a;stroke-width:.16;stroke-dasharray:1.2 .8}.draft-labels text,.draft-dimensions text{fill:#52685b;font-family:Arial,sans-serif;font-size:1.7px}.draft-dimensions line{stroke:#a7b8aa;stroke-width:.12}`
    clone.prepend(style)
    return new XMLSerializer().serializeToString(clone)
  }

  function downloadSvg() {
    downloadBlob(new Blob([serializeSvg()], { type: 'image/svg+xml' }), `女装基础上衣原型-${size}.svg`, 'image/svg+xml')
  }

  async function createPdfFile() {
    const svg = serializeSvg()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const image = new Image()
    image.src = url
    await image.decode()
    const pixelsPerCm = 40
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(draft.totalWidth * pixelsPerCm)
    canvas.height = Math.ceil(draft.totalHeight * pixelsPerCm)
    const context = canvas.getContext('2d')!
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    URL.revokeObjectURL(url)
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('版型图像生成失败。')), 'image/png'))
    const pdf = await PDFDocument.create()
    const embedded = await pdf.embedPng(await png.arrayBuffer())
    const cmToPt = 72 / 2.54
    const page = pdf.addPage([draft.totalWidth * cmToPt, draft.totalHeight * cmToPt])
    page.drawImage(embedded, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() })
    return new File([new Uint8Array(await pdf.save()).buffer], `女装基础上衣原型-${size}.pdf`, { type: 'application/pdf' })
  }

  async function downloadPdf() {
    const file = await createPdfFile()
    downloadBlob(file, file.name, 'application/pdf')
  }

  async function savePattern() {
    setSaving(true)
    try { await onSavePattern(await createPdfFile(), '女装基础上衣原型', size) }
    finally { setSaving(false) }
  }

  const d = draft
  const backPath = `M ${d.backX} ${d.top + 2.2} Q ${d.backX + d.neckWidth * .45} ${d.top} ${d.backX + d.neckWidth} ${d.top} L ${d.backX + d.shoulderHalf} ${d.top + 2.8} C ${d.backX + d.shoulderHalf + 1} ${d.top + 7} ${d.backX + d.quarterBust} ${d.top + d.armholeDepth - 5} ${d.backX + d.quarterBust} ${d.top + d.armholeDepth} L ${d.backX + d.quarterWaist + 1} ${d.waistY} L ${d.backX} ${d.waistY} Z`
  const frontPath = `M ${d.frontX} ${d.top + d.frontNeckDepth} Q ${d.frontX + d.neckWidth * .25} ${d.top + 1} ${d.frontX + d.neckWidth} ${d.top} L ${d.frontX + d.shoulderHalf} ${d.top + 2.8} C ${d.frontX + d.shoulderHalf + 2} ${d.top + 8} ${d.frontX + d.quarterBust} ${d.top + d.armholeDepth - 4} ${d.frontX + d.quarterBust} ${d.top + d.armholeDepth} L ${d.frontX + d.quarterWaist + 1} ${d.waistY} L ${d.frontX} ${d.waistY} Z`
  const sleevePath = `M ${d.sleeveX} ${d.top + d.sleeveCap} C ${d.sleeveX + d.sleeveWidth * .18} ${d.top + 2} ${d.sleeveX + d.sleeveWidth * .38} ${d.top} ${d.sleeveX + d.sleeveWidth / 2} ${d.top} C ${d.sleeveX + d.sleeveWidth * .68} ${d.top} ${d.sleeveX + d.sleeveWidth * .88} ${d.top + 3} ${d.sleeveX + d.sleeveWidth} ${d.top + d.sleeveCap} L ${d.sleeveX + d.sleeveWidth * .76} ${d.top + d.sleeveCap + measurements.armLength} L ${d.sleeveX + d.sleeveWidth * .24} ${d.top + d.sleeveCap + measurements.armLength} Z`

  return <div className="drafting-module">
    <div className="drafting-toolbar"><div><span className="kicker">PARAMETRIC PATTERN</span><h3>女装基础上衣原型</h3><p>输入净尺寸后实时生成前片、后片和一片袖；图纸单位为 cm。</p></div><div className="drafting-actions"><button onClick={resetDraft}><RotateCcw size={15} /> 重置</button><button onClick={downloadParameters}><FileDown size={15} /> 参数</button><button onClick={downloadSvg}><Download size={15} /> SVG</button><button onClick={downloadPdf}><Download size={15} /> 1:1 PDF</button><button className="primary" disabled={saving} onClick={savePattern}><Save size={15} /> {saving ? '保存中' : '存入纸样库'}</button></div></div>
    <div className="drafting-layout">
      <aside className="drafting-panel">
        <div className="draft-section-title"><Ruler /> 人体净尺寸 <small>单位：cm</small></div>
        <div className="measurement-grid">
          {([['bust', '胸围'], ['waist', '腰围'], ['neck', '颈围'], ['shoulder', '肩宽'], ['backLength', '背长'], ['armLength', '袖长'], ['upperArm', '臂围']] as [keyof Measurements, string][]).map(([field, label]) => <label key={field}>{label}<input type="number" min={measurementLimits[field].min} max={measurementLimits[field].max} step="0.1" value={measurements[field]} onChange={(event) => update(field, Number(event.target.value))} /></label>)}
          <label>尺码<input value={size} onChange={(event) => setSize(event.target.value.toUpperCase())} /></label>
        </div>
        <div className="draft-section-title"><Shirt /> 面料与合体度</div>
        <div className="draft-preset-list">{Object.entries(easePresets).map(([key, item]) => <button key={key} className={preset === key ? 'selected' : ''} onClick={() => setPreset(key as keyof typeof easePresets)}><b>{item.label}</b><small>胸围松量 {item.bust} · 腰围松量 {item.waist}</small></button>)}</div>
        <div className="draft-section-title"><SlidersHorizontal /> 工艺参数</div>
        <label className="seam-field">缝份宽度<div className="number-input"><input type="number" min="0" max="5" step="0.1" value={seamAllowance} onChange={(event) => updateSeamAllowance(Number(event.target.value))} /><span>cm</span></div></label>
        <div className="draft-calculations"><b>关键计算</b><span>1/4 成衣胸围：{d.quarterBust.toFixed(1)} cm</span><span>1/4 成衣腰围：{d.quarterWaist.toFixed(1)} cm</span><span>袖窿深：{d.armholeDepth.toFixed(1)} cm</span><span>胸省参考量：{d.dart.toFixed(1)} cm</span></div>
      </aside>
      <div className="drafting-preview">
        <svg ref={svgRef} viewBox={`0 0 ${d.totalWidth} ${d.totalHeight}`} aria-label="女装基础上衣版型预览">
          <rect width={d.totalWidth} height={d.totalHeight} fill="#fff" />
          <g className="draft-grid">{Array.from({ length: Math.ceil(d.totalWidth / 5) }).map((_, i) => <line key={`v${i}`} x1={i * 5} y1="0" x2={i * 5} y2={d.totalHeight} />)}{Array.from({ length: Math.ceil(d.totalHeight / 5) }).map((_, i) => <line key={`h${i}`} x1="0" y1={i * 5} x2={d.totalWidth} y2={i * 5} />)}</g>
          <g className="seam-lines" style={{ '--seam': seamAllowance } as React.CSSProperties}><path d={backPath} /><path d={frontPath} /><path d={sleevePath} /></g>
          <g className="draft-main-lines"><path d={backPath} /><path d={frontPath} /><path d={sleevePath} /><path d={`M ${d.dartX - d.dart / 2} ${d.waistY} L ${d.dartX} ${d.dartTipY} L ${d.dartX + d.dart / 2} ${d.waistY}`} /><line x1={d.backX} y1={d.waistY} x2={d.backX + d.quarterBust + 2} y2={d.waistY} className="waist-line" /></g>
          <g className="grain-lines"><line x1={d.backX + d.quarterBust * .42} y1={d.top + 10} x2={d.backX + d.quarterBust * .42} y2={d.top + measurements.backLength - 5} /><line x1={d.frontX + d.quarterBust * .44} y1={d.top + 13} x2={d.frontX + d.quarterBust * .44} y2={d.top + measurements.backLength - 5} /><line x1={d.sleeveX + d.sleeveWidth / 2} y1={d.top + d.sleeveCap + 8} x2={d.sleeveX + d.sleeveWidth / 2} y2={d.top + d.sleeveCap + measurements.armLength - 5} /></g>
          <g className="draft-dimensions"><line x1={d.backX} y1={d.waistY + 5} x2={d.backX + d.quarterWaist + 1} y2={d.waistY + 5} /><text x={d.backX + 1} y={d.waistY + 9}>1/4 腰围 {d.quarterWaist.toFixed(1)}</text><line x1={d.backX + d.quarterBust + 4} y1={d.top} x2={d.backX + d.quarterBust + 4} y2={d.waistY} /><text x={d.backX + d.quarterBust + 6} y={d.top + 18} transform={`rotate(90 ${d.backX + d.quarterBust + 6} ${d.top + 18})`}>背长 {measurements.backLength.toFixed(1)}</text></g>
          <g className="draft-labels"><text x={d.backX + 2} y={d.waistY - 2}>后片 · 对折裁 1</text><text x={d.frontX + 2} y={d.waistY - 2}>前片 · 对折裁 1</text><text x={d.sleeveX + d.sleeveWidth * .3} y={d.top + d.sleeveCap + measurements.armLength - 3}>一片袖 · 裁 2</text><text x={d.backX} y={d.top - 2}>SIZE {size} · 缝份 {seamAllowance}cm</text></g>
        </svg>
      </div>
      <aside className="draft-validation"><h4>版型检查</h4>{validation.map((item, index) => <div className={item.ok ? 'valid' : 'warning'} key={index}>{item.ok ? <Check /> : <AlertTriangle />}<span>{item.text}</span></div>)}<p>当前为基础原型建议值。正式裁剪前请制作坯样并校正肩斜、袖窿、省量及面料弹性。</p></aside>
    </div>
  </div>
}
