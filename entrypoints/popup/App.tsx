import { useEffect, useState } from 'react';
import { sendBg } from '@/utils/messaging';
import { getAdapter } from '@/adapters';
import type { ProviderId } from '@/core/model';
import { updatePreviewPlace, type Job } from '@/core/jobs';
import { serializeItems } from '@/core/export';
import { exportGpx, exportKml } from '@/core/exporters';
import { parsePortableFile } from '@/core/portable-import';
import { getUiSelection, saveUiSelection } from '@/storage/db';

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'baidu', name: '百度地图' },
  { id: 'amap', name: '高德地图' },
  { id: 'tencent', name: '腾讯地图' },
];

// 暂不支持的平台不出现在选择列表里（适配器完成后再放开）
const SELECTABLE_PROVIDERS = PROVIDERS.filter((p) => p.id !== 'tencent');

type Step = 'setup' | 'extract' | 'preview' | 'import' | 'report';
type ExportFormat = 'mapbridge' | 'gpx' | 'kml';

function providerName(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
}

function NextImportButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void | Promise<void> }) {
  return <button className="primary" disabled={disabled} onClick={() => void onClick()}>下一步：导入 →</button>;
}

export default function App() {
  const [source, setSource] = useState<ProviderId>('baidu');
  const [target, setTarget] = useState<ProviderId>('amap');
  const [step, setStep] = useState<Step>('setup');
  const [job, setJob] = useState<Job | undefined>();
  const [tabId, setTabId] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState<{ providerId: ProviderId; tabId: number; loggedIn?: boolean }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [mode, setMode] = useState<'migrate' | 'export' | 'import-file'>('migrate');
  const [exportedCount, setExportedCount] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mapbridge');
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [undoMsg, setUndoMsg] = useState('');
  const [selectionReady, setSelectionReady] = useState(false);
  const [previewTab, setPreviewTab] = useState<'places' | 'routes'>('places');

  // 记住上次的选择（来源 / 目标 / 模式）
  useEffect(() => {
    void getUiSelection().then((sel) => {
      if (sel.source) setSource(sel.source);
      if (sel.target) setTarget(sel.target);
      if (sel.mode) setMode(sel.mode);
      setSelectionReady(true);
    });
  }, []);
  useEffect(() => {
    if (!selectionReady) return;
    void saveUiSelection({ source, target, mode });
  }, [source, target, mode, selectionReady]);

  useEffect(() => {
    if (step !== 'preview' || !job) return;
    setPreviewTab(job.places.length > 0 ? 'places' : 'routes');
  }, [step, job?.id]);

  async function refreshDetection(): Promise<void> {
    setDetecting(true);
    const res = await sendBg({ type: 'detect-map-tabs' });
    if (res.type === 'detected') setDetected(res.tabs);
    setDetecting(false);
  }

  useEffect(() => {
    void refreshDetection();
    void sendBg({ type: 'get-active-tab' }).then((res) => {
      if (res.type === 'active-tab' && res.tabId >= 0) setTabId(res.tabId);
    });
  }, []);

  // 选定源/目标后开始检测对应收藏页是否已打开
  useEffect(() => {
    void refreshDetection();
  }, [source, target]);

  const detectedTab = (provider: ProviderId): number | undefined => detected.find((t) => t.providerId === provider)?.tabId;
  const isProviderLoggedIn = (provider: ProviderId): boolean | undefined => detected.find((t) => t.providerId === provider)?.loggedIn;

  // 当前激活标签页对应的地图平台（仅当在地图页上时有效）
  const activeProvider = detected.find((d) => d.tabId === tabId)?.providerId;
  // 导出/导入默认用当前地图页对应的平台；不在地图页时才退回用户手动选择
  const effectiveSource = mode === 'export' && activeProvider ? activeProvider : source;
  const effectiveTarget = mode === 'import-file' && activeProvider ? activeProvider : target;

  const canStart = source !== target;
  const previewRoutes = job?.items.filter((item): item is Extract<Job['items'][number], { kind: 'route' }> => item.kind === 'route') ?? [];
  const activePreviewTab = previewTab === 'routes' && previewRoutes.length === 0 ? 'places' : previewTab;
  const targetCapabilities = job ? getAdapter(job.targetProvider).capabilities : undefined;
  const reportRoutes = job?.items.filter((item) => item.kind === 'route' && !targetCapabilities?.importKinds.includes(item.kind)).length ?? 0;
  const reportImportable = job?.items.filter((item) => targetCapabilities?.importKinds.includes(item.kind)).length ?? 0;
  const reportSkipped = job ? Math.max(job.rawCount - job.items.length, 0) : 0;

  async function newJob(): Promise<Job | undefined> {
    const res = await sendBg({ type: 'new-job', source, target });
    if (res.type === 'job' && res.job) {
      setJob(res.job);
      setStep('extract');
      setError('');
      return res.job;
    }
    return undefined;
  }

  async function currentTabId(): Promise<number | undefined> {
    const res = await sendBg({ type: 'get-active-tab' });
    return res.type === 'active-tab' && res.tabId >= 0 ? res.tabId : undefined;
  }

  async function openPage(url: string): Promise<void> {
    await sendBg({ type: 'open-tab', url });
    setTimeout(() => void refreshDetection(), 3000);
  }

  function downloadItems(items: Job['items'], provider: ProviderId): string[] {
    const exported = exportFormat === 'gpx'
      ? exportGpx(items)
      : exportFormat === 'kml'
        ? exportKml(items)
        : { text: serializeItems(items, provider), warnings: [] };
    const extension = exportFormat === 'mapbridge' ? 'json' : exportFormat;
    const mime = exportFormat === 'mapbridge'
      ? 'application/json'
      : exportFormat === 'gpx'
        ? 'application/gpx+xml'
        : 'application/vnd.google-earth.kml+xml';
    const blob = new Blob([exported.text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `mapbridge-${provider}-export-${stamp}.${extension}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return exported.warnings;
  }

  async function startExport(): Promise<void> {
    setBusy(true);
    setError('');
    setExportedCount(0);
    setExportWarnings([]);
    try {
      const res = await sendBg({ type: 'new-job', source: effectiveSource, target: effectiveSource });
      if (res.type !== 'job' || !res.job) {
        setError('无法创建导出任务');
        return;
      }
      const tabId = detectedTab(effectiveSource) ?? (await currentTabId());
      if (tabId === undefined) {
        setError('未检测到源地图收藏页，请打开并登录后重试');
        return;
      }
      const r = await sendBg({ type: 'extract', jobId: res.job.id, tabId });
      if (r.type === 'job' && r.job) {
        if (r.job.items.length === 0) {
          setError('没有提取到有效收藏（可能页面还没加载收藏列表）');
          return;
        }
        setExportWarnings(downloadItems(r.job.items, effectiveSource));
        setExportedCount(r.job.items.length);
      } else if (r.type === 'error') {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function undoImport(): Promise<void> {
    if (!job) return;
    setBusy(true);
    setError('');
    setUndoMsg('');
    try {
      const tabId = detectedTab(job.targetProvider) ?? (await currentTabId());
      if (tabId === undefined) {
        setError('未检测到目标地图收藏页，请打开后重试');
        return;
      }
      const res = await sendBg({ type: 'undo-import', jobId: job.id, tabId });
      if (res.type === 'undo-result') {
        const data = res.data;
        setJob({ ...job, report: { ...job.report!, undone: true } });
        setUndoMsg(`已撤销导入 ${data.deleted} 条`);
      } else if (res.type === 'error') {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    setFileWarnings([]);
    try {
      const text = await file.text();
      const parsed = parsePortableFile(text, effectiveTarget);
      setFileWarnings('warnings' in parsed ? parsed.warnings ?? [] : []);
      const res = await sendBg({ type: 'import-file', target: effectiveTarget, places: parsed.places, warnings: 'warnings' in parsed ? parsed.warnings : [] });
      if (res.type === 'job' && res.job) {
        setJob(res.job);
        setStep('preview');
      } else if (res.type === 'error') {
        setError(res.message);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const sourcePage = job ? getAdapter(job.sourceProvider).extractPage : '';
  const targetPage = job ? getAdapter(job.targetProvider).importPage : '';

  async function refreshJob(): Promise<void> {
    if (!job) return;
    const res = await sendBg({ type: 'get-job', id: job.id });
    if (res.type === 'job' && res.job) setJob(res.job);
  }

  async function startExtract(): Promise<void> {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      const tabId = detectedTab(job.sourceProvider) ?? (await currentTabId());
      if (tabId === undefined) {
        setError('未检测到源地图收藏页，请打开后重试');
        setBusy(false);
        return;
      }
      const res = await sendBg({ type: 'extract', jobId: job.id, tabId });
      if (res.type === 'job' && res.job) {
        setJob(res.job);
        if (res.job.items.length > 0) setStep('preview');
        else setError('没有提取到有效收藏（可能页面还没加载收藏列表）');
      } else if (res.type === 'error') {
        setError(res.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePreview(places: Job['places']): Promise<void> {
    if (!job) return;
    const res = await sendBg({ type: 'preview-update', jobId: job.id, places });
    if (res.type === 'job' && res.job) setJob(res.job);
  }

  async function startImport(): Promise<void> {
    if (!job) return;
    setBusy(true);
    setError('');
    try {
      const tabId = detectedTab(job.targetProvider) ?? (await currentTabId());
      if (tabId === undefined) {
        setError('未检测到目标地图收藏页，请打开后重试');
        setBusy(false);
        return;
      }
      const res = await sendBg({ type: 'import', jobId: job.id, tabId });
      if (res.type === 'ok') {
        setStep('report');
        const done = setInterval(async () => {
          const r = await sendBg({ type: 'get-job', id: job.id });
          if (r.type !== 'job' || !r.job) {
            clearInterval(done);
            return;
          }
          setJob(r.job);
          if (r.job.status === 'done' || r.job.status === 'failed') {
            clearInterval(done);
            setStep('report');
            setBusy(false);
          }
        }, 800);
      } else if (res.type === 'error') {
        setError(res.message);
        setBusy(false);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  }

  const [ver, setVer] = useState('');
  const dev = import.meta.env.DEV;
  useEffect(() => {
    try { setVer(browser.runtime.getManifest().version); } catch { setVer('dev'); }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>MapBridge</h1>
        <span className="tagline">地图收藏夹迁移</span>
        {dev && <span className="dev-badge">DEV</span>}
        {ver && <span className="ver-badge">v{ver}</span>}
        <button
          className="icon-btn"
          title="设置"
          aria-label="设置"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          ⚙
        </button>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      <nav className="mode-tabs" aria-label="操作模式">
        <button className={`mode-tab${mode === 'migrate' ? ' active' : ''}`} disabled={step !== 'setup'} onClick={() => setMode('migrate')}>迁移</button>
        <button className={`mode-tab${mode === 'export' ? ' active' : ''}`} disabled={step !== 'setup'} onClick={() => setMode('export')}>导出当前地图</button>
        <button className={`mode-tab${mode === 'import-file' ? ' active' : ''}`} disabled={step !== 'setup'} onClick={() => setMode('import-file')}>从文件导入</button>
      </nav>

      {mode === 'migrate' && (
        <div className="migration-flow">
          <div className="steps" aria-label="迁移步骤">
            {(['setup', 'extract', 'preview', 'import', 'report'] as Step[]).map((s, i) => (
              <span key={s} className={`step${step === s ? ' active' : ''}${stepIndex(step) > i ? ' done' : ''}`}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      )}

      {step === 'setup' && (
        <section className="setup">
          {mode === 'migrate' && (
            <div className="migration-content">
              <div className="pick">
                <label>
                  从
                  <select value={source} onChange={(e) => setSource(e.target.value as ProviderId)}>
                    {SELECTABLE_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="arrow">→</span>
                <label>
                  到
                  <select value={target} onChange={(e) => setTarget(e.target.value as ProviderId)}>
                    {SELECTABLE_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="detect-list">
                {[source, target]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((pid) => {
                    const p = PROVIDERS.find((x) => x.id === pid)!;
                    const ok = detected.some((d) => d.providerId === pid);
                    const loggedIn = isProviderLoggedIn(pid);
                    return (
                      <div key={pid} className="detect-item">
                        <span className={`dot${ok ? ' ok' : ''}`} />
                        <span>{p.name}收藏页</span>
                        {ok ? (
                          loggedIn === false ? (
                            <span className="warn-tag">未登录</span>
                          ) : loggedIn === true ? (
                            <span className="ok-tag">已登录 ✓</span>
                          ) : (
                            <span className="hint">已检测到，登录状态待确认</span>
                          )
                        ) : (
                          <button className="ghost small" onClick={() => void openPage(getAdapter(pid).extractPage)}>
                            打开
                          </button>
                        )}
                      </div>
                    );
                  })}
                <div className="detect-actions">
                  {detecting && <span className="hint">检测中…</span>}
                  <button className="ghost small" disabled={detecting} onClick={() => void refreshDetection()}>
                    刷新检测
                  </button>
                </div>
              </div>
              <p className="hint">请确保地图网址已打开，并完成登录。</p>
              <button className="primary" disabled={!canStart || busy} onClick={() => void newJob()}>
                {canStart ? '开始' : '请选择不同平台'}
              </button>
            </div>
          )}

          {mode === 'export' && (
            <>
              {activeProvider ? (
                <div className="auto-provider">
                  <span className="dot ok" />
                  当前页面：<b>{providerName(activeProvider)}</b>（将导出此地图收藏）
                </div>
              ) : (
                <label className="field-inline">
                  选择地图
                  <select value={source} onChange={(e) => setSource(e.target.value as ProviderId)}>
                    {SELECTABLE_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field-inline">
                导出格式
                <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)}>
                  <option value="mapbridge">MapBridge JSON（完整备份）</option>
                  <option value="gpx">GPX 1.1（通用交换）</option>
                  <option value="kml">KML 2.2（通用交换）</option>
                </select>
              </label>
              <p className="hint">MapBridge JSON 可用于完整恢复；GPX/KML 适合在其他地图软件中交换，部分平台字段可能无法保留。</p>
              <button className="primary" disabled={busy} onClick={() => void startExport()}>
                {busy ? '导出中…' : `导出${activeProvider ? providerName(activeProvider) : '当前地图'}收藏`}
              </button>
              {exportedCount > 0 && <div className="count">已导出 <b>{exportedCount}</b> 条 ✓</div>}
              {exportWarnings.length > 0 && <div className="export-warning">⚠ {exportWarnings.join('；')}</div>}
            </>
          )}

          {mode === 'import-file' && (
            <>
              {activeProvider ? (
                <div className="auto-provider">
                  <span className="dot ok" />
                  当前页面：<b>{providerName(activeProvider)}</b>（将导入到此地图）
                </div>
              ) : (
                <label className="field-inline">
                  导入到
                  <select value={target} onChange={(e) => setTarget(e.target.value as ProviderId)}>
                    {SELECTABLE_PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="hint">选择已登录的目标地图收藏页，再选择 MapBridge 导出文件（<code>mapbridge-*.json</code>）。</p>
              {fileWarnings.length > 0 && <div className="export-warning">⚠ {fileWarnings.join('；')}</div>}
              <label className={`file-btn${busy ? ' disabled' : ''}`}>
                选择文件
                <input type="file" accept="application/json,.json,.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml" onChange={(e) => void onImportFile(e)} disabled={busy} hidden />
              </label>
              {activeProvider && !detectedTab(activeProvider) && (
                <div className="open-right">
                  <button className="ghost small" onClick={() => void openPage(getAdapter(activeProvider).importPage)}>
                    打开目标页
                  </button>
                </div>
              )}
              {!activeProvider && !detectedTab(target) && (
                <div className="open-right">
                  <button className="ghost small" onClick={() => void openPage(getAdapter(target).importPage)}>
                    打开目标页
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {step === 'extract' && job && (
        <section className="migration-content extract">
          <h2>提取收藏 · {providerName(job.sourceProvider)}</h2>
          {detectedTab(job.sourceProvider) !== undefined ? (
            <p className="hint ok-tag">源收藏页已检测到 ✓，可直接提取</p>
          ) : (
            <>
              <p className="hint">
                未检测到源收藏页。请打开已登录的 {providerName(job.sourceProvider)} 收藏页：
              </p>
              <button className="ghost" onClick={() => void openPage(sourcePage)}>
                打开源收藏页
              </button>
            </>
          )}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void startExtract()}>
              {busy ? '提取中…' : '开始提取'}
            </button>
            <button className="ghost" onClick={() => { void refreshJob(); void refreshDetection(); }}>
              刷新状态
            </button>
          </div>
          {job.items.length > 0 && (
            <div className="count">
              已提取 <b>{job.items.length}</b> 条，其中可导入项目 <b>{job.items.filter((item) => targetCapabilities?.importKinds.includes(item.kind)).length}</b> 条
              {job.items.some((item) => item.kind === 'route') && <div className="hint">已识别 Route；目标平台支持且交通方式明确时可参与导入。</div>}
            </div>
          )}
        </section>
      )}

      {step === 'preview' && job && (
        <section className="migration-content preview">
          <h2>预览与编辑</h2>
          {job.warnings.length > 0 && <div className="export-warning">⚠ {job.warnings.join('；')}</div>}
          <div className="preview-tabs" role="tablist" aria-label="导入项目类型">
            <button
              className={`preview-tab${activePreviewTab === 'places' ? ' active' : ''}`}
              role="tab"
              aria-selected={activePreviewTab === 'places'}
              disabled={job.places.length === 0}
              onClick={() => setPreviewTab('places')}
            >
              地点 <span>({job.places.length}条)</span>
            </button>
            <button
              className={`preview-tab${activePreviewTab === 'routes' ? ' active' : ''}`}
              role="tab"
              aria-selected={activePreviewTab === 'routes'}
              disabled={previewRoutes.length === 0}
              onClick={() => setPreviewTab('routes')}
            >
              路线 <span>({previewRoutes.length}条)</span>
            </button>
          </div>
          <div className="preview-panel">
            {activePreviewTab === 'places' ? (
              <PlaceTable
                places={job.places}
                onSave={savePreview}
                onNext={async (places) => { await savePreview(places); setStep('import'); }}
              />
            ) : (
              <>
                <p className="hint">Route 会保留在当前任务中；目标平台支持且交通方式明确时，会随任务参与导入。</p>
                <div className="route-list">
                  {previewRoutes.map((route) => <RouteSummary key={route.id} route={route} />)}
                </div>
                <div className="actions">
                  <NextImportButton
                    disabled={(targetCapabilities?.importKinds.includes('route') ? previewRoutes.length : 0) === 0 && job.places.length === 0}
                    onClick={() => setStep('import')}
                  />
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {step === 'import' && job && (
        <section className="migration-content import">
          <h2>导入 · {providerName(job.targetProvider)}</h2>
          {detectedTab(job.targetProvider) !== undefined ? (
            <p className="hint ok-tag">目标收藏页已检测到 ✓，可直接导入</p>
          ) : (
            <>
              <p className="hint">
                未检测到目标收藏页。请打开已登录的 {providerName(job.targetProvider)} 收藏页：
              </p>
              <button className="ghost" onClick={() => void openPage(targetPage)}>
                打开目标收藏页
              </button>
            </>
          )}
          <div className="count">待导入 {reportImportable} 条</div>
          {reportRoutes > 0 && (
            <p className="hint warning">另有 {reportRoutes} 条 Route 不会导入：当前目标平台不支持，或路线交通方式无法识别。</p>
          )}
          <div className="actions">
            <button className="primary" disabled={busy || reportImportable === 0} onClick={() => void startImport()}>
              {busy ? '导入中…' : reportImportable === 0 ? '没有可导入的项目' : '开始导入'}
            </button>
            <button className="ghost" onClick={() => setStep('preview')}>
              返回编辑
            </button>
          </div>
          {busy && (
            <div className="progress">
              <div className="progress-msg">{job.progress?.message ?? '正在导入…'}</div>
            </div>
          )}
        </section>
      )}

      {step === 'report' && job && (
        <section className="migration-content report">
          <h2>{job.status === 'done' ? '导入完成 ✅' : job.status === 'failed' ? '导入失败 ❌' : '导入中…'}</h2>
          <div className="report-meta">
            <span>来源：{providerName(job.sourceProvider)}</span>
            <span>目标：{providerName(job.targetProvider)}</span>
          </div>
          <div className="report-overview" aria-label="导入概览">
            <div><span>原始记录</span><strong>{job.rawCount} 条</strong></div>
            <div><span>已识别项目</span><strong>{job.items.length} 条</strong></div>
            <div><span>可导入项目</span><strong>{reportImportable} 条</strong></div>
          </div>
          <div className="report-section">
            <h3>导入结果</h3>
            <dl>
              <dt>成功导入</dt>
              <dd>{job.report?.imported ?? '—'} 条</dd>
              <dt>重复跳过</dt>
              <dd>{job.report?.skippedDuplicates ?? '—'} 条</dd>
              <dt>导入失败</dt>
              <dd>{job.report?.failed ?? '—'} 条</dd>
              {job.report?.targetCount !== undefined && (
                <>
                  <dt>目标端收藏</dt>
                  <dd>{job.report.targetCount} 条（导入后总数）</dd>
                </>
              )}
            </dl>
          </div>
          {(reportRoutes > 0 || reportSkipped > 0) && (
            <div className="report-section report-excluded">
              <h3>未导入项目</h3>
              <ul>
                {reportRoutes > 0 && <li>{reportRoutes} 条路线（当前目标平台不支持路线导入）</li>}
                {reportSkipped > 0 && <li>{reportSkipped} 条记录（无法识别或数据不完整）</li>}
              </ul>
            </div>
          )}
          {job.error && <div className="error">{job.error}</div>}
          {job.warnings.length > 0 && (
            <div className="export-warning">
              <strong>提取/解析提示</strong>
              <ul>
                {job.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
              </ul>
            </div>
          )}
          {undoMsg && <div className="count ok-tag">✓ {undoMsg}</div>}
          <div className="actions">
            <button className="ghost" onClick={() => void openPage(targetPage)}>
              去目标页核对
            </button>
            <button className="ghost" onClick={() => setStep('setup')}>
              再来一次
            </button>
            {job.status === 'done' && (job.report?.importedIds?.length ?? 0) > 0 && !job.report?.undone && (
              <button className="danger" disabled={busy} onClick={() => void undoImport()}>
                {busy ? '撤销中…' : '撤销本次导入'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function stepIndex(s: Step): number {
  return ['setup', 'extract', 'preview', 'import', 'report'].indexOf(s);
}

function RouteSummary({ route }: { route: Extract<Job['items'][number], { kind: 'route' }> }) {
  const roleName: Record<string, string> = { start: '起点', waypoint: '途经点', end: '终点' };
  return (
    <article className="route-summary">
      <div className="route-summary-head">
        <strong>{route.name}</strong>
        <span>{route.travelMode ?? route.routing.transitKind ?? '路线'}</span>
      </div>
      <ol>
        {route.stops.map((stop) => (
          <li key={`${stop.role}-${stop.point.lng}-${stop.point.lat}`}>
            <span>{roleName[stop.role] ?? stop.role}：{stop.name}</span>
            <code>{stop.point.lng.toFixed(5)}, {stop.point.lat.toFixed(5)}</code>
          </li>
        ))}
      </ol>
      <small>Route 当前只读；目标平台支持且交通方式明确时，会参与导入。</small>
    </article>
  );
}

function PlaceTable({ places, onSave, onNext }: { places: Job['places']; onSave: (p: Job['places']) => Promise<void>; onNext: (p: Job['places']) => void | Promise<void> }) {
  const [rows, setRows] = useState<Job['places']>(places);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = rows.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || (p.address ?? '').toLowerCase().includes(filter.toLowerCase()));

  function update(id: string, patch: Partial<Job['places'][number]>) {
    setRows((prev) => prev.map((p) => (p.id === id ? updatePreviewPlace(p, patch) : p)));
  }

  function remove(id: string) {
    setRows((prev) => prev.filter((p) => p.id !== id));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(rows);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="place-table">
      <input className="filter" placeholder="搜索名称 / 地址…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="table-head">
        <span>名称</span>
        <span>地址</span>
        <span>坐标(WGS-84)</span>
        <span></span>
      </div>
      <div className="table-body">
        {shown.map((p) => (
          <div key={p.id} className="row">
            <input value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
            <input value={p.address ?? ''} onChange={(e) => update(p.id, { address: e.target.value })} />
            <span className="coords">
              {p.wgs84.lng.toFixed(5)}, {p.wgs84.lat.toFixed(5)}
            </span>
            <button className="remove" onClick={() => remove(p.id)}>
              ✕
            </button>
          </div>
        ))}
        {shown.length === 0 && <div className="empty">无匹配</div>}
      </div>
      <div className="table-foot">
        <span>
          共 {rows.length} 条，显示 {shown.length}
        </span>
        <div className="actions">
          <button className="ghost" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存到当前任务'}
          </button>
          <NextImportButton onClick={() => onNext(rows)} />
        </div>
      </div>
      <div className="hint save-note">修改会保存到当前任务；点击“下一步”也会自动保存。只有开始导入后，才会写入目标地图。</div>
    </div>
  );
}
