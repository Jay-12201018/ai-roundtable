import { FlaskConical, Lock, Plug } from 'lucide-react';
import { Button } from '../../components/ui';
import { Logo } from '../shell/Logo';
import { availabilityText } from '../settings/presets';
import './onboarding.css';

/**
 * First use (README 十个已知体验问题 7, D6-A): with no service at all, two ways in — connect a model service (the main
 * path) or try the demo members, which says plainly that their replies are pre-written. Both end in a ready room.
 */
export function Welcome({ onConnect, onDemo, demoBusy, demoError }: { onConnect: () => void; onDemo: () => void; demoBusy: boolean; demoError?: string }) {
  return <div className="welcome"><div className="welcome-inner">
    <span className="welcome-logo" aria-hidden><Logo size={52} /></span>
    <h1>让几位 AI 围坐一桌，替你把问题讨论透</h1>
    <p className="welcome-sub">你是主持人：定目标、点名、插话、随时暂停。先连接一个模型服务，或者用演示成员试一场。</p>
    <div className="start-cards">
      <section className="start-card is-primary" aria-labelledby="welcome-connect"><h2 id="welcome-connect"><Plug aria-hidden size={18} />连接模型服务</h2>
        <p>{availabilityText()}用你自己的 API Key，费用由服务商直接收取。</p>
        <Button variant="primary" onClick={onConnect}>连接…</Button></section>
      <section className="start-card" aria-labelledby="welcome-demo"><h2 id="welcome-demo"><FlaskConical aria-hidden size={18} />先试玩演示</h2>
        <p>用三位演示成员跑一场完整讨论，体验暂停、插话和点名。不联网、不需要 Key、不花钱；回复是预先写好的示例，不代表真实模型的水平。</p>
        <Button disabled={demoBusy} onClick={onDemo}>{demoBusy ? '正在准备…' : '开始试玩'}</Button></section>
    </div>
    {demoError && <p className="field-error" role="alert">{demoError}</p>}
    <ol className="three-steps" aria-label="怎么开始"><li><i>1</i>连接模型</li><li><i>2</i>建房间、选成员（默认起草 · 审查 · 综合）</li><li><i>3</i>写下目标，开始讨论</li></ol>
    <p className="trust"><Lock aria-hidden size={14} />所有数据只保存在这台电脑上。Key 存进系统钥匙串，只会发往你确认过的服务地址。</p>
  </div></div>;
}
