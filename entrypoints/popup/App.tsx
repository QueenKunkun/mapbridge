import { useEffect, useState } from 'react';
import { sendBg } from '@/utils/messaging';
import { getAdapter } from '@/adapters';
import type { ProviderId } from '@/core/model';
import type { Job } from '@/core/jobs';
import { serializePlaces, parsePlacesFile } from '@/core/export';

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'baidu', name: '百度地图' },
  { id: 'amap', name: '高德地图' },
  { id: 'tencent', name: '腾讯地图' },
];

// 暂不支持的平台不出现在选择列表里（适配器完成后再放开）
const SELECTABLE_PROVIDERS = PROVIDERS.filter((p) => p.id !== 'tencent');

type Step = 'setup' | 'extract' | 'preview' | 'import' | 'report';

function providerName(id: ProviderId): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id;
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
  const [undoMsg, setUndoMsg] = useState('');

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

  const canStart = source !== target;

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

  function downloadPlaces(places: Job['places'], provider: ProviderId): void {
    const text = serializePlaces(places, provider);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `mapbridge-${provider}-export-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function startExport(): Promise<void> {
    setBusy(true);
    setError('');
    setExportedCount(0);
    try {
      const res = await sendBg({ type: 'new-job', source, target: source });
      if (res.type !== 'job' || !res.job) {
        setError('无法创建导出任务');
        return;
      }
      const tabId = detectedTab(source) ?? (await currentTabId());
      if (tabId === undefined) {
        setError('未检测到源地图收藏页，请打开并登录后重试');
        return;
      }
      const r = await sendBg({ type: 'extract', jobId: res.job.id, tabId });
      if (r.type === 'job' && r.job) {
        if (r.job.places.length === 0) {
          setError('没有提取到有效收藏（可能页面还没加载收藏列表）');
          return;
        }
        downloadPlaces(r.job.places, source);
        setExportedCount(r.job.places.length);
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
    try {
      const text = await file.text();
      const parsed = parsePlacesFile(text);
      const res = await sendBg({ type: 'import-file', target, places: parsed.places });
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
        if (res.job.places.length > 0) setStep('preview');
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

      {step === 'setup' && (
        <section className="setup">
          <div className="mode-tabs">
            <button className={`mode-tab${mode === 'migrate' ? ' active' : ''}`} onClick={() => setMode('migrate')}>迁移</button>
            <button className={`mode-tab${mode === 'export' ? ' active' : ''}`} onClick={() => setMode('export')}>导出当前地图</button>
            <button className={`mode-tab${mode === 'import-file' ? ' active' : ''}`} onClick={() => setMode('import-file')}>从文件导入</button>
          </div>

          {mode === 'migrate' && (
            <>
              <div className="steps">
                {(['setup', 'extract', 'preview', 'import', 'report'] as Step[]).map((s, i) => (
                  <span key={s} className={`step${step === s ? ' active' : ''}${stepIndex(step) > i ? ' done' : ''}`}>
                    {i + 1}
                  </span>
                ))}
              </div>
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
                          ) : (
                            <span className="ok-tag">已检测到 ✓</span>
                          )
                        ) : (
                          <button className="ghost small" onClick={() => void openPage(getAdapter(pid).extractPage)}>
                            打开
                          </button>
                        )}
                      </div>
                    );
                  })}
                {detecting && <span className="hint">检测中…</span>}
              </div>
              <p className="hint">请确保地图网址已打开，并完成登录。</p>
              <button className="primary" disabled={!canStart || busy} onClick={() => void newJob()}>
                {canStart ? '开始' : '请选择不同平台'}
              </button>
            </>
          )}

          {mode === 'export' && (
            <>
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
              <p className="hint">提取该地图的收藏并下载为 JSON 文件，可被“从文件导入”或其他设备复用。</p>
              <button className="primary" disabled={busy} onClick={() => void startExport()}>
                {busy ? '导出中…' : '导出当前地图'}
              </button>
              {exportedCount > 0 && <div className="count">已导出 <b>{exportedCount}</b> 条 ✓</div>}
            </>
          )}

          {mode === 'import-file' && (
            <>
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
              <p className="hint">选择已登录的目标地图收藏页，再选择 MapBridge 导出文件（<code>mapbridge-*.json</code>）。</p>
              <input type="file" accept="application/json,.json" onChange={(e) => void onImportFile(e)} disabled={busy} />
              {!detectedTab(target) && (
                <button className="ghost small" onClick={() => void openPage(getAdapter(target).importPage)}>
                  打开目标页
                </button>
              )}
            </>
          )}
        </section>
      )}

      {step === 'extract' && job && (
        <section className="extract">
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
              刷新
            </button>
          </div>
          {job.places.length > 0 && (
            <div className="count">
              已提取 <b>{job.places.length}</b> 条
            </div>
          )}
        </section>
      )}

      {step === 'preview' && job && (
        <section className="preview">
          <h2>预览与编辑</h2>
          <PlaceTable places={job.places} onSave={savePreview} onNext={() => setStep('import')} />
        </section>
      )}

      {step === 'import' && job && (
        <section className="import">
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
          <div className="count">待导入 {job.places.length} 条</div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void startImport()}>
              {busy ? '导入中…' : '开始导入'}
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
        <section className="report">
          <h2>{job.status === 'done' ? '导入完成 ✅' : job.status === 'failed' ? '导入失败 ❌' : '导入中…'}</h2>
          <dl>
            <dt>来源</dt>
            <dd>{providerName(job.sourceProvider)}</dd>
            <dt>目标</dt>
            <dd>{providerName(job.targetProvider)}</dd>
            <dt>条数</dt>
            <dd>
              {job.places.length}（导入 {job.report?.imported ?? '—'}，重复 {job.report?.skippedDuplicates ?? '—'}，失败{' '}
              {job.report?.failed ?? '—'}）
            </dd>
            {job.report?.targetCount !== undefined && (
              <>
                <dt>目标端收藏数</dt>
                <dd>{job.report.targetCount}</dd>
              </>
            )}
            {job.error && (
              <>
                <dt>错误</dt>
                <dd className="error">{job.error}</dd>
              </>
            )}
          </dl>
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

function PlaceTable({ places, onSave, onNext }: { places: Job['places']; onSave: (p: Job['places']) => Promise<void>; onNext: () => void }) {
  const [rows, setRows] = useState<Job['places']>(places);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = rows.filter((p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || (p.address ?? '').toLowerCase().includes(filter.toLowerCase()));

  function update(id: string, patch: Partial<Job['places'][number]>) {
    setRows((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
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
          <button className="primary" disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存修改'}
          </button>
          <button className="ghost" onClick={onNext}>
            下一步：导入 →
          </button>
        </div>
      </div>
    </div>
  );
}