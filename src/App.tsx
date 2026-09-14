import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, BookOpen, Check, Database, Download, FileImage, Files, FileText, FileUp,
  GripVertical, ImagePlus, LockKeyhole, LogOut, Menu, PackagePlus, Palette, Plus,
  RefreshCw, Ruler, Save, Scissors, ShieldCheck, Sparkles, Trash2, UploadCloud, User,
  WandSparkles, X, Zap,
} from 'lucide-react'
import {
  createFabricMockup, createGarmentMaskPreview, downloadBlob, mergePdfs, pdfToPlt,
  renderPdfCover, renderPdfPages, type PdfPagePreview,
} from './converters'
import { deletePatternFile, getPatternFile, savePatternFile } from './patternLibrary'
import PatternDrafting from './PatternDrafting'

type ToolId = 'merge' | 'draft' | 'mockup' | 'pattern' | 'fabric'
type UserInfo = { name: string; email: string }
type FabricRecord = { id: string; name: string; image: string; length: number; material: string; source: string; createdAt: string }
type PatternRecord = { id: string; title: string; size: string; fileName: string; cover: string; pageCount: number; fileSize: number; createdAt: string }
type PatternMigrationItem = PatternRecord & { fileData: string; fileType: string }
type CropMargins = { left: number; right: number; top: number; bottom: number }
type EditablePdfPage = PdfPagePreview & { crop: CropMargins }

const tools = [
  { id: 'merge' as const, number: '01', title: 'PDF 拼合 / 转 PLT', description: '分页纸样拼成大图、顺序合并，或提取线稿生成 HPGL/PLT。', icon: Files, accept: '.pdf,application/pdf', multiple: true, tag: '常用' },
  { id: 'draft' as const, number: '02', title: '参数化服装制版', description: '输入人体净尺寸与面料类型，生成女装基础上衣前后片和一片袖。', icon: Ruler, accept: '', multiple: false, tag: '制版' },
  { id: 'mockup' as const, number: '03', title: '样式 × 布料效果图', description: '点击衣服主体并上传布料图，生成保留褶皱明暗的换布效果。', icon: Palette, accept: 'image/png,image/jpeg,image/webp', multiple: false, tag: '智能' },
  { id: 'pattern' as const, number: '04', title: '我的纸样库', description: '批量导入纸样 PDF，自动识别纸样标题、尺码并管理款式首图。', icon: BookOpen, accept: '.pdf,application/pdf', multiple: true, tag: '归档' },
  { id: 'fabric' as const, number: '05', title: '我的布料库', description: '批量导入布料图片，记录长度、材质、来源并随时复用。', icon: Database, accept: 'image/png,image/jpeg,image/webp', multiple: true, tag: '管理' },
]

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function readDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败。'))
    reader.readAsDataURL(file)
  })
}

async function thumbnail(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 520 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('缩略图生成失败。')), 'image/jpeg', 0.8,
  ))
  return readDataUrl(blob)
}

function dataUrlToFile(dataUrl: string, name: string) {
  const [meta, data] = dataUrl.split(',')
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/jpeg'
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
  return new File([bytes], name, { type: mime })
}

function blobToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('纸样文件读取失败。'))
    reader.readAsDataURL(file)
  })
}

function patternInfoFromFilename(fileName: string) {
  const base = fileName.replace(/\.pdf$/i, '').trim()
  const match = base.match(/[-_－—]\s*([A-Za-z]{1,4}|\d{2,3}(?:\/[A-Za-z0-9]+)?)$/)
  return match
    ? { title: base.slice(0, match.index).trim(), size: match[1].toUpperCase() }
    : { title: base, size: '未标注' }
}

function App() {
  const [activeTool, setActiveTool] = useState<ToolId>('merge')
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [mergeMode, setMergeMode] = useState<'sheet' | 'sequence' | 'plt'>('sheet')
  const [mergeColumns, setMergeColumns] = useState(4)
  const [mergeHorizontalGap, setMergeHorizontalGap] = useState(0)
  const [mergeVerticalGap, setMergeVerticalGap] = useState(0)
  const [stitchDirection, setStitchDirection] = useState<'horizontal' | 'vertical'>('horizontal')
  const [pdfPages, setPdfPages] = useState<EditablePdfPage[]>([])
  const [pdfEditorTab, setPdfEditorTab] = useState<'preview' | 'order' | 'crop'>('preview')
  const [selectedPdfPage, setSelectedPdfPage] = useState('')
  const [isLoadingPages, setIsLoadingPages] = useState(false)
  const [quality, setQuality] = useState(2)
  const [styleFile, setStyleFile] = useState<File | null>(null)
  const [fabricFile, setFabricFile] = useState<File | null>(null)
  const [stylePreview, setStylePreview] = useState('')
  const [fabricPreview, setFabricPreview] = useState('')
  const [mockupResult, setMockupResult] = useState<Blob | null>(null)
  const [mockupPreview, setMockupPreview] = useState('')
  const [textureScale, setTextureScale] = useState(1)
  const [textureStrength, setTextureStrength] = useState(78)
  const [fabricMode, setFabricMode] = useState<'solid' | 'pattern'>('solid')
  const [garmentPoints, setGarmentPoints] = useState<{ x: number; y: number }[]>([])
  const [garmentMaskPreview, setGarmentMaskPreview] = useState('')
  const [garmentTolerance, setGarmentTolerance] = useState(8)
  const [fabrics, setFabrics] = useState<FabricRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('caifengbao-fabrics') || '[]') } catch { return [] }
  })
  const [patterns, setPatterns] = useState<PatternRecord[]>(() => {
    try { return JSON.parse(localStorage.getItem('caifengbao-patterns') || '[]') } catch { return [] }
  })
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [user, setUser] = useState<UserInfo | null>(() => {
    try { return JSON.parse(localStorage.getItem('caifengbao-user') || 'null') } catch { return null }
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const fabricInputRef = useRef<HTMLInputElement>(null)
  const patternInputRef = useRef<HTMLInputElement>(null)
  const patternCoverInputRef = useRef<HTMLInputElement>(null)
  const patternMigrationInputRef = useRef<HTMLInputElement>(null)
  const [coverPatternId, setCoverPatternId] = useState('')
  const [migrationNotice, setMigrationNotice] = useState('')
  const active = tools.find((tool) => tool.id === activeTool)!
  const isConverter = activeTool === 'merge'
  const totalSize = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files])
  const totalFabricLength = useMemo(() => fabrics.reduce((sum, item) => sum + (Number(item.length) || 0), 0), [fabrics])

  useEffect(() => {
    try { localStorage.setItem('caifengbao-fabrics', JSON.stringify(fabrics)) }
    catch { setError('布料图片较多，浏览器本地空间已满；请删除部分记录后再试。') }
  }, [fabrics])

  useEffect(() => {
    try { localStorage.setItem('caifengbao-patterns', JSON.stringify(patterns)) }
    catch { setError('纸样款式图较多，浏览器本地空间已满；请删除部分记录后再试。') }
  }, [patterns])

  useEffect(() => {
    let cancelled = false
    if (activeTool !== 'merge' || mergeMode !== 'sheet' || !files.length) {
      setPdfPages([])
      setSelectedPdfPage('')
      return () => { cancelled = true }
    }
    setIsLoadingPages(true)
    setError('')
    renderPdfPages(files).then((pages) => {
      if (cancelled) return
      const editable = pages.map((page) => ({ ...page, crop: { left: 0, right: 0, top: 0, bottom: 0 } }))
      setPdfPages(editable)
      setSelectedPdfPage(editable[0]?.id ?? '')
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'PDF 页面预览生成失败。')
    }).finally(() => { if (!cancelled) setIsLoadingPages(false) })
    return () => { cancelled = true }
  }, [activeTool, files, mergeMode])

  useEffect(() => {
    let cancelled = false
    if (!styleFile || !garmentPoints.length) { setGarmentMaskPreview(''); return () => { cancelled = true } }
    createGarmentMaskPreview(styleFile, garmentPoints, garmentTolerance).then(async (blob) => {
      if (!cancelled && blob) setGarmentMaskPreview(await readDataUrl(blob))
    }).catch(() => { if (!cancelled) setGarmentMaskPreview('') })
    return () => { cancelled = true }
  }, [styleFile, garmentPoints, garmentTolerance])

  function selectTool(id: ToolId) {
    setActiveTool(id)
    setFiles([])
    setError('')
    requestAnimationFrame(() => document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function addFiles(list: FileList | null) {
    if (!list) return
    const incoming = Array.from(list)
    setFiles(active.multiple ? (old) => [...old, ...incoming] : incoming.slice(0, 1))
    setError('')
  }

  function movePdfPage(fromId: string, toId: string) {
    if (fromId === toId) return
    setPdfPages((old) => {
      const from = old.findIndex((page) => page.id === fromId)
      const to = old.findIndex((page) => page.id === toId)
      if (from < 0 || to < 0) return old
      const next = [...old]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function applyCropToAll(crop: CropMargins) {
    setPdfPages((old) => old.map((page) => ({ ...page, crop: { ...crop } })))
  }

  function deletePdfPage(id: string) {
    setPdfPages((old) => {
      const next = old.filter((page) => page.id !== id)
      if (selectedPdfPage === id) setSelectedPdfPage(next[0]?.id ?? '')
      return next
    })
  }

  async function convert() {
    if (!files.length) return setError('请先选择需要处理的文件。')
    setIsWorking(true); setError(''); setProgress(15)
    const timer = window.setInterval(() => setProgress((value) => Math.min(value + 8, 90)), 260)
    try {
      if (activeTool === 'merge') {
        if (mergeMode === 'plt') {
          if (files.length > 1) throw new Error('PDF 转 PLT 每次请选择一个文件。')
          downloadBlob(await pdfToPlt(files[0], quality), `${files[0].name.replace(/\.pdf$/i, '')}.plt`, 'application/vnd.hp-hpgl')
        } else {
          const result = await mergePdfs(files, mergeMode, mergeColumns, 0, {
            direction: stitchDirection,
            perLine: mergeColumns,
            horizontalGapMm: mergeHorizontalGap,
            verticalGapMm: mergeVerticalGap,
            pages: pdfPages.map((page) => ({ fileIndex: page.fileIndex, pageIndex: page.pageIndex, crop: page.crop })),
          })
          downloadBlob(result, `裁缝宝_${mergeMode === 'sheet' ? '拼合大图' : '顺序合并'}_${Date.now()}.pdf`, 'application/pdf')
        }
      }
      setProgress(100)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '转换失败，请检查文件后重试。') }
    finally { clearInterval(timer); window.setTimeout(() => { setIsWorking(false); setProgress(0) }, 600) }
  }

  async function chooseMockupFile(kind: 'style' | 'fabric', list: FileList | null) {
    const file = list?.[0]
    if (!file) return
    const preview = await readDataUrl(file)
    if (kind === 'style') { setStyleFile(file); setStylePreview(preview); setGarmentPoints([]) } else { setFabricFile(file); setFabricPreview(preview) }
    setMockupResult(null); setMockupPreview('')
  }

  async function generateMockup() {
    if (!styleFile || !fabricFile) return setError('请同时上传款式图和布料图。')
    if (!garmentPoints.length) return setError('请先在衣服中间的大块色区点击一次。')
    setIsWorking(true); setError('')
    try {
      const result = await createFabricMockup(styleFile, fabricFile, textureScale, textureStrength, {
        seeds: garmentPoints,
        tolerance: garmentTolerance,
        fabricMode,
      })
      setMockupResult(result); setMockupPreview(await readDataUrl(result))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '效果图生成失败。') }
    finally { setIsWorking(false) }
  }

  async function importFabrics(list: FileList | null) {
    if (!list?.length) return
    setIsWorking(true)
    try {
      const records = await Promise.all(Array.from(list).map(async (file) => ({
        id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, ''), image: await thumbnail(file),
        length: 0, material: '', source: '', createdAt: new Date().toISOString(),
      })))
      setFabrics((old) => [...records, ...old])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '布料导入失败。') }
    finally { setIsWorking(false) }
  }

  function updateFabric(id: string, field: keyof FabricRecord, value: string | number) {
    setFabrics((old) => old.map((item) => item.id === id ? { ...item, [field]: value } : item))
  }

  function useFabric(item: FabricRecord) {
    setFabricFile(dataUrlToFile(item.image, `${item.name}.jpg`)); setFabricPreview(item.image); selectTool('mockup')
  }

  async function importPatterns(list: FileList | null) {
    if (!list?.length) return
    setIsWorking(true); setError('')
    try {
      const records: PatternRecord[] = []
      for (const file of Array.from(list)) {
        const id = crypto.randomUUID()
        const info = patternInfoFromFilename(file.name)
        const cover = await renderPdfCover(file)
        await savePatternFile(id, file)
        records.push({ id, title: info.title, size: info.size, fileName: file.name, cover: cover.preview, pageCount: cover.pageCount, fileSize: file.size, createdAt: new Date().toISOString() })
      }
      setPatterns((old) => [...records, ...old])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '纸样导入失败。') }
    finally { setIsWorking(false) }
  }

  async function exportPatternMigration() {
    setIsWorking(true); setError(''); setMigrationNotice('')
    try {
      const exported: PatternMigrationItem[] = []
      for (const pattern of patterns) {
        const storedFile = await getPatternFile(pattern.id)
        if (!storedFile) throw new Error(`找不到「${pattern.title}」的 PDF 文件，无法导出完整迁移包。`)
        exported.push({ ...pattern, fileData: await blobToDataUrl(storedFile), fileType: storedFile.type || 'application/pdf' })
      }
      const payload = { format: 'caifengbao-pattern-migration', version: 1, source: window.location.origin, exportedAt: new Date().toISOString(), patterns: exported }
      const stamp = new Date().toISOString().slice(0, 10)
      downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `裁缝宝-纸样迁移-${stamp}.json`, 'application/json')
      setMigrationNotice(`已导出 ${exported.length} 份纸样，请在生产地址导入这个 JSON 文件。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '纸样迁移包导出失败。') }
    finally { setIsWorking(false) }
  }

  async function importPatternMigration(list: FileList | null) {
    const migrationFile = list?.[0]
    if (!migrationFile) return
    setIsWorking(true); setError(''); setMigrationNotice('')
    try {
      const payload = JSON.parse(await migrationFile.text()) as { format?: string; version?: number; patterns?: PatternMigrationItem[] }
      if (payload.format !== 'caifengbao-pattern-migration' || payload.version !== 1 || !Array.isArray(payload.patterns)) throw new Error('这不是有效的裁缝宝纸样迁移包。')
      const existingKeys = new Set(patterns.map((pattern) => `${pattern.fileName}|${pattern.fileSize}|${pattern.title}|${pattern.size}`))
      const imported: PatternRecord[] = []
      let skipped = 0
      for (const item of payload.patterns) {
        if (!item.fileData || !item.fileName || !item.title) { skipped += 1; continue }
        const key = `${item.fileName}|${item.fileSize}|${item.title}|${item.size}`
        if (existingKeys.has(key)) { skipped += 1; continue }
        const pdf = dataUrlToFile(item.fileData, item.fileName)
        const id = crypto.randomUUID()
        await savePatternFile(id, pdf)
        imported.push({ id, title: item.title, size: item.size || '未标注', fileName: item.fileName, cover: item.cover, pageCount: item.pageCount, fileSize: pdf.size, createdAt: item.createdAt || new Date().toISOString() })
        existingKeys.add(key)
      }
      setPatterns((old) => [...imported, ...old])
      setMigrationNotice(`迁移完成：导入 ${imported.length} 份${skipped ? `，跳过 ${skipped} 份重复或不完整记录` : ''}。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '纸样迁移包导入失败。') }
    finally { setIsWorking(false); if (patternMigrationInputRef.current) patternMigrationInputRef.current.value = '' }
  }

  async function saveGeneratedPattern(file: File, title: string, size: string) {
    const id = crypto.randomUUID()
    const cover = await renderPdfCover(file)
    await savePatternFile(id, file)
    setPatterns((old) => [{ id, title, size, fileName: file.name, cover: cover.preview, pageCount: cover.pageCount, fileSize: file.size, createdAt: new Date().toISOString() }, ...old])
  }

  function updatePattern(id: string, field: 'title' | 'size', value: string) {
    setPatterns((old) => old.map((pattern) => pattern.id === id ? { ...pattern, [field]: value } : pattern))
  }

  async function downloadPattern(pattern: PatternRecord) {
    try {
      const file = await getPatternFile(pattern.id)
      if (!file) throw new Error('未找到纸样 PDF，可能已被浏览器清理。')
      downloadBlob(file, pattern.fileName, 'application/pdf')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '纸样下载失败。') }
  }

  async function removePattern(pattern: PatternRecord) {
    await deletePatternFile(pattern.id)
    setPatterns((old) => old.filter((item) => item.id !== pattern.id))
  }

  async function replacePatternCover(list: FileList | null) {
    const file = list?.[0]
    if (!file || !coverPatternId) return
    try {
      const cover = await thumbnail(file)
      setPatterns((old) => old.map((pattern) => pattern.id === coverPatternId ? { ...pattern, cover } : pattern))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '款式首图更新失败。') }
    finally { setCoverPatternId('') }
  }

  function handleAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget); const email = String(form.get('email') || '')
    const info = { name: authMode === 'register' ? String(form.get('name') || '新用户') : email.split('@')[0], email }
    localStorage.setItem('caifengbao-user', JSON.stringify(info)); setUser(info); setAuthOpen(false)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top"><span className="brand-mark"><Scissors size={21} /></span><span>裁缝宝<small>CAIFENGBAO</small></span></a>
        <nav className={mobileOpen ? 'nav-links open' : 'nav-links'}><a href="#tools" onClick={() => setMobileOpen(false)}>工具中心</a><a href="#features" onClick={() => setMobileOpen(false)}>功能特点</a><a href="#guide" onClick={() => setMobileOpen(false)}>使用帮助</a></nav>
        <div className="header-actions">
          {user ? <div className="user-chip"><span><User size={15} /> {user.name}</span><button title="退出" onClick={() => { localStorage.removeItem('caifengbao-user'); setUser(null) }}><LogOut size={15} /></button></div> : <><button className="text-button" onClick={() => { setAuthMode('login'); setAuthOpen(true) }}>登录</button><button className="primary small" onClick={() => { setAuthMode('register'); setAuthOpen(true) }}>免费注册 <ArrowRight size={15} /></button></>}
          <button className="menu-button" onClick={() => setMobileOpen(!mobileOpen)}><Menu /></button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-grid" /><div className="hero-copy"><div className="eyebrow"><Sparkles size={15} /> PDF 拼合 · 智能换布 · 纸样布料管理</div><h1>从纸样到成衣，<br /><em>一个工具箱搞定。</em></h1><p>分页纸样严丝合缝拼接、真人款式布料替换，以及纸样和布料资料管理集中处理。核心文件在浏览器本地完成，打开即可使用。</p><div className="hero-actions"><button className="primary large" onClick={() => selectTool('merge')}>立即开始 <ArrowRight size={18} /></button><button className="ghost-button" onClick={() => selectTool('pattern')}><BookOpen size={17} /> 打开纸样库</button></div><div className="trust-row"><span><Check /> 四个核心工具</span><span><Check /> 本地处理</span><span><Check /> 批量操作</span></div></div>
          <div className="hero-art" aria-hidden="true"><div className="pattern-card back-card"><span className="dimension top">84.1 CM</span><div className="pattern pattern-back" /></div><div className="pattern-card front-card"><span className="card-label">PATTERN 01</span><span className="dimension side">59.4 CM</span><div className="pattern pattern-front" /><span className="pattern-title">FRONT BODICE</span><span className="pattern-meta">SIZE M · CUT 2</span></div><div className="floating-badge badge-pdf"><b>PDF</b><span>拼合完成</span><Check /></div><div className="floating-badge badge-plt"><Palette /><span><b>FABRIC</b> 效果预览</span></div><Scissors className="large-scissors" /></div>
        </section>

        <section className="tools-section" id="tools"><div className="section-heading"><div><span className="kicker">TOOLBOX</span><h2>选择你需要的工具</h2></div><p>转换、预览和资料管理集中在一个工作台。<br />所有参数都可以按实际生产需要调整。</p></div><div className="tool-cards five-tools">{tools.map((tool) => { const Icon = tool.icon; return <button key={tool.id} className={`tool-card ${activeTool === tool.id ? 'active' : ''}`} onClick={() => selectTool(tool.id)}><span className="tool-number">{tool.number}</span><span className="tool-tag">{tool.tag}</span><span className="tool-icon"><Icon /></span><h3>{tool.title}</h3><p>{tool.description}</p><span className="tool-link">打开工具 <ArrowRight size={17} /></span></button> })}</div></section>

        <section className="workspace-section" id="workspace"><div className={`workspace-card ${activeTool === 'fabric' || activeTool === 'pattern' || activeTool === 'draft' ? 'wide-workspace' : ''}`}>
          <aside className="workspace-sidebar"><span className="kicker light">当前工具 · {active.number}</span><h2>{active.title}</h2><p>{active.description}</p><div className="steps"><div className="step active"><b>1</b><span>{activeTool === 'fabric' ? '批量导入' : '选择素材'}<small>支持拖拽或点击选择</small></span></div><div className="step active"><b>2</b><span>{activeTool === 'fabric' ? '补充资料' : '设置参数'}<small>按实际需求精细调整</small></span></div><div className={`step ${isWorking || mockupResult ? 'active' : ''}`}><b>3</b><span>{activeTool === 'fabric' ? '保存复用' : '生成下载'}<small>结果保存在你的设备</small></span></div></div><div className="privacy-note"><ShieldCheck /><span><b>本地优先</b><small>{activeTool === 'fabric' ? '布料资料保存在当前浏览器中。' : '文件不会上传到本站服务器。'}</small></span></div></aside>
          <div className="workspace-main">
            {isConverter && <>
              <div className={`drop-zone ${isDragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)} onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files) }} onClick={() => inputRef.current?.click()}><input ref={inputRef} hidden type="file" accept={active.accept} multiple={active.multiple} onChange={(e) => addFiles(e.target.files)} /><span className="upload-icon"><UploadCloud /></span><h3>将文件拖放到这里</h3><p>或者 <span>点击选择文件</span></p><small>支持多个 PDF，可按上传顺序拼合或转为 PLT</small></div>
              {files.length > 0 && <div className="file-list"><div className="file-list-title"><span>已选择 {files.length} 个文件 · {formatBytes(totalSize)}</span><button onClick={() => setFiles([])}>全部清除</button></div>{files.map((file, index) => <div className="file-row" key={`${file.name}-${index}`}><span className="file-type">{file.name.split('.').pop()?.toUpperCase()}</span><span className="file-name"><b>{file.name}</b><small>{formatBytes(file.size)}</small></span><button onClick={() => setFiles((all) => all.filter((_, i) => i !== index))}><X size={17} /></button></div>)}{active.multiple && <button className="add-more" onClick={() => inputRef.current?.click()}><Plus size={16} /> 继续添加文件</button>}</div>}
              {activeTool === 'merge' && mergeMode === 'sheet' && files.length > 0 && <PdfStitchEditor
                pages={pdfPages}
                loading={isLoadingPages}
                tab={pdfEditorTab}
                selectedId={selectedPdfPage}
                direction={stitchDirection}
                perLine={mergeColumns}
                horizontalGap={mergeHorizontalGap}
                verticalGap={mergeVerticalGap}
                onTab={setPdfEditorTab}
                onSelect={setSelectedPdfPage}
                onDirection={setStitchDirection}
                onPerLine={setMergeColumns}
                onHorizontalGap={setMergeHorizontalGap}
                onVerticalGap={setMergeVerticalGap}
                onMove={movePdfPage}
                onApplyCropAll={applyCropToAll}
                onDelete={deletePdfPage}
              />}
              <div className="settings-panel"><div className="settings-title">输出设置</div>
                {activeTool === 'merge' && <><label>处理方式</label><div className="segment-control wrap"><button className={mergeMode === 'sheet' ? 'selected' : ''} onClick={() => setMergeMode('sheet')}><Files /> 拼合为一张大图</button><button className={mergeMode === 'sequence' ? 'selected' : ''} onClick={() => setMergeMode('sequence')}><FileImage /> 顺序合并</button><button className={mergeMode === 'plt' ? 'selected' : ''} onClick={() => setMergeMode('plt')}><FileUp /> 转 PLT</button></div>{mergeMode === 'plt' && <div className="field-row"><label>线稿精度</label><input type="range" min="1" max="4" value={quality} onChange={(e) => setQuality(Number(e.target.value))} /><span>{['', '快速', '标准', '精细', '超精细'][quality]}</span></div>}</>}
              </div>
              {isWorking && <Progress progress={progress} />}<button className="convert-button" disabled={isWorking || !files.length || (activeTool === 'merge' && mergeMode === 'sheet' && (isLoadingPages || !pdfPages.length))} onClick={convert}>{isWorking ? <><RefreshCw className="spin" /> 正在处理</> : <><Zap /> 开始转换并下载</>}</button>
            </>}

            {activeTool === 'draft' && <PatternDrafting onSavePattern={saveGeneratedPattern} />}

            {activeTool === 'mockup' && <div className="mockup-workspace">
              <div className="mockup-guide"><b>1. 上传款式图</b><span>2. 点击衣服中间的大块色区</span><span>3. 确认绿色选区后生成</span></div>
              <div className="dual-upload"><ImageUpload title="款式图 / 样式图" hint={garmentPoints.length ? `已识别 ${garmentPoints.length} 个色区；遗漏区域可继续点击追加` : '通常只需在衣服中间点击一次，系统会自动识别最大连通色区'} preview={stylePreview} points={garmentPoints} maskPreview={garmentMaskPreview} onPoint={(point) => setGarmentPoints((old) => [...old, point])} onChange={(list) => chooseMockupFile('style', list)} /><ImageUpload title="布料纹理图" hint="会自动提取照片中心的纯布料区域，避免桌面和衣架进入纹理" preview={fabricPreview} onChange={(list) => chooseMockupFile('fabric', list)} /></div>
              {stylePreview && <div className="mask-actions"><span>智能选区：{garmentPoints.length ? `${garmentPoints.length} 个取样点` : '等待点击衣服'}</span><button disabled={!garmentPoints.length} onClick={() => setGarmentPoints((old) => old.slice(0, -1))}>撤销上一处</button><button disabled={!garmentPoints.length} onClick={() => setGarmentPoints([])}>清空选区</button></div>}
              <div className="settings-panel"><div className="settings-title">智能识别与贴合设置</div><div className="fabric-mode-row"><label>布料类型</label><div className="segment-control compact"><button className={fabricMode === 'solid' ? 'selected' : ''} onClick={() => setFabricMode('solid')}>纯色 / 素色</button><button className={fabricMode === 'pattern' ? 'selected' : ''} onClick={() => setFabricMode('pattern')}>印花 / 格纹</button></div></div><div className="mockup-sliders"><div className="field-row"><label>色区识别范围</label><input type="range" min="4" max="18" step="1" value={garmentTolerance} onChange={(e) => setGarmentTolerance(Number(e.target.value))} /><span>{garmentTolerance}</span></div><div className="field-row"><label>纹理大小</label><input type="range" min="0.35" max="2.5" step="0.05" value={textureScale} onChange={(e) => setTextureScale(Number(e.target.value))} /><span>{Math.round(textureScale * 100)}%</span></div><div className="field-row"><label>贴合强度</label><input type="range" min="30" max="100" value={textureStrength} onChange={(e) => setTextureStrength(Number(e.target.value))} /><span>{textureStrength}%</span></div></div><p className="recognition-hint">绿色区域就是将要替换的衣服范围。选区过大时调小识别范围；褶皱或分色区域遗漏时，可在遗漏位置再点一次。</p></div>
              <button className="convert-button" disabled={isWorking || !styleFile || !fabricFile || !garmentPoints.length} onClick={generateMockup}>{isWorking ? <><RefreshCw className="spin" /> 正在识别衣服并生成</> : <><WandSparkles /> 生成衣服换布效果图</>}</button>{mockupPreview && <div className="mockup-result"><div className="result-heading"><span><Check /> 衣服换布效果已生成</span><button className="primary small" onClick={() => mockupResult && downloadBlob(mockupResult, `裁缝宝_布料效果图_${Date.now()}.png`, 'image/png')}><Download size={15} /> 下载 PNG</button></div><img src={mockupPreview} alt="布料效果图" /><p>效果图仅替换绿色智能选区，并保留原服装的褶皱、阴影和高光。</p></div>}
            </div>}

            {activeTool === 'pattern' && <div className="pattern-library">
              <input ref={patternInputRef} hidden type="file" accept=".pdf,application/pdf" multiple onChange={(event) => importPatterns(event.target.files)} />
              <input ref={patternCoverInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => replacePatternCover(event.target.files)} />
              <input ref={patternMigrationInputRef} hidden type="file" accept=".json,application/json" onChange={(event) => importPatternMigration(event.target.files)} />
              <div className="library-toolbar"><div><span className="kicker">PATTERN LIBRARY</span><h3>{patterns.length} 份纸样文件</h3><p className="migration-help">先在本地地址导出迁移包，再在生产地址导入；不会覆盖已有纸样。</p></div><div className="library-actions"><button onClick={exportPatternMigration} disabled={isWorking || !patterns.length}><Download size={15} /> 导出本地数据</button><button onClick={() => patternMigrationInputRef.current?.click()} disabled={isWorking}><FileUp size={15} /> 导入迁移包</button><button className="primary" onClick={() => patternInputRef.current?.click()}><FileUp size={17} /> 批量导入 PDF</button></div></div>
              {migrationNotice && <div className="success-message">{migrationNotice}</div>}
              {patterns.length === 0 ? <button className="empty-library" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); importPatterns(event.dataTransfer.files) }} onClick={() => patternInputRef.current?.click()}><span className="upload-icon"><FileText /></span><h3>还没有纸样记录</h3><p>点击或拖入 PDF，系统会从文件名自动识别纸样名称和尺码。</p><small>示例：小红叶858上衣-M.pdf → 小红叶858上衣 · M</small></button> : <div className="pattern-grid">{patterns.map((pattern) => <article className="pattern-library-card" key={pattern.id}><div className="pattern-cover"><img src={pattern.cover} alt={pattern.title} /><button onClick={() => { setCoverPatternId(pattern.id); requestAnimationFrame(() => patternCoverInputRef.current?.click()) }}><ImagePlus size={14} /> 更换款式首图</button><span>{pattern.size}</span></div><div className="pattern-card-content"><input className="pattern-title-input" value={pattern.title} onChange={(event) => updatePattern(pattern.id, 'title', event.target.value)} aria-label="纸样标题" /><label>尺码<input value={pattern.size} onChange={(event) => updatePattern(pattern.id, 'size', event.target.value.toUpperCase())} /></label><div className="pattern-file-meta"><span><FileText size={13} /> {pattern.fileName}</span><small>{pattern.pageCount} 页 · {formatBytes(pattern.fileSize)}</small></div><div className="pattern-actions"><button onClick={() => downloadPattern(pattern)}><Download size={14} /> 下载 PDF</button><span><Save size={13} /> 自动保存</span><button className="danger" title="删除纸样" onClick={() => removePattern(pattern)}><Trash2 size={15} /></button></div></div></article>)}</div>}
            </div>}

            {activeTool === 'fabric' && <div className="fabric-library"><input ref={fabricInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => importFabrics(e.target.files)} /><div className="library-toolbar"><div><span className="kicker">FABRIC INVENTORY</span><h3>{fabrics.length} 款布料 · 共 {totalFabricLength.toFixed(1)} 米</h3></div><button className="primary" onClick={() => fabricInputRef.current?.click()}><PackagePlus size={17} /> 批量导入布料</button></div>{fabrics.length === 0 ? <button className="empty-library" onClick={() => fabricInputRef.current?.click()}><span className="upload-icon"><ImagePlus /></span><h3>还没有布料记录</h3><p>一次选择多张布料图片，导入后补充长度、材质和来源。</p></button> : <div className="fabric-grid">{fabrics.map((item) => <article className="fabric-card" key={item.id}><img src={item.image} alt={item.name} /><div className="fabric-fields"><input className="fabric-name" value={item.name} onChange={(e) => updateFabric(item.id, 'name', e.target.value)} aria-label="布料名称" /><div className="fabric-meta"><label>剩余长度<div className="number-input"><input type="number" min="0" step="0.1" value={item.length} onChange={(e) => updateFabric(item.id, 'length', Number(e.target.value))} /><span>米</span></div></label><label>材质<input value={item.material} placeholder="如：全棉、亚麻" onChange={(e) => updateFabric(item.id, 'material', e.target.value)} /></label><label className="full">来源<input value={item.source} placeholder="供应商 / 门店 / 链接" onChange={(e) => updateFabric(item.id, 'source', e.target.value)} /></label></div><div className="fabric-actions"><button onClick={() => useFabric(item)}><Palette size={14} /> 用于效果图</button><span><Save size={13} /> 自动保存</span><button className="danger" title="删除" onClick={() => setFabrics((old) => old.filter((fabric) => fabric.id !== item.id))}><Trash2 size={15} /></button></div></div></article>)}</div>}</div>}
            {error && <div className="error-message">{error}</div>}
          </div>
        </div></section>

        <section className="feature-strip" id="features"><div><LockKeyhole /><span><b>核心文件本地处理</b><small>纸样和照片不离开你的设备</small></span></div><div><WandSparkles /><span><b>衣服轮廓换布</b><small>保留褶皱、阴影与高光</small></span></div><div><Download /><span><b>精准纸样拼接</b><small>逐毫米校准横纵接缝</small></span></div><div><BookOpen /><span><b>纸样与布料归档</b><small>PDF、尺码、款式图和库存</small></span></div></section>
        <section className="guide-section" id="guide"><span className="kicker">HOW IT WORKS</span><h2>从文件到生产资料，只需三步</h2><div className="guide-grid"><div><b>01</b><UploadCloud /><h3>导入素材</h3><p>上传分页纸样、真人款式图或批量布料图片。</p></div><div><b>02</b><SlidersIcon /><h3>校准与选区</h3><p>校准纸样重叠接缝，或沿衣服边缘绘制换布轮廓。</p></div><div><b>03</b><Download /><h3>下载或保存</h3><p>下载拼合与换布结果，布料资料自动保存到当前浏览器。</p></div></div></section>
      </main>

      <footer><div className="brand footer-brand"><span className="brand-mark"><Scissors size={19} /></span><span>裁缝宝<small>CAIFENGBAO</small></span></div><p>让纸样、布料和款式预览更简单。</p><div><a href="#features">隐私说明</a><a href="#guide">使用帮助</a></div></footer>
      {authOpen && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setAuthOpen(false)}><div className="auth-modal"><button className="modal-close" onClick={() => setAuthOpen(false)}><X /></button><div className="brand-mark auth-logo"><Scissors /></div><span className="kicker">WELCOME</span><h2>{authMode === 'register' ? '免费创建账户' : '欢迎回来'}</h2><p>{authMode === 'register' ? '注册后即可保存常用转换设置。' : '登录继续使用你的缝纫工具箱。'}</p><form onSubmit={handleAuth}>{authMode === 'register' && <label>称呼<input name="name" required placeholder="请输入你的称呼" /></label>}<label>邮箱<input name="email" type="email" required placeholder="name@example.com" /></label><label>密码<input name="password" type="password" required minLength={6} placeholder="至少 6 位密码" /></label><button className="primary auth-submit">{authMode === 'register' ? '免费注册' : '登录'} <ArrowRight size={17} /></button></form><small>{authMode === 'register' ? '已有账户？' : '还没有账户？'} <button onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? '直接登录' : '免费注册'}</button></small></div></div>}
    </div>
  )
}

function PdfStitchEditor({
  pages, loading, tab, selectedId, direction, perLine, horizontalGap, verticalGap,
  onTab, onSelect, onDirection, onPerLine, onHorizontalGap, onVerticalGap, onMove,
  onApplyCropAll, onDelete,
}: {
  pages: EditablePdfPage[]
  loading: boolean
  tab: 'preview' | 'order' | 'crop'
  selectedId: string
  direction: 'horizontal' | 'vertical'
  perLine: number
  horizontalGap: number
  verticalGap: number
  onTab: (tab: 'preview' | 'order' | 'crop') => void
  onSelect: (id: string) => void
  onDirection: (direction: 'horizontal' | 'vertical') => void
  onPerLine: (count: number) => void
  onHorizontalGap: (gap: number) => void
  onVerticalGap: (gap: number) => void
  onMove: (from: string, to: string) => void
  onApplyCropAll: (crop: CropMargins) => void
  onDelete: (id: string) => void
}) {
  const selected = pages.find((page) => page.id === selectedId) ?? pages[0]
  const sharedCrop = pages[0]?.crop ?? { left: 0, right: 0, top: 0, bottom: 0 }
  const totalWidthMm = selected ? selected.widthPt * 25.4 / 72 : 0
  const totalHeightMm = selected ? selected.heightPt * 25.4 / 72 : 0
  return <section className="pdf-stitch-editor">
    <div className="pdf-editor-tabs">
      <button className={tab === 'preview' ? 'active' : ''} onClick={() => onTab('preview')}>拼合预览</button>
      <button className={tab === 'order' ? 'active' : ''} onClick={() => onTab('order')}>页面调整</button>
      <button className={tab === 'crop' ? 'active' : ''} onClick={() => onTab('crop')}>裁切预览</button>
      <span>{pages.length} 个页面</span>
    </div>
    {loading ? <div className="pdf-editor-loading"><RefreshCw className="spin" /> 正在解析 PDF 页面并生成预览…</div> : <div className="pdf-editor-body">
      <div className="pdf-editor-canvas">
        {tab === 'preview' && <StitchPreview pages={pages} selectedId={selectedId} direction={direction} perLine={perLine} horizontalGap={horizontalGap} verticalGap={verticalGap} onSelect={onSelect} />}
        {tab === 'order' && <div className="page-order-list">{pages.map((page, index) => <div className={`order-card ${page.id === selectedId ? 'selected' : ''}`} key={page.id} draggable onDragStart={(event) => event.dataTransfer.setData('text/pdf-page', page.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onMove(event.dataTransfer.getData('text/pdf-page'), page.id) }} onClick={() => onSelect(page.id)}><GripVertical /><span className="order-index">{index + 1}</span><CroppedPdfPage page={page} compact /><span className="order-name"><b>{page.fileName}</b><small>第 {page.pageNumber} 页 · 拖动调整顺序</small></span><button title="删除此页" onClick={(event) => { event.stopPropagation(); onDelete(page.id) }}><Trash2 size={15} /></button></div>)}</div>}
        {tab === 'crop' && selected && <div className="crop-stage"><div className="crop-page-wrap"><CroppedPdfPage page={selected} large /></div><div className="crop-size-note">裁切后约 {(totalWidthMm - selected.crop.left - selected.crop.right).toFixed(1)} × {(totalHeightMm - selected.crop.top - selected.crop.bottom).toFixed(1)} mm</div></div>}
      </div>
      <aside className="pdf-editor-controls">
        <h4>排列方式</h4><div className="segment-control compact"><button className={direction === 'horizontal' ? 'selected' : ''} onClick={() => onDirection('horizontal')}>横向排列</button><button className={direction === 'vertical' ? 'selected' : ''} onClick={() => onDirection('vertical')}>竖向排列</button></div>
        <label>{direction === 'horizontal' ? '每行页数' : '每列页数'}</label><div className="stepper"><button onClick={() => onPerLine(Math.max(1, perLine - 1))}>−</button><b>{perLine}</b><button onClick={() => onPerLine(Math.min(12, perLine + 1))}>＋</button></div>
        <label>横向重叠 <small>用 ± 逐毫米校准左右接缝</small></label><div className="overlap-stepper"><button onClick={() => onHorizontalGap(Math.max(0, horizontalGap - 1))}>−</button><input type="number" min="0" step="0.5" value={horizontalGap} onChange={(e) => onHorizontalGap(Math.max(0, Number(e.target.value)))} /><span>mm</span><button onClick={() => onHorizontalGap(horizontalGap + 1)}>＋</button></div>
        <label>纵向重叠 <small>用 ± 逐毫米校准上下接缝</small></label><div className="overlap-stepper"><button onClick={() => onVerticalGap(Math.max(0, verticalGap - 1))}>−</button><input type="number" min="0" step="0.5" value={verticalGap} onChange={(e) => onVerticalGap(Math.max(0, Number(e.target.value)))} /><span>mm</span><button onClick={() => onVerticalGap(verticalGap + 1)}>＋</button></div>
        <div className="control-divider" />
        <h4>统一裁切边距</h4><p>这里设置的边距会同时应用到全部 PDF 页面。</p>
        {selected ? <><div className="crop-input-grid">{(['left', 'right', 'top', 'bottom'] as const).map((side) => <label key={side}>{({ left: '左', right: '右', top: '上', bottom: '下' })[side]}<div className="number-input"><input type="number" min="0" step="0.5" value={sharedCrop[side]} onChange={(e) => onApplyCropAll({ ...sharedCrop, [side]: Math.max(0, Number(e.target.value)) })} /><span>mm</span></div></label>)}</div><button className="reset-crop" onClick={() => onApplyCropAll({ left: 0, right: 0, top: 0, bottom: 0 })}>重置全部裁切</button></> : <p>暂无页面</p>}
      </aside>
    </div>}
  </section>
}

function StitchPreview({ pages, selectedId, direction, perLine, horizontalGap, verticalGap, onSelect }: {
  pages: EditablePdfPage[]
  selectedId: string
  direction: 'horizontal' | 'vertical'
  perLine: number
  horizontalGap: number
  verticalGap: number
  onSelect: (id: string) => void
}) {
  if (!pages.length) return <div className="empty-stitch-preview">暂无可预览页面</div>
  const sizes = pages.map((page) => ({
    width: Math.max(1, page.widthPt * 25.4 / 72 - page.crop.left - page.crop.right),
    height: Math.max(1, page.heightPt * 25.4 / 72 - page.crop.top - page.crop.bottom),
  }))
  const maxWidth = Math.max(...sizes.map((size) => size.width))
  const maxHeight = Math.max(...sizes.map((size) => size.height))
  const scale = Math.min(0.72, 210 / maxWidth, 270 / maxHeight)
  const cellWidth = maxWidth * scale
  const cellHeight = maxHeight * scale
  const stepX = cellWidth - horizontalGap * scale
  const stepY = cellHeight - verticalGap * scale
  const rowCount = direction === 'vertical' ? Math.min(Math.max(1, perLine), pages.length) : Math.ceil(pages.length / Math.max(1, perLine))
  const columnCount = direction === 'horizontal' ? Math.min(Math.max(1, perLine), pages.length) : Math.ceil(pages.length / Math.max(1, perLine))
  const rawPositions = pages.map((_, index) => ({
    x: (direction === 'horizontal' ? index % columnCount : Math.floor(index / rowCount)) * stepX,
    y: (direction === 'vertical' ? index % rowCount : Math.floor(index / columnCount)) * stepY,
  }))
  const minX = Math.min(...rawPositions.map((position) => position.x))
  const minY = Math.min(...rawPositions.map((position) => position.y))
  const maxX = Math.max(...rawPositions.map((position, index) => position.x + sizes[index].width * scale))
  const maxY = Math.max(...rawPositions.map((position, index) => position.y + sizes[index].height * scale))
  return <div className="stitch-positioned-preview" style={{ width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }}>{pages.map((page, index) => <CroppedPdfPage key={page.id} page={page} index={index} selected={page.id === selectedId} onClick={() => onSelect(page.id)} style={{ position: 'absolute', left: rawPositions[index].x - minX, top: rawPositions[index].y - minY, width: sizes[index].width * scale, height: sizes[index].height * scale, zIndex: index + 1 }} />)}</div>
}

function CroppedPdfPage({ page, index, selected, compact, large, onClick, style }: { page: EditablePdfPage; index?: number; selected?: boolean; compact?: boolean; large?: boolean; onClick?: () => void; style?: React.CSSProperties }) {
  const widthMm = page.widthPt * 25.4 / 72
  const heightMm = page.heightPt * 25.4 / 72
  const croppedWidth = Math.max(1, widthMm - page.crop.left - page.crop.right)
  const croppedHeight = Math.max(1, heightMm - page.crop.top - page.crop.bottom)
  return <button className={`pdf-page-preview ${selected ? 'selected' : ''} ${compact ? 'compact' : ''} ${large ? 'large' : ''}`} onClick={onClick} style={{ aspectRatio: `${croppedWidth} / ${croppedHeight}`, ...style }}><img src={page.preview} alt={`${page.fileName} 第 ${page.pageNumber} 页`} style={{ width: `${widthMm / croppedWidth * 100}%`, height: `${heightMm / croppedHeight * 100}%`, left: `${-page.crop.left / croppedWidth * 100}%`, top: `${-page.crop.top / croppedHeight * 100}%` }} />{index !== undefined && <span>{index + 1}</span>}</button>
}

function containedImagePoint(event: React.MouseEvent<HTMLDivElement>) {
  const image = event.currentTarget.querySelector('img')!
  const rect = event.currentTarget.getBoundingClientRect()
  const imageRatio = image.naturalWidth / image.naturalHeight
  const boxRatio = rect.width / rect.height
  const renderWidth = boxRatio > imageRatio ? rect.height * imageRatio : rect.width
  const renderHeight = boxRatio > imageRatio ? rect.height : rect.width / imageRatio
  const offsetX = (rect.width - renderWidth) / 2
  const offsetY = (rect.height - renderHeight) / 2
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left - offsetX) / renderWidth)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top - offsetY) / renderHeight)),
  }
}

function ImageUpload({ title, hint, preview, points, maskPreview, onPoint, onChange }: { title: string; hint: string; preview: string; points?: { x: number; y: number }[]; maskPreview?: string; onPoint?: (point: { x: number; y: number }) => void; onChange: (files: FileList | null) => void }) {
  const [naturalSize, setNaturalSize] = useState({ width: 1000, height: 1000 })
  const [dragging, setDragging] = useState(false)
  return <label className={`image-upload ${preview ? 'has-preview' : ''} ${onPoint ? 'point-selectable' : ''} ${dragging ? 'dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); onChange(event.dataTransfer.files) }}>{preview ? <div className="image-point-stage" onClick={(event) => { if (!onPoint) return; event.preventDefault(); event.stopPropagation(); onPoint(containedImagePoint(event)) }}><img src={preview} alt={title} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />{maskPreview && <img className="selection-mask-preview" src={maskPreview} alt="智能衣服选区" />}{points && points.length > 0 && <svg className="garment-polygon" viewBox={`0 0 ${naturalSize.width} ${naturalSize.height}`} preserveAspectRatio="xMidYMid meet">{points.map((point, index) => <circle key={index} cx={point.x * naturalSize.width} cy={point.y * naturalSize.height} r={Math.max(6, naturalSize.width / 100)} />)}</svg>}</div> : <span className="upload-icon"><ImagePlus /></span>}<span className="image-upload-copy"><b>{dragging ? '松开即可上传图片' : preview ? `更换${title}` : title}</b><small>{dragging ? '支持 JPG、PNG、WEBP 格式' : hint}</small></span><input hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onChange(e.target.files)} /></label>
}

function Progress({ progress }: { progress: number }) {
  return <div className="progress-wrap"><div className="progress-label"><span>正在本地处理…</span><b>{progress}%</b></div><div className="progress-bar"><i style={{ width: `${progress}%` }} /></div></div>
}

function SlidersIcon() {
  return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
}

export default App
