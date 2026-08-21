import { useEffect, useState } from 'react';
import { sendBg } from '@/utils/messaging';
import { DEFAULT_SETTINGS, type AppSettings } from '@/storage/db';
import type { Job } from '@/core/jobs';
import { getAdapter } from '@/adapters';
import SettingsBlock from '@/components/SettingsBlock/SettingsBlock';

const PROVIDER_NAME: Record<string, string> = {
  baidu: '百度地图',
  amap: '高德地图',
  tencent: '腾讯地图',
};

const SIDEBAR_SECTIONS: { category: string; items: { label: string; blockId: string }[] }[] = [
  {
    category: '基本设置',
    items: [{ label: '导入设置', blockId: 'block-import' }],
  },
  {
    category: '数据管理',
    items: [{ label: '历史任务', blockId: 'block-jobs' }],
  },
  {
    category: '关于',
    items: [{ label: '适配器状态', blockId: 'block-adapters' }],
  },
];

const pad2 = (n: number): string => String(n).padStart(2, '0');

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [devLog, setDevLog] = useState<string[]>([]);
  const [devBusy, setDevBusy] = useState(false);
  const [version, setVersion] = useState('');

  const sidebar = import.meta.env.DEV
    ? [...SIDEBAR_SECTIONS, { category: '开发', items: [{ label: '开发工具', blockId: 'block-dev' }] }]
    : SIDEBAR_SECTIONS;

  useEffect(() => {
    void refresh();
    try {
      setVersion(String(browser.runtime.getManifest().version ?? ''));
    } catch {
      /* 无版本号时不显示 */
    }
  }, []);

  function scrollToBlock(blockId: string): void {
    document.getElementById(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function refresh(): Promise<void> {
    const [j, s] = await Promise.all([sendBg({ type: 'list-jobs' }), sendBg({ type: 'get-settings' })]);
    if (j.type === 'jobs') setJobs(j.jobs);
    if (s.type === 'settings') setSettings(s.settings);
  }

  async function remove(id: string): Promise<void> {
    await sendBg({ type: 'delete-job', id });
    await refresh();
  }

  async function save(): Promise<void> {
    await sendBg({ type: 'save-settings', settings });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function devBackupAndClear(): Promise<void> {
    if (devBusy) return;
    setDevBusy(true);
    const lines: string[] = [];
    const logLine = (s: string): void => {
      lines.push(s);
      setDevLog([...lines]);
    };
    setDevLog([]);
    try {
      const det = await sendBg({ type: 'detect-map-tabs' });
      const amap = det.type === 'detected' ? det.tabs.find((t) => t.providerId === 'amap') : undefined;
      if (!amap) {
        logLine('✗ 未检测到已打开的高德标签页');
        return;
      }
      logLine(`✓ 高德标签页 tabId=${amap.tabId}`);

      logLine('读取收藏与文件夹…');
      const read = await sendBg({ type: 'dev-fav-read', tabId: amap.tabId });
      if (read.type !== 'dev-fav-data') {
        logLine(`✗ 读取失败：${read.type === 'error' ? read.message : '未知响应'}`);
        return;
      }
      const fav = read.data.fav as
        | { raw?: unknown; store?: { poi?: { items?: unknown[] }; dir?: { items?: unknown[] } }; savedAt?: number }
        | undefined;
      const store = fav?.store as { poi?: { items?: unknown[] }; dir?: { items?: unknown[] } } | undefined;
      const poiCount = store?.poi?.items?.length ?? 0;
      const dirCount = store?.dir?.items?.length ?? 0;
      const now = new Date();
      const stamp = `${pad2(now.getFullYear())}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
      const filename = `mapbridge-amap-backup-${stamp}.json`;
      const blob = new Blob([JSON.stringify({ savedAt: new Date().toISOString(), ...fav }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      logLine(`✓ 已下载备份 ${filename}（收藏 ${poiCount} 条 · 文件夹 ${dirCount} 个）`);

      logLine('清空收藏…');
      const clear = await sendBg({ type: 'dev-fav-clear', tabId: amap.tabId });
      if (clear.type !== 'dev-fav-cleared') {
        logLine(`✗ 清空失败：${clear.type === 'error' ? clear.message : '未知响应'}`);
        return;
      }
      logLine(`✓ 删除 ${clear.data.deleted} 条 / 失败 ${clear.data.failed} 条 / 剩余 ${clear.data.remaining} 条`);
    } catch (e) {
      logLine(`✗ 出错：${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setDevBusy(false);
    }
  }

  return (
    <div className="options-root">
      <header className="options-header">
        <span className="options-title">MapBridge 设置</span>
        {version && <span className="options-version">v{version}</span>}
        <span className="options-subtitle">地图收藏夹迁移：百度 ↔ 高德 ↔ 腾讯</span>
      </header>

      <div className="options-body">
        <nav className="options-sidebar">
          {sidebar.map((s) => (
            <div key={s.category} className="sidebar-group">
              <span className="sidebar-category">{s.category}</span>
              <ul className="sidebar-links">
                {s.items.map((item) => (
                  <li key={item.blockId}>
                    <a
                      className="sidebar-link"
                      href={`#${item.blockId}`}
                      onClick={(e) => {
                        e.preventDefault();
                        scrollToBlock(item.blockId);
                      }}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className="blocks-container">
          <SettingsBlock id="block-import" title="导入设置" description="迁移任务的默认行为。数据全部保存在本机浏览器，不会上传任何内容。">
            <label className="field">
              <span>导入批间隔（ms）</span>
              <input
                type="number"
                min={0}
                step={100}
                value={settings.importDelayMs}
                onChange={(e) => setSettings({ ...settings, importDelayMs: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>失败重试次数</span>
              <input
                type="number"
                min={0}
                max={5}
                value={settings.retryCount}
                onChange={(e) => setSettings({ ...settings, retryCount: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              <span>默认目标收藏夹名</span>
              <input
                value={settings.defaultFolder}
                onChange={(e) => setSettings({ ...settings, defaultFolder: e.target.value })}
                placeholder="留空 = 并入默认收藏夹"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={settings.skipExisting}
                onChange={(e) => setSettings({ ...settings, skipExisting: e.target.checked })}
              />
              <span>跳过与目标已有收藏重复的项</span>
            </label>
            <div>
              <button className="primary" onClick={() => void save()}>
                {saved ? '已保存 ✓' : '保存设置'}
              </button>
            </div>
          </SettingsBlock>

          <SettingsBlock
            id="block-jobs"
            title="历史任务"
            description="本机的迁移记录。提取、导入的结果都在这里可追溯。"
            fullWidth
          >
            {jobs.length === 0 && <p className="empty">暂无任务。在 popup 向导里新建第一个迁移任务。</p>}
            <table>
              <thead>
                <tr>
                  <th>方向</th>
                  <th>状态</th>
                  <th>条数</th>
                  <th>导入结果</th>
                  <th>更新时间</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {PROVIDER_NAME[job.sourceProvider] ?? job.sourceProvider} →{' '}
                      {PROVIDER_NAME[job.targetProvider] ?? job.targetProvider}
                    </td>
                    <td>
                      <span className={`badge ${job.status}`}>{STATUS_LABEL[job.status] ?? job.status}</span>
                    </td>
                    <td>{job.places.length}</td>
                    <td>
                      {job.report
                        ? `${job.report.imported ?? 0} 成功 / ${job.report.skippedDuplicates ?? 0} 重复 / ${job.report.failed ?? 0} 失败`
                        : '—'}
                    </td>
                    <td className="mono">{new Date(job.updatedAt).toLocaleString()}</td>
                    <td>
                      <button className="ghost" onClick={() => void remove(job.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SettingsBlock>

          <SettingsBlock id="block-adapters" title="适配器状态" description="各平台当前支持的提取 / 导入能力。">
            <ul className="adapter-list">
              {(['baidu', 'amap', 'tencent'] as const).map((id) => {
                const a = getAdapter(id);
                return (
                  <li key={id}>
                    <span>
                      <b>{a.name}</b>
                    </span>
                    <span className="adapter-caps">
                      <span className="cap">提取 {a.capabilities.canExtract ? '✓' : '✗'}</span>
                      <span className="cap">导入 {a.capabilities.canImport ? '✓' : '✗'}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </SettingsBlock>

          {import.meta.env.DEV && (
            <SettingsBlock
              id="block-dev"
              title="开发工具（仅开发版）"
              description="备份高德全部收藏（含文件夹）到本地 JSON 文件，然后清空收藏。用于开发/测试前重置数据，谨慎使用。"
              fullWidth
            >
              <div>
                <button className="danger" disabled={devBusy} onClick={() => void devBackupAndClear()}>
                  {devBusy ? '处理中…' : '备份并清空高德收藏'}
                </button>
              </div>
              {devLog.length > 0 && <pre className="dev-log">{devLog.join('\n')}</pre>}
            </SettingsBlock>
          )}
        </main>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<Job['status'], string> = {
  draft: '草稿',
  extracting: '提取中',
  preview: '预览',
  importing: '导入中',
  done: '完成',
  failed: '失败',
  cancelled: '已取消',
};