import { useEffect, useState } from 'react';
import { sendBg } from '@/utils/messaging';
import { getAdapter } from '@/adapters';
import type { ProviderId } from '@/core/model';
import type { Job } from '@/core/jobs';
import { restorePopupState } from '@/core/popup-state';
import { serializeItems } from '@/core/export';
import { exportGpx, exportKml } from '@/core/exporters';
import { parsePortableFile } from '@/core/portable-import';
import { getUiSelection, saveUiSelection } from '@/storage/db';
import { IconGear } from '@/components/Icons';
import { PopupView } from './PopupView';

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


export default function App() {
  const [source, setSource] = useState<ProviderId>('baidu');
  const [target, setTarget] = useState<ProviderId>('amap');
  const [step, setStep] = useState<Step>('setup');
  const [job, setJob] = useState<Job | undefined>();
  const [tabId, setTabId] = useState<number | undefined>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchingPlaceIds, setMatchingPlaceIds] = useState<Set<string>>(new Set());
  const [detected, setDetected] = useState<{ providerId: ProviderId; tabId: number; loggedIn?: boolean; version?: 'new' | 'legacy' }[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [mode, setMode] = useState<'migrate' | 'export' | 'import-file'>('migrate');
  const [exportedCount, setExportedCount] = useState(0);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mapbridge');
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [undoMsg, setUndoMsg] = useState('');
  const [selectionReady, setSelectionReady] = useState(false);
  const [previewTab, setPreviewTab] = useState<'places' | 'routes'>('places');
  const [previewPlaces, setPreviewPlaces] = useState<Job['places']>([]);

  // Restore the preference and active task together so async initialization
  // cannot make the entry tab and task phase disagree.
  useEffect(() => {
    let disposed = false;
    void Promise.all([sendBg({ type: 'get-state' }), getUiSelection(), sendBg({ type: 'get-active-tab' })]).then(([state, selection, active]) => {
      if (disposed || state.type !== 'state') return;
      if (active.type === 'active-tab' && active.tabId >= 0) setTabId(active.tabId);
      if (selection.source) setSource(selection.source);
      if (selection.target) setTarget(selection.target);
      const currentTabId = active.type === 'active-tab' && active.tabId >= 0 ? active.tabId : undefined;
      const restored = restorePopupState(
        state.jobs,
        selection,
        currentTabId === undefined ? undefined : state.activeJobIds[String(currentTabId)],
        currentTabId !== undefined,
      );
      setMode(restored.mode);
      setStep(restored.kind === 'active' ? restored.step : 'setup');
      setJob(restored.kind === 'active' ? restored.job : undefined);
      const restoredMatchingIds = restored.kind === 'active'
        ? Object.entries(restored.job.amapPoiMatches ?? {}).filter(([, result]) => result.status === 'matching').map(([placeId]) => placeId)
        : [];
      setMatchingPlaceIds(new Set(restoredMatchingIds));
      setMatching(restoredMatchingIds.length > 0);
      setSelectionReady(true);
    });
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    if (!selectionReady) return;
    void saveUiSelection({ source, target, mode });
  }, [source, target, mode, selectionReady]);


  useEffect(() => {
    if (!job || (job.status !== 'importing' && !matching)) return;
    const timer = setInterval(() => {
      void sendBg({ type: 'get-job', id: job.id }).then((res) => {
        if (res.type !== 'job' || !res.job) return;
        setJob(res.job);
        if (res.job.status === 'done' || res.job.status === 'failed') setMatching(false);
        const activeMatchingIds = Object.entries(res.job.amapPoiMatches ?? {})
          .filter(([, result]) => result.status === 'matching')
          .map(([placeId]) => placeId);
        setMatchingPlaceIds(new Set(activeMatchingIds));
        setMatching(activeMatchingIds.length > 0);
      });
    }, 800);
    return () => clearInterval(timer);
  }, [job?.id, job?.status, matching]);

  useEffect(() => {
    if (step !== 'preview' || !job) return;
    setPreviewTab(job.previewTab ?? (job.places.length > 0 ? 'places' : 'routes'));
    setPreviewPlaces(job.places);
  }, [step, job?.id, job?.previewTab]);

  async function refreshDetection(): Promise<void> {
    setDetecting(true);
    const res = await sendBg({ type: 'detect-map-tabs' });
    if (res.type === 'detected') setDetected(res.tabs);
    setDetecting(false);
  }

  useEffect(() => {
    void refreshDetection();
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
  const reportSkipped = job?.extractionSkipped.filter((item) => item.reason !== '源地图已标记为删除，已跳过').length ?? 0;

  async function newJob(): Promise<Job | undefined> {
    const res = await sendBg({
      type: 'new-job',
      source,
      target,
      sourceTabId: detectedTab(source),
      targetTabId: detectedTab(target),
      ownerTabId: tabId,
    });
    if (res.type === 'job' && res.job) {
      setJob(res.job);
      setStep('extract');
      setError('');
      return res.job;
    }
    return undefined;
  }

  async function cancelCurrentJob(): Promise<void> {
    if (!job || job.status === 'importing') return;
    const res = await sendBg({ type: 'cancel-job', jobId: job.id });
    if (res.type === 'job') {
      setJob(undefined);
      setMatching(false);
      setMatchingPlaceIds(new Set());
      setStep('setup');
      setMode(mode);
      setError('');
    } else if (res.type === 'error') {
      setError(res.message);
    }
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
      const res = await sendBg({ type: 'new-job', source: effectiveSource, target: effectiveSource, workflow: 'export', sourceTabId: detectedTab(effectiveSource) ?? tabId, ownerTabId: tabId });
      if (res.type !== 'job' || !res.job) {
        setError('无法创建导出任务');
        return;
      }
      const exportTabId = detectedTab(effectiveSource) ?? (await currentTabId());
      if (exportTabId === undefined) {
        setError('未检测到源地图收藏页，请打开并登录后重试');
        return;
      }
      const r = await sendBg({ type: 'extract', jobId: res.job.id, tabId: exportTabId });
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
        setJob({ ...job, report: { ...job.report!, undone: data.failed === 0, undoDeleted: data.deleted, undoFailed: data.failed } });
        setUndoMsg(`已撤销导入 ${data.deleted} 条${data.failed > 0 ? `，${data.failed} 条失败` : ''}`);
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
      const source = 'provider' in parsed ? parsed.provider : undefined;
      const res = await sendBg({
        type: 'import-file',
        source,
        target: effectiveTarget,
        items: parsed.items,
        places: parsed.places,
        warnings: 'warnings' in parsed ? parsed.warnings : [],
        targetTabId: detectedTab(effectiveTarget) ?? tabId,
        ownerTabId: tabId,
      });
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

  async function savePreview(places: Job['places'], tab: Job['previewTab'] = previewTab, phase: 'extract' | 'preview' | 'import' = 'preview'): Promise<void> {
    if (!job) return;
    const res = await sendBg({ type: 'preview-update', jobId: job.id, places, previewTab: tab, phase });
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
        // 先在本地切换到明确的导入中状态，避免轮询拿到后台状态前短暂显示旧结果。
        setJob({ ...job, status: 'importing', report: undefined, error: undefined });
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

  async function startAmapMatch(placeIdOrIds: string | string[]): Promise<void> {
    if (!job || !['amap', 'baidu'].includes(job.targetProvider) || job.places.length === 0) return;
    if (matching) return;
    const tabId = detectedTab(job.targetProvider) ?? (await currentTabId());
    if (tabId === undefined) {
      setError(`未检测到${providerName(job.targetProvider)}收藏页，请打开后重试`);
      return;
    }
    const placeIds = Array.isArray(placeIdOrIds) ? placeIdOrIds : [placeIdOrIds];
    const places = previewPlaces.filter((place) => placeIds.includes(place.id));
    if (places.length === 0) return;
    await savePreview(previewPlaces, previewTab);
    setMatchingPlaceIds(Array.isArray(placeIdOrIds) ? new Set() : new Set(placeIds));
    setMatching(true);
    setError('');
    const poll = setInterval(() => {
      void sendBg({ type: 'get-job', id: job.id }).then((res) => {
        if (res.type === 'job' && res.job) setJob(res.job);
      });
    }, 500);
    try {
      const res = await sendBg({ type: 'match-poi', jobId: job.id, tabId, placeIds });
      if (res.type === 'job' && res.job) setJob(res.job);
      else if (res.type === 'error') setError(res.message);
    } finally {
      clearInterval(poll);
      setMatching(false);
      setMatchingPlaceIds(new Set());
    }
  }

  async function selectAmapPoi(placeId: string, candidate?: NonNullable<NonNullable<Job['amapPoiMatches']>[string]['candidates']>[number]): Promise<void> {
    if (!job) return;
    const res = await sendBg(candidate
      ? { type: 'select-poi-match', jobId: job.id, placeId, candidate }
      : { type: 'clear-poi-match', jobId: job.id, placeId });
    if (res.type === 'job') setJob(res.job);
    else if (res.type === 'error') setError(res.message);
  }

  const [ver, setVer] = useState('');
  const dev = import.meta.env.DEV;
  useEffect(() => {
    try { setVer(browser.runtime.getManifest().version); } catch { setVer('dev'); }
  }, []);

  function switchMode(nextMode: 'migrate' | 'export' | 'import-file'): void {
    setMode(nextMode);
    if (step === 'report') {
      setJob(undefined);
      setStep('setup');
      setUndoMsg('');
      setError('');
    }
  }

  return <PopupView
    providers={PROVIDERS}
    selectableProviders={SELECTABLE_PROVIDERS}
    providerName={providerName}
    dev={dev}
    ver={ver}
    error={error}
    mode={mode}
    step={step}
    switchMode={switchMode}
    source={source}
    target={target}
    detected={detected}
    isProviderLoggedIn={isProviderLoggedIn}
    detecting={detecting}
    refreshDetection={refreshDetection}
    openPage={openPage}
    canStart={canStart}
    busy={busy}
    newJob={newJob}
    activeProvider={activeProvider}
    exportFormat={exportFormat}
    setExportFormat={setExportFormat}
    startExport={startExport}
    exportedCount={exportedCount}
    exportWarnings={exportWarnings}
    fileWarnings={fileWarnings}
    onImportFile={onImportFile}
    onSourceChange={setSource}
    onTargetChange={setTarget}
    onPreviewPlacesChange={setPreviewPlaces}
    onStepChange={setStep}
    cancelCurrentJob={cancelCurrentJob}
    job={job}
    targetCapabilities={targetCapabilities}
    detectedTab={detectedTab}
    refreshJob={refreshJob}
    sourcePage={sourcePage}
    targetPage={targetPage}
    startExtract={startExtract}
    previewRoutes={previewRoutes}
    activePreviewTab={activePreviewTab}
    previewTab={previewTab}
    setPreviewTab={setPreviewTab}
    previewPlaces={previewPlaces}
    savePreview={savePreview}
    matchingPlaceIds={matchingPlaceIds}
    matching={matching}
    startAmapMatch={startAmapMatch}
    selectAmapPoi={selectAmapPoi}
    reportImportable={reportImportable}
    reportRoutes={reportRoutes}
    startImport={startImport}
    undoMsg={undoMsg}
    reportSkipped={reportSkipped}
    undoImport={undoImport}
  />;
}
