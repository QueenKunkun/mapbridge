import type { ReactNode } from 'react';
import type { ProviderId } from '@/core/model';
import type { Job } from '@/core/jobs';
import { getAdapter } from '@/adapters';
import { IconGear } from '@/components/Icons';
import { PlaceTable, RouteSummary } from './PlaceTable';
import { ExtractionWarningPanel, NextImportButton, WizardActions } from './PopupComponents';

type Step = 'setup' | 'extract' | 'preview' | 'import' | 'report';
type ExportFormat = 'mapbridge' | 'gpx' | 'kml';
type ProviderOption = { id: ProviderId; name: string };

export function PopupView({
  providers,
  selectableProviders,
  providerName,
  dev,
  ver,
  error,
  mode,
  step,
  switchMode,
  source,
  target,
  detected,
  isProviderLoggedIn,
  detecting,
  refreshDetection,
  openPage,
  canStart,
  busy,
  newJob,
  activeProvider,
  exportFormat,
  setExportFormat,
  startExport,
  exportedCount,
  exportWarnings,
  fileWarnings,
  onImportFile,
  job,
  onSourceChange,
  onTargetChange,
  onPreviewPlacesChange,
  onStepChange,
  cancelCurrentJob,
  targetCapabilities,
  detectedTab,
  refreshJob,
  sourcePage,
  targetPage,
  startExtract,
  previewRoutes,
  activePreviewTab,
  previewTab,
  setPreviewTab,
  previewPlaces,
  savePreview,
  matchingPlaceIds,
  matching,
  startAmapMatch,
  selectAmapPoi,
  reportImportable,
  reportRoutes,
  startImport,
  undoMsg,
  reportSkipped,
  undoImport,
}: {
  providers: ProviderOption[];
  selectableProviders: ProviderOption[];
  providerName: (id: ProviderId) => string;
  dev: boolean;
  ver: string;
  error: string;
  mode: 'migrate' | 'export' | 'import-file';
  step: Step;
  switchMode: (mode: 'migrate' | 'export' | 'import-file') => void;
  source: ProviderId;
  target: ProviderId;
  detected: {
    providerId: ProviderId;
    tabId: number;
    loggedIn?: boolean;
    version?: 'new' | 'legacy';
  }[];
  isProviderLoggedIn: (provider: ProviderId) => boolean | undefined;
  detecting: boolean;
  refreshDetection: () => Promise<void>;
  openPage: (url: string) => Promise<void>;
  canStart: boolean;
  busy: boolean;
  newJob: () => Promise<Job | undefined>;
  activeProvider?: ProviderId;
  exportFormat: ExportFormat;
  setExportFormat: (format: ExportFormat) => void;
  startExport: () => Promise<void>;
  exportedCount: number;
  exportWarnings: string[];
  fileWarnings: string[];
  onImportFile: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  onSourceChange: (provider: ProviderId) => void;
  onTargetChange: (provider: ProviderId) => void;
  onPreviewPlacesChange: (places: Job['places']) => void;
  onStepChange: (step: Step) => void;
  cancelCurrentJob: () => Promise<void>;
  job?: Job;
  targetCapabilities?: ReturnType<typeof import('@/adapters').getAdapter>['capabilities'];
  detectedTab: (provider: ProviderId) => number | undefined;
  refreshJob: () => Promise<void>;
  sourcePage: string;
  targetPage: string;
  startExtract: () => Promise<void>;
  previewRoutes: Extract<Job['items'][number], { kind: 'route' }>[];
  activePreviewTab: 'places' | 'routes';
  previewTab: 'places' | 'routes';
  setPreviewTab: (tab: 'places' | 'routes') => void;
  previewPlaces: Job['places'];
  savePreview: (
    places: Job['places'],
    tab?: Job['previewTab'],
    phase?: 'extract' | 'preview' | 'import',
  ) => Promise<void>;
  matchingPlaceIds: Set<string>;
  matching: boolean;
  startAmapMatch: (ids: string | string[]) => Promise<void>;
  selectAmapPoi: (
    placeId: string,
    candidate?: NonNullable<NonNullable<Job['amapPoiMatches']>[string]['candidates']>[number],
  ) => Promise<void>;
  reportImportable: number;
  reportRoutes: number;
  startImport: () => Promise<void>;
  undoMsg: string;
  reportSkipped: number;
  undoImport: () => Promise<void>;
}) {
  const stepIndex = (value: Step) =>
    ['setup', 'extract', 'preview', 'import', 'report'].indexOf(value);
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
          <IconGear />
        </button>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      <nav className="mode-tabs" aria-label="操作模式">
        <button
          className={`mode-tab${mode === 'migrate' ? ' active' : ''}`}
          disabled={step !== 'setup' && step !== 'report'}
          onClick={() => switchMode('migrate')}
        >
          迁移
        </button>
        <button
          className={`mode-tab${mode === 'export' ? ' active' : ''}`}
          disabled={step !== 'setup' && step !== 'report'}
          onClick={() => switchMode('export')}
        >
          导出
        </button>
        <button
          className={`mode-tab${mode === 'import-file' ? ' active' : ''}`}
          disabled={step !== 'setup' && step !== 'report'}
          onClick={() => switchMode('import-file')}
        >
          从文件导入
        </button>
      </nav>

      {mode === 'migrate' && (
        <div className="migration-flow">
          <div className="steps" aria-label="迁移步骤">
            {(['setup', 'extract', 'preview', 'import', 'report'] as Step[]).map((s, i) => (
              <span
                key={s}
                className={`step${step === s ? ' active' : ''}${stepIndex(step) > i ? ' done' : ''}`}
              >
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
                  <select
                    value={source}
                    onChange={(e) => onSourceChange(e.target.value as ProviderId)}
                  >
                    {selectableProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="arrow">→</span>
                <label>
                  到
                  <select
                    value={target}
                    onChange={(e) => onTargetChange(e.target.value as ProviderId)}
                  >
                    {selectableProviders.map((p) => (
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
                    const p = providers.find((x) => x.id === pid)!;
                    const ok = detected.some((d) => d.providerId === pid);
                    const loggedIn = isProviderLoggedIn(pid);
                    return (
                      <div key={pid} className="detect-item">
                        <span className={`dot${ok ? ' ok' : ''}`} />
                        <span>{p.name}收藏页</span>
                        {ok ? (
                          <>
                            {pid === 'amap' && (
                              <span className="version-tag">
                                {detected.find((d) => d.providerId === pid)?.version === 'new'
                                  ? '新版'
                                  : '旧版'}
                              </span>
                            )}
                            {loggedIn === false ? (
                              <span className="warn-tag">未登录</span>
                            ) : loggedIn === true ? (
                              <span className="ok-tag">已登录 ✓</span>
                            ) : (
                              <span className="hint">已检测到，登录状态待确认</span>
                            )}
                          </>
                        ) : (
                          <button
                            className="ghost small"
                            onClick={() => void openPage(getAdapter(pid).extractPage)}
                          >
                            打开
                          </button>
                        )}
                      </div>
                    );
                  })}
                <div className="detect-actions">
                  {detecting && <span className="hint">检测中…</span>}
                  <button
                    className="ghost small"
                    disabled={detecting}
                    onClick={() => void refreshDetection()}
                  >
                    刷新检测
                  </button>
                </div>
              </div>
              <p className="hint">请确保地图网址已打开，并完成登录。</p>
              <button
                className="primary"
                disabled={!canStart || busy}
                onClick={() => void newJob()}
              >
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
              ) : null}
              <div className="export-options">
                {!activeProvider && (
                  <label className="field-inline">
                    选择地图
                    <select
                      value={source}
                      onChange={(e) => onSourceChange(e.target.value as ProviderId)}
                    >
                      {selectableProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="field-inline">
                  导出格式
                  <select
                    value={exportFormat}
                    onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                  >
                    <option value="mapbridge">MapBridge JSON（完整备份）</option>
                    <option value="gpx">GPX 1.1（通用交换）</option>
                    <option value="kml">KML 2.2（通用交换）</option>
                  </select>
                </label>
              </div>
              <p className="hint">
                MapBridge JSON 可用于完整恢复；GPX/KML
                适合在其他地图软件中交换，部分平台字段可能无法保留。
              </p>
              <button className="primary" disabled={busy} onClick={() => void startExport()}>
                {busy
                  ? '导出中…'
                  : `导出${activeProvider ? providerName(activeProvider) : '当前地图'}收藏`}
              </button>
              {exportedCount > 0 && (
                <div className="count">
                  已导出 <b>{exportedCount}</b> 条 ✓
                </div>
              )}
              {exportWarnings.length > 0 && (
                <div className="export-warning">⚠ {exportWarnings.join('；')}</div>
              )}
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
                  <select
                    value={target}
                    onChange={(e) => onTargetChange(e.target.value as ProviderId)}
                  >
                    {selectableProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="hint">
                选择已登录的目标地图收藏页，再选择 MapBridge 导出文件（<code>mapbridge-*.json</code>
                ）。
              </p>
              {fileWarnings.length > 0 && (
                <div className="export-warning">⚠ {fileWarnings.join('；')}</div>
              )}
              <label className={`file-btn${busy ? ' disabled' : ''}`}>
                选择文件
                <input
                  type="file"
                  accept="application/json,.json,.gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml"
                  onChange={(e) => void onImportFile(e)}
                  disabled={busy}
                  hidden
                />
              </label>
              {activeProvider && !detectedTab(activeProvider) && (
                <div className="open-right">
                  <button
                    className="ghost small"
                    onClick={() => void openPage(getAdapter(activeProvider).importPage)}
                  >
                    打开目标页
                  </button>
                </div>
              )}
              {!activeProvider && !detectedTab(target) && (
                <div className="open-right">
                  <button
                    className="ghost small"
                    onClick={() => void openPage(getAdapter(target).importPage)}
                  >
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
          <div className="page-actions">
            <button
              className="ghost"
              onClick={() => {
                void refreshJob();
                void refreshDetection();
              }}
            >
              刷新状态
            </button>
          </div>
          {job.items.length > 0 && (
            <div className="count">
              已提取 <b>{job.items.length}</b> 条，其中可导入项目{' '}
              <b>
                {
                  job.items.filter((item) => targetCapabilities?.importKinds.includes(item.kind))
                    .length
                }
              </b>{' '}
              条
              {job.items.some((item) => item.kind === 'route') && (
                <div className="hint">已识别 Route；目标平台支持且交通方式明确时可参与导入。</div>
              )}
            </div>
          )}
          <WizardActions
            previous={
              <button className="ghost" onClick={() => void cancelCurrentJob()}>
                返回
              </button>
            }
            next={
              <button className="primary" disabled={busy} onClick={() => void startExtract()}>
                {busy ? '提取中…' : '开始提取'}
              </button>
            }
            cancel={
              <button className="ghost" onClick={() => void cancelCurrentJob()}>
                取消任务
              </button>
            }
          />
        </section>
      )}

      {step === 'preview' && job && (
        <section className="migration-content preview">
          <h2>预览与编辑</h2>
          <ExtractionWarningPanel skips={job.extractionSkipped} warnings={job.warnings} />
          <div className="preview-tabs" role="tablist" aria-label="导入项目类型">
            <button
              className={`preview-tab${activePreviewTab === 'places' ? ' active' : ''}`}
              role="tab"
              aria-selected={activePreviewTab === 'places'}
              disabled={job.places.length === 0}
              onClick={() => {
                setPreviewTab('places');
                void savePreview(previewPlaces, 'places');
              }}
            >
              地点 <span>({job.places.length}条)</span>
            </button>
            <button
              className={`preview-tab${activePreviewTab === 'routes' ? ' active' : ''}`}
              role="tab"
              aria-selected={activePreviewTab === 'routes'}
              disabled={previewRoutes.length === 0}
              onClick={() => {
                setPreviewTab('routes');
                void savePreview(previewPlaces, 'routes');
              }}
            >
              路线 <span>({previewRoutes.length}条)</span>
            </button>
          </div>
          <div className="preview-panel">
            {activePreviewTab === 'places' ? (
              <PlaceTable
                places={previewPlaces}
                onChange={onPreviewPlacesChange}
                canMatchAmap={job.targetProvider === 'amap' || job.targetProvider === 'baidu'}
                amapPoiMatches={job.amapPoiMatches}
                amapPoiResolutions={job.amapPoiResolutions}
                matchingPlaceIds={matchingPlaceIds}
                matching={matching}
                onMatchAmapPoi={(placeId) => void startAmapMatch(placeId)}
                onMatchAmapPage={(placeIds) => void startAmapMatch(placeIds)}
                onSelectAmapPoi={(placeId, candidate) => void selectAmapPoi(placeId, candidate)}
              />
            ) : (
              <>
                <div className="route-list">
                  {previewRoutes.map((route) => (
                    <RouteSummary key={route.id} route={route} />
                  ))}
                </div>
              </>
            )}
          </div>
          <WizardActions
            previous={
              <button
                className="ghost"
                onClick={() => {
                  if (job.workflow === 'migrate') {
                    void savePreview(previewPlaces, previewTab, 'extract');
                    onStepChange('extract');
                  } else {
                    void cancelCurrentJob();
                  }
                }}
              >
                返回
              </button>
            }
            next={
              <NextImportButton
                disabled={
                  (targetCapabilities?.importKinds.includes('route') ? previewRoutes.length : 0) ===
                    0 && previewPlaces.length === 0
                }
                onClick={async () => {
                  await savePreview(previewPlaces, previewTab, 'import');
                  onStepChange('import');
                }}
              />
            }
            cancel={
              <button className="ghost" onClick={() => void cancelCurrentJob()}>
                取消任务
              </button>
            }
          />
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
            <p className="hint warning">
              另有 {reportRoutes} 条 Route 不会导入：当前目标平台不支持，或路线交通方式无法识别。
            </p>
          )}
          <WizardActions
            previous={
              <button
                className="ghost"
                onClick={() => {
                  void savePreview(previewPlaces, previewTab, 'preview');
                  onStepChange('preview');
                }}
              >
                返回
              </button>
            }
            next={
              <button
                className="primary"
                disabled={busy || reportImportable === 0}
                onClick={() => void startImport()}
              >
                {busy ? '导入中…' : reportImportable === 0 ? '没有可导入的项目' : '开始导入'}
              </button>
            }
            cancel={
              <button className="ghost" onClick={() => void cancelCurrentJob()}>
                取消任务
              </button>
            }
          />
          {busy && (
            <div className="progress">
              <div className="progress-msg">{job.progress?.message ?? '正在导入…'}</div>
            </div>
          )}
        </section>
      )}

      {step === 'report' && job && (
        <section className="migration-content report">
          <h2>
            {job.status === 'done'
              ? '导入完成 ✅'
              : job.status === 'failed'
                ? '导入失败 ❌'
                : '导入中…'}
          </h2>
          <div className="report-meta">
            <span>来源：{providerName(job.sourceProvider)}</span>
            <span>目标：{providerName(job.targetProvider)}</span>
          </div>
          <div className="report-overview" aria-label="导入概览">
            <div>
              <span>原始记录</span>
              <strong>{job.rawCount} 条</strong>
            </div>
            <div>
              <span>已识别项目</span>
              <strong>{job.items.length} 条</strong>
            </div>
            <div>
              <span>可导入项目</span>
              <strong>{reportImportable} 条</strong>
            </div>
          </div>
          {job.status === 'importing' && (
            <div className="import-progress" aria-live="polite">
              <div className="import-progress-header">
                <strong>
                  {job.progress.phase === 'read-existing'
                    ? '读取目标收藏'
                    : job.progress.phase === 'verify'
                      ? '验证导入结果'
                      : '写入目标地图'}
                </strong>
                <span>
                  {job.progress.processed} / {job.progress.total}
                </span>
              </div>
              <div className="import-progress-track">
                <div
                  className="import-progress-bar"
                  style={{
                    width: `${job.progress.total > 0 ? Math.min(100, Math.round((job.progress.processed / job.progress.total) * 100)) : 0}%`,
                  }}
                />
              </div>
              <div className="import-progress-message">{job.progress.message ?? '正在处理…'}</div>
            </div>
          )}
          {job.status !== 'importing' && (
            <div className="report-section">
              <h3>导入结果</h3>
              <div className="report-stats" aria-label="导入统计">
                <div className="report-stat success">
                  <span>成功导入</span>
                  <strong>
                    {job.report?.imported ?? '—'} <small>条</small>
                  </strong>
                </div>
                <div className="report-stat duplicate">
                  <span>重复跳过</span>
                  <strong>
                    {job.report?.skippedDuplicates ?? '—'} <small>条</small>
                  </strong>
                </div>
                <div className="report-stat failure">
                  <span>导入失败</span>
                  <strong>
                    {job.report?.failed ?? '—'} <small>条</small>
                  </strong>
                </div>
              </div>
              {job.report?.targetCount !== undefined && (
                <div className="report-target-total">
                  <span>目标地图导入后总数</span>
                  <strong>{job.report.targetCount} 条</strong>
                </div>
              )}
            </div>
          )}
          {(reportRoutes > 0 || reportSkipped > 0) && (
            <div className="report-section report-excluded">
              <h3>未导入项目</h3>
              <ul>
                {reportRoutes > 0 && <li>{reportRoutes} 条路线（当前目标平台不支持路线导入）</li>}
                {reportSkipped > 0 && <li>{reportSkipped} 条记录（提取阶段未纳入导入）</li>}
              </ul>
            </div>
          )}
          {job.error && <div className="error">{job.error}</div>}
          <ExtractionWarningPanel skips={job.extractionSkipped} warnings={job.warnings} />
          {undoMsg && <div className="count ok-tag">✓ {undoMsg}</div>}
          <div className="actions">
            <button className="ghost" onClick={() => void openPage(targetPage)}>
              去目标页核对
            </button>
            <button className="ghost" onClick={() => onStepChange('setup')}>
              再来一次
            </button>
            {job.status === 'done' &&
              (job.report?.importedIds?.length ?? 0) > 0 &&
              !job.report?.undone && (
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
