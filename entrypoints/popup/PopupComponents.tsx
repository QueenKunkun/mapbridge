import type { ReactNode } from 'react';
import type { Job } from '@/core/jobs';

function groupExtractionSkips(skips: Job['extractionSkipped']): { reason: string; items: typeof skips }[] {
  const groups = new Map<string, typeof skips>();
  for (const skip of skips) groups.set(skip.reason, [...(groups.get(skip.reason) ?? []), skip]);
  return Array.from(groups, ([reason, items]) => ({ reason, items }));
}

function formatSkipIndices(items: Job['extractionSkipped']): string {
  return items.map((item) => item.index + 1).join('、');
}

export function ExtractionWarningPanel({ skips, warnings }: { skips: Job['extractionSkipped']; warnings: string[] }) {
  const groups = groupExtractionSkips(skips);
  const otherWarnings = warnings.filter((warning) => skips.length === 0 || !/^第 \d+ 条：/.test(warning));
  if (groups.length === 0 && otherWarnings.length === 0) return null;
  return <div className="export-warning"><strong>提取/解析提示</strong><div className="warning-scroll">
    {groups.length > 0 && <ul>{groups.map((group) => <li key={group.reason}>第 {formatSkipIndices(group.items)} 条：{group.reason}{group.items.some((item) => item.label) && <details><summary>查看记录</summary><ul>{group.items.map((item) => <li key={item.index}>第 {item.index + 1} 条：{item.label ?? '没有可识别的记录信息'}</li>)}</ul></details>}</li>)}</ul>}
    {otherWarnings.length > 0 && <ul>{otherWarnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
  </div></div>;
}

export function NextImportButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void | Promise<void> }) {
  return <button className="primary" disabled={disabled} onClick={() => void onClick()}>下一步：导入 →</button>;
}

export function WizardActions({ previous, next, cancel }: { previous?: ReactNode; next: ReactNode; cancel?: ReactNode }) {
  return <div className="wizard-actions"><div className="wizard-actions-previous">{previous}</div><div className="wizard-actions-next">{next}</div><div className="wizard-actions-cancel">{cancel}</div></div>;
}
