import React from 'react';
import {
  AudioLines,
  AlertTriangle,
  BookOpenText,
  CheckCircle2,
  ChevronLeft,
  Clapperboard,
  Cpu,
  Film,
  Gauge,
  HelpCircle,
  LibraryBig,
  ListTodo,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { CoreStage, ProjectStage } from '../types';

const LOGO_URL = '/egoric-agency-icon.png';

interface SidebarProps {
  currentStage: string;
  setStage: (stage: ProjectStage) => void;
  onExit: () => void;
  projectName?: string;
  onShowOnboarding?: () => void;
  onShowModelConfig?: () => void;
  workflowProgress?: number;
  stageStatuses?: Partial<Record<CoreStage, 'ready' | 'attention' | 'blocked'>>;
  activeJobCount?: number;
  onOpenProductionCenter?: () => void;
  onOpenOperations?: () => void;
  onOpenCreativeDirector?: () => void;
}

const NAV_ITEMS = [
  { id: 'script' as const, label: 'Kịch bản', detail: 'Phát triển câu chuyện', number: '01', icon: BookOpenText, core: true },
  { id: 'assets' as const, label: 'Tài nguyên', detail: 'Nhân vật và bối cảnh', number: '02', icon: UsersRound, core: true },
  { id: 'voice' as const, label: 'Giọng thoại', detail: 'Casting và bản thu', number: '03', icon: AudioLines, core: true },
  { id: 'director' as const, label: 'Xưởng dựng', detail: 'Khung hình và chuyển động', number: '04', icon: Clapperboard, core: true },
  { id: 'export' as const, label: 'Xuất bản', detail: 'Timeline và kết xuất', number: '05', icon: Film, core: true },
  { id: 'prompts' as const, label: 'Kho sáng tạo', detail: 'Prompt và dữ liệu nâng cao', number: '＋', icon: LibraryBig, core: false },
];

const Sidebar: React.FC<SidebarProps> = ({
  currentStage,
  setStage,
  onExit,
  projectName,
  onShowOnboarding,
  onShowModelConfig,
  workflowProgress = 0,
  stageStatuses = {},
  activeJobCount = 0,
  onOpenProductionCenter,
  onOpenOperations,
  onOpenCreativeDirector,
}) => {
  return (
    <aside className="eg-sidebar select-none" aria-label="Quy trình sản xuất">
      <div className="eg-sidebar-brand">
        <div className="flex min-w-0 items-center gap-3">
          <div className="eg-sidebar-logo flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[.035]">
            <img src={LOGO_URL} alt="Egoric Agency" className="h-8 w-8 object-contain" />
          </div>
          <div className="eg-sidebar-copy min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-white">Egoric Film Studio</div>
            <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[.18em] text-cyan-200/50">Hệ thống sáng tạo của Egoric</div>
          </div>
        </div>
        <button type="button" onClick={onExit} className="eg-sidebar-back eg-icon-button mt-5 flex w-full items-center gap-2 px-3 text-[11px] font-medium" title="Về danh sách dự án">
          <ChevronLeft className="h-4 w-4 shrink-0" />
          <span className="eg-sidebar-copy">Danh sách dự án</span>
        </button>
      </div>

      <button type="button" onClick={onOpenProductionCenter} className="eg-sidebar-project w-full border-y eg-divider px-5 py-4 text-left transition-colors hover:bg-white/[.025]" title="Mở Trung tâm sản xuất">
        <div className="eg-sidebar-copy">
          <div className="eg-kicker">Đang sản xuất</div>
          <div className="mt-1 truncate text-xs font-semibold text-zinc-200" title={projectName}>{projectName || 'Dự án chưa đặt tên'}</div>
          <div className="mt-3 flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-600">
            <span>Trung tâm sản xuất</span><span>{workflowProgress}%</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]" aria-label={`Tiến độ sản xuất ${workflowProgress}%`}>
            <div className="h-full rounded-full bg-[var(--eg-accent)] transition-[width] duration-300" style={{ width: `${workflowProgress}%` }} />
          </div>
          {activeJobCount > 0 && <div className="mt-2 flex items-center gap-1.5 text-[9px] font-medium text-cyan-100/70"><ListTodo className="h-3 w-3" /> {activeJobCount} tác vụ đang chạy</div>}
        </div>
      </button>

      <nav className="eg-sidebar-nav eg-safe-scroll flex-1 space-y-1 overflow-y-auto p-3">
        {NAV_ITEMS.map((item) => {
          const active = currentStage === item.id;
          const status = item.core ? stageStatuses[item.id as CoreStage] : undefined;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setStage(item.id)}
              className={`eg-sidebar-item group relative flex min-h-[58px] w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${
                active
                  ? 'border-cyan-200/25 bg-cyan-200/[.09] text-white'
                  : 'border-transparent text-zinc-500 hover:border-white/[.07] hover:bg-white/[.035] hover:text-zinc-200'
              } ${item.core ? '' : 'eg-sidebar-advanced'}`}
              aria-current={active ? 'step' : undefined}
              title={`${item.label} — ${item.detail}`}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${active ? 'border-cyan-200/20 bg-cyan-200/10 text-cyan-100' : 'border-white/[.06] bg-black/15 text-zinc-600 group-hover:text-zinc-300'}`}>
                <item.icon className="h-4 w-4" />
              </span>
              <span className="eg-sidebar-copy eg-sidebar-item-copy min-w-0 flex-1">
                <span className="eg-sidebar-item-name block truncate text-xs font-semibold">{item.label}</span>
                <span className="eg-sidebar-item-detail mt-0.5 block truncate text-[9px] text-zinc-600 group-hover:text-zinc-500">{item.detail}</span>
              </span>
              <span className="eg-sidebar-copy flex shrink-0 items-center gap-1.5">
                {status === 'ready' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" aria-label="Sẵn sàng" />}
                {status === 'blocked' && <AlertTriangle className="h-3.5 w-3.5 text-rose-300" aria-label="Bị chặn" />}
                {status === 'attention' && <span className="h-2 w-2 rounded-full border border-amber-200/60" aria-label="Cần xử lý" />}
                <span className={`font-mono text-[9px] ${active ? 'text-cyan-100/70' : 'text-zinc-700'}`}>{item.number}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="eg-sidebar-tools border-t eg-divider p-3">
        {onOpenCreativeDirector && (
          <button type="button" onClick={onOpenCreativeDirector} className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-amber-100/70 hover:bg-amber-200/[.06] hover:text-amber-50" title="Mở Đạo diễn AI">
            <Sparkles className="h-4 w-4 shrink-0" /><span className="eg-sidebar-copy text-[11px] font-medium">Đạo diễn AI</span>
          </button>
        )}
        {onOpenOperations && (
          <button type="button" onClick={onOpenOperations} className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-500 hover:bg-white/[.035] hover:text-white" title="Trung tâm vận hành">
            <Gauge className="h-4 w-4 shrink-0" /><span className="eg-sidebar-copy text-[11px] font-medium">Trung tâm vận hành</span>
          </button>
        )}
        {onShowModelConfig && (
          <button type="button" onClick={onShowModelConfig} className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-500 hover:bg-white/[.035] hover:text-white" title="Cấu hình mô hình">
            <Cpu className="h-4 w-4 shrink-0" /><span className="eg-sidebar-copy text-[11px] font-medium">Mô hình và API</span>
          </button>
        )}
        {onShowOnboarding && (
          <button type="button" onClick={onShowOnboarding} className="eg-sidebar-tool flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-zinc-500 hover:bg-white/[.035] hover:text-white" title="Mở hướng dẫn">
            <HelpCircle className="h-4 w-4 shrink-0" /><span className="eg-sidebar-copy text-[11px] font-medium">Hướng dẫn sử dụng</span>
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
