import type { ReactNode } from 'react';
import './SettingsBlock.css';

interface Props {
  id: string;
  title: string;
  description?: string;
  /** 占满整行（用于表格等宽内容）。 */
  fullWidth?: boolean;
  /** 占两列。 */
  doubleWidth?: boolean;
  children: ReactNode;
}

export default function SettingsBlock({ id, title, description, fullWidth, doubleWidth, children }: Props) {
  return (
    <section
      className={`settings-block${fullWidth ? ' settings-block--full' : ''}${doubleWidth ? ' settings-block--double' : ''}`}
      id={id}
    >
      <div className="settings-block-header">
        <div className="settings-block-title-group">
          <h2 className="settings-block-title">{title}</h2>
          {description && <p className="settings-block-desc">{description}</p>}
        </div>
      </div>
      <div className="settings-block-body">{children}</div>
    </section>
  );
}