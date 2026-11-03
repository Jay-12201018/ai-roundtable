import type { ReactNode } from 'react';
import { Menu, PanelLeft, PanelRight } from 'lucide-react';
import { Avatar, IconButton } from '../../components/ui';

/** Title, live status, who is at the table, and the 本场信息 toggle. */
export function Topbar({ title, status, detail, members, panel, onMenu, onExpandSidebar, actions }: {
  title: string; status?: ReactNode; detail?: ReactNode; members?: string[];
  panel?: { open: boolean; onToggle: () => void; controls: string }; onMenu?: () => void; onExpandSidebar?: () => void; actions?: ReactNode;
}) {
  return <header className="topbar">
    {onMenu && <IconButton icon={Menu} label="打开导航" onClick={onMenu} />}
    {onExpandSidebar && <IconButton icon={PanelLeft} label="展开导航" onClick={onExpandSidebar} />}
    <div className="tb-title">
      <h1 title={title}>{title}</h1>
      {(status || detail) && <div className="tb-sub" role="status" aria-label="运行状态">{status}{detail && <span className="tb-detail">{detail}</span>}</div>}
    </div>
    <div className="tb-actions">
      {actions}
      {members && members.length > 0 && <span className="avatar-stack tb-members" title={`成员：${members.join('、')}`}>{members.slice(0, 5).map((name, index) => <Avatar key={`${name}-${index}`} name={name} size="sm" />)}</span>}
      {panel && <IconButton icon={PanelRight} label="本场信息" aria-expanded={panel.open} aria-controls={panel.controls} onClick={panel.onToggle} />}
    </div>
  </header>;
}
