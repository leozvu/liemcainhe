// White-label edition by Egoric Agency
import React from 'react';
import { LayoutDashboard, FileText, Users, Clapperboard, Film, ChevronLeft, ListTree, HelpCircle, Cpu } from 'lucide-react';
const LOGO_URL = '/egoric-agency-icon.png';

interface SidebarProps {
  currentStage: string;
  setStage: (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => void;
  onExit: () => void;
  projectName?: string;
  onShowOnboarding?: () => void;
  onShowModelConfig?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentStage, setStage, onExit, projectName, onShowOnboarding, onShowModelConfig }) => {
  const navItems = [
    { id: 'script', label: 'Sáng tạo kịch bản', icon: FileText, sub: 'Giai đoạn 01' },
    { id: 'assets', label: 'Nhân vật & bối cảnh', icon: Users, sub: 'Giai đoạn 02' },
    { id: 'director', label: 'Xưởng AI', icon: Clapperboard, sub: 'Giai đoạn 03' },
    { id: 'export', label: 'Sản xuất & xuất bản', icon: Film, sub: 'Giai đoạn 04' },
    { id: 'prompts', label: 'Quản lý tài nguyên', icon: ListTree, sub: 'Nâng cao' },
  ];

  return (
    <aside className="w-72 bg-slate-950/75 border-r border-cyan-300/10 h-screen fixed left-0 top-0 flex flex-col z-50 select-none backdrop-blur-2xl shadow-2xl shadow-cyan-950/30">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_34%),linear-gradient(180deg,_rgba(15,23,42,0.7),_rgba(2,6,23,0.92))]" />
      <div className="relative p-6 border-b border-white/10">
        <a 
          href="https://github.com/leozvu/liemcainhe"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 mb-6 group cursor-pointer"
        >
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-cyan-300/20 via-fuchsia-400/20 to-emerald-300/20 border border-white/15 flex items-center justify-center shadow-lg shadow-cyan-500/10 transition-transform group-hover:scale-105">
            <img src={LOGO_URL} alt="Biểu tượng Egoric Agency" className="w-8 h-8 object-contain flex-shrink-0" />
          </div>
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold text-white tracking-wider group-hover:text-cyan-100 transition-colors">Egoric Studio</h1>
            <p className="text-[10px] text-cyan-200/50 tracking-widest group-hover:text-cyan-200/80 transition-colors">BY EGORIC AGENCY</p>
          </div>
        </a>

        <button 
          onClick={onExit}
          className="flex items-center gap-2 text-slate-400 hover:text-cyan-100 transition-colors text-xs font-mono uppercase tracking-wide group"
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          Về danh sách dự án
        </button>
      </div>

      <div className="relative px-6 py-4 border-b border-white/10">
         <div className="text-[10px] text-cyan-200/45 uppercase tracking-widest mb-1">Dự án hiện tại</div>
         <div className="text-sm font-medium text-slate-100 truncate font-mono">{projectName || 'Dự án chưa đặt tên'}</div>
      </div>

      <nav className="relative flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const isActive = currentStage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setStage(item.id as any)}
              className={`w-full flex items-center justify-between px-4 py-4 transition-all duration-200 group relative rounded-2xl border ${
                isActive 
                  ? 'border-cyan-300/40 bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-fuchsia-500/10 text-white shadow-lg shadow-cyan-500/10' 
                  : 'border-white/5 text-slate-400 hover:text-slate-100 hover:bg-white/5 hover:border-white/10'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center border ${
                  isActive ? 'bg-cyan-300/15 border-cyan-200/25' : 'bg-slate-900/70 border-white/5 group-hover:border-white/10'
                }`}>
                  <item.icon className={`w-4 h-4 ${isActive ? 'text-cyan-200' : 'text-slate-500 group-hover:text-cyan-200/70'}`} />
                </span>
                <span className="font-medium text-xs tracking-wider uppercase">{item.label}</span>
              </div>
              <span className={`text-[10px] font-mono ${isActive ? 'text-cyan-100/60' : 'text-slate-600'}`}>{item.sub}</span>
            </button>
          );
        })}
      </nav>

      <div className="relative p-6 border-t border-white/10 space-y-3">
        {onShowOnboarding && (
          <button 
            onClick={onShowOnboarding}
            className="w-full flex items-center justify-between text-slate-500 hover:text-cyan-100 cursor-pointer transition-colors rounded-xl px-3 py-2 hover:bg-white/5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">Hướng dẫn bắt đầu</span>
            <HelpCircle className="w-4 h-4" />
          </button>
        )}
        {onShowModelConfig && (
          <button 
            onClick={onShowModelConfig}
            className="w-full flex items-center justify-between text-slate-500 hover:text-cyan-100 cursor-pointer transition-colors rounded-xl px-3 py-2 hover:bg-white/5"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">Cấu hình mô hình</span>
            <Cpu className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
