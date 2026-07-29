import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Lightbulb,
  Loader2,
  Palette,
  Pause,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import {
  CreativeDirectorMode,
  CreativeDirectorMission,
  CreativeDirectorProposal,
  ProjectState,
} from '../types';
import {
  applyCreativeDirectorProposal,
  beginCreativeDirectorRun,
  completeCreativeDirectorRun,
  consultCreativeDirector,
  estimateRemainingProductionCost,
  failCreativeDirectorRun,
  rejectCreativeDirectorProposal,
} from '../services/creativeDirectorService';
import { normalizeCreativeDirectorState } from '../services/creativeDirectorState';
import {
  cancelCreativeDirectorMission,
  createCreativeDirectorMission,
  executeCreativeDirectorAction,
  finalizeCreativeDirectorMission,
  getCreativeDirectorMissionRemainingCost,
  getNextRunnableMissionAction,
  markCreativeDirectorActionCompleted,
  markCreativeDirectorActionFailed,
  markCreativeDirectorActionRunning,
  pauseCreativeDirectorMission,
  startCreativeDirectorMission,
} from '../services/creativeDirectorMissionService';

interface CreativeDirectorPanelProps {
  isOpen: boolean;
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onClose: () => void;
  onShowModelConfig: () => void;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
}

type PanelTab = 'chat' | 'plan' | 'moodboard' | 'cost';

const MODE_META: Record<CreativeDirectorMode, { label: string; detail: string }> = {
  advisory: { label: 'Tư vấn', detail: 'Chỉ phân tích và đề xuất, không cho áp dụng vào dự án.' },
  copilot: { label: 'Đồng hành', detail: 'Mọi thay đổi đều chờ bạn duyệt trước.' },
  autopilot: { label: 'Tự động an toàn', detail: 'Tự lưu moodboard và kế hoạch miễn phí; nội dung cốt lõi vẫn cần duyệt.' },
};

const TAB_ITEMS: Array<{ id: PanelTab; label: string; icon: React.ElementType }> = [
  { id: 'chat', label: 'Trao đổi', icon: BrainCircuit },
  { id: 'plan', label: 'Kế hoạch', icon: ClipboardList },
  { id: 'moodboard', label: 'Moodboard', icon: Palette },
  { id: 'cost', label: 'Chi phí', icon: CircleDollarSign },
];

const QUICK_PROMPTS: Record<ProjectState['stage'], string[]> = {
  content: [
    'Gợi ý ba góc tiếp cận khác nhau cho chủ đề đang chọn',
    'Chủ đề này hợp làm phim ngắn hay hợp làm bài viết hơn, vì sao',
    'Chỉ ra điểm yếu của bài viết vừa sinh ra',
    'Đề xuất tuyến nhân vật cho phiên bản phim ngắn',
  ],
  script: [
    'Phản biện kịch bản hiện tại và chỉ ra ba điểm yếu lớn nhất',
    'Đề xuất một hook mạnh hơn cho 5 giây đầu',
    'Tạo storyboard tối ưu theo thời lượng mục tiêu',
    'Xây moodboard điện ảnh cho dự án này',
  ],
  assets: [
    'Kiểm tra continuity nhân vật và bối cảnh',
    'Xây Visual Bible thống nhất cho toàn dự án',
    'Đề xuất prompt tài nguyên dễ giữ nhất quán',
    'Tìm những tài nguyên còn thiếu trước khi tạo ảnh',
  ],
  voice: [
    'Đánh giá nhịp thoại và cảm xúc từng nhân vật',
    'Đề xuất chỉ dẫn diễn xuất giọng nói',
    'Tìm câu thoại quá dài so với thời lượng cảnh',
    'Lập kế hoạch thu voice tiết kiệm nhất',
  ],
  director: [
    'Kiểm tra nhịp dựng và continuity giữa các shot',
    'Đề xuất chuyển động máy quay cho các cảnh tĩnh',
    'Lập timeline rough cut cho toàn bộ video',
    'Tìm các shot có nguy cơ tạo video lỗi',
  ],
  export: [
    'Kiểm tra toàn bộ dự án trước khi xuất bản',
    'Đề xuất timeline và transition tối giản',
    'Lập checklist âm thanh, phụ đề và tỷ lệ khung hình',
    'Tìm các cảnh còn thiếu media phát hành',
  ],
  prompts: [
    'Chuẩn hóa toàn bộ prompt theo một ngôn ngữ hình ảnh',
    'Tìm prompt mơ hồ hoặc mâu thuẫn',
    'Rút gọn prompt nhưng giữ đủ thông tin điện ảnh',
    'Xây negative prompt dùng chung cho dự án',
  ],
};

const formatTime = (value: number): string => new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
}).format(value);

const proposalKindLabel = (proposal: CreativeDirectorProposal): string => ({
  script: 'Kịch bản',
  storyboard: 'Storyboard',
  moodboard: 'Moodboard',
  'production-plan': 'Kế hoạch sản xuất',
  timeline: 'Timeline dựng',
}[proposal.kind]);

const MISSION_STATUS: Record<CreativeDirectorMission['status'], { label: string; tone: string }> = {
  draft: { label: 'Bản nháp', tone: 'text-zinc-400' },
  'awaiting-approval': { label: 'Chờ duyệt', tone: 'text-amber-200' },
  running: { label: 'Đang chạy', tone: 'text-cyan-100' },
  paused: { label: 'Tạm dừng', tone: 'text-amber-200' },
  completed: { label: 'Hoàn tất', tone: 'text-emerald-200' },
  failed: { label: 'Thất bại', tone: 'text-rose-200' },
  cancelled: { label: 'Đã huỷ', tone: 'text-zinc-600' },
};

const ProposalCard: React.FC<{
  proposal: CreativeDirectorProposal;
  mode: CreativeDirectorMode;
  onApply: () => void;
  onReject: () => void;
}> = ({ proposal, mode, onApply, onReject }) => {
  const pending = proposal.status === 'pending';
  const changeCount = Object.values(proposal.changes).filter((value) => value !== undefined).length;
  return (
    <article className="mt-3 overflow-hidden rounded-2xl border border-cyan-200/20 bg-cyan-200/[.045]">
      <div className="border-b border-white/[.07] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100">{proposalKindLabel(proposal)}</span>
              <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{changeCount} nhóm thay đổi</span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-white">{proposal.title}</h3>
          </div>
          {proposal.status !== 'pending' && (
            <span className={`eg-chip ${proposal.status === 'applied' ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'text-zinc-500'}`}>
              {proposal.status === 'applied' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {proposal.status === 'applied' ? 'Đã áp dụng' : 'Đã bỏ qua'}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-zinc-400">{proposal.summary}</p>
      </div>
      <div className="space-y-3 px-4 py-3">
        {proposal.rationale.length > 0 && (
          <div className="space-y-1.5">
            {proposal.rationale.slice(0, 4).map((reason, index) => (
              <div key={`${proposal.id}_reason_${index}`} className="flex items-start gap-2 text-[10px] leading-4 text-zinc-500">
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-cyan-200/60" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[.06] bg-black/20 px-3 py-2">
          <span className="flex items-center gap-2 text-[10px] text-zinc-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-200/70" />
            Áp dụng không gọi API media
          </span>
          <span className="font-mono text-[9px] text-zinc-600">Media dự kiến: ${proposal.estimatedCostUsd.toFixed(2)}</span>
        </div>
        {pending && mode === 'advisory' && (
          <p className="rounded-xl border border-amber-200/15 bg-amber-200/[.05] px-3 py-2 text-[10px] leading-4 text-amber-100/70">
            Chuyển sang chế độ Đồng hành để áp dụng đề xuất vào dự án.
          </p>
        )}
        {pending && mode !== 'advisory' && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" onClick={onApply} className="eg-button-primary inline-flex items-center justify-center gap-2 px-4 text-xs font-bold">
              <Check className="h-4 w-4" /> Duyệt và áp dụng
            </button>
            <button type="button" onClick={onReject} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={`Bỏ qua ${proposal.title}`}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </article>
  );
};

const CreativeDirectorPanel: React.FC<CreativeDirectorPanelProps> = ({
  isOpen,
  project,
  updateProject,
  onClose,
  onShowModelConfig,
  initialPrompt,
  onInitialPromptConsumed,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('chat');
  const [draft, setDraft] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isExecutingMission, setIsExecutingMission] = useState(false);
  const [pausingMissionId, setPausingMissionId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const missionPauseRef = useRef<string | null>(null);
  const handledInitialPromptRef = useRef('');
  const state = useMemo(() => normalizeCreativeDirectorState(project.creativeDirector), [project.creativeDirector]);
  const cost = useMemo(() => estimateRemainingProductionCost(project), [project]);
  const proposalById = useMemo(() => new Map(state.proposals.map((proposal) => [proposal.id, proposal])), [state.proposals]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.setTimeout(() => inputRef.current?.focus(), 220);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'chat') return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [isOpen, activeTab, state.messages.length, isThinking]);

  const setMode = (mode: CreativeDirectorMode) => {
    updateProject((current) => ({
      ...current,
      creativeDirector: { ...normalizeCreativeDirectorState(current.creativeDirector), mode },
    }));
  };

  const setBudget = (value: string) => {
    const budgetLimitUsd = Math.max(0, Math.min(10_000, Number(value) || 0));
    updateProject((current) => ({
      ...current,
      creativeDirector: { ...normalizeCreativeDirectorState(current.creativeDirector), budgetLimitUsd },
    }));
  };

  const submit = async (forcedQuery?: string) => {
    const query = (forcedQuery ?? draft).trim();
    if (!query || isThinking) return;
    setDraft('');
    setError('');
    setSuggestedReplies([]);
    setIsThinking(true);
    const started = beginCreativeDirectorRun(project, query);
    updateProject(started.project);
    try {
      const result = await consultCreativeDirector(started.project, query);
      let next = completeCreativeDirectorRun(started.project, started.run.id, result);
      const currentMode = normalizeCreativeDirectorState(next.creativeDirector).mode;
      const safeAutoApply = currentMode === 'autopilot'
        && result.proposal
        && ['moodboard', 'production-plan', 'timeline'].includes(result.proposal.kind)
        && result.proposal.estimatedCostUsd === 0;
      if (safeAutoApply) next = applyCreativeDirectorProposal(next, result.proposal!.id);
      updateProject(next);
      setSuggestedReplies(result.suggestedReplies);
      const linkedMissionId = normalizeCreativeDirectorState(next.creativeDirector)
        .runs.find((run) => run.id === started.run.id)?.missionId;
      if (linkedMissionId) {
        setActiveTab('plan');
        const mission = normalizeCreativeDirectorState(next.creativeDirector).missions.find((item) => item.id === linkedMissionId);
        if (currentMode === 'autopilot' && mission && mission.actions.length > 0 && mission.estimatedCostUsd <= state.budgetLimitUsd) {
          void runMission(linkedMissionId, next);
        }
      } else if (result.proposal?.kind === 'moodboard') setActiveTab('moodboard');
    } catch (caught: any) {
      const message = caught?.message || 'Không thể kết nối mô hình hội thoại.';
      updateProject((current) => failCreativeDirectorRun(current, started.run.id, message));
      setError(message);
    } finally {
      setIsThinking(false);
    }
  };

  useEffect(() => {
    const prompt = initialPrompt?.trim();
    if (!isOpen || !prompt || isThinking || handledInitialPromptRef.current === prompt) return;
    handledInitialPromptRef.current = prompt;
    onInitialPromptConsumed?.();
    void submit(prompt);
  }, [initialPrompt, isOpen]);

  const applyProposal = (proposalId: string) => {
    const next = applyCreativeDirectorProposal(project, proposalId);
    updateProject(next);
    const linkedMissionId = normalizeCreativeDirectorState(next.creativeDirector)
      .runs.find((run) => run.proposalId === proposalId)?.missionId;
    if (!linkedMissionId) return;
    setActiveTab('plan');
    const nextState = normalizeCreativeDirectorState(next.creativeDirector);
    const mission = nextState.missions.find((item) => item.id === linkedMissionId);
    if (nextState.mode === 'autopilot' && mission && mission.actions.length > 0 && mission.estimatedCostUsd <= nextState.budgetLimitUsd) {
      void runMission(linkedMissionId, next);
    }
  };

  const rejectProposal = (proposalId: string) => {
    updateProject((current) => rejectCreativeDirectorProposal(current, proposalId));
  };

  const runMission = async (missionId: string, baseProject: ProjectState = project) => {
    if (isExecutingMission) return;
    setError('');
    setIsExecutingMission(true);
    setPausingMissionId(null);
    missionPauseRef.current = null;
    let working = baseProject;
    const publishWorking = (next: ProjectState) => {
      working = next;
      updateProject((current) => current.id === next.id ? next : current);
    };
    try {
      working = startCreativeDirectorMission(working, missionId);
      publishWorking(working);

      while (true) {
        const mission = normalizeCreativeDirectorState(working.creativeDirector).missions.find((item) => item.id === missionId);
        if (!mission || mission.status !== 'running') break;
        const action = getNextRunnableMissionAction(mission);
        if (!action) {
          working = finalizeCreativeDirectorMission(working, missionId);
          publishWorking(working);
          break;
        }

        working = markCreativeDirectorActionRunning(working, missionId, action.id);
        publishWorking(working);
        try {
          working = await executeCreativeDirectorAction(working, action, {
            onProjectUpdate: (updated) => {
              publishWorking(updated);
            },
          });
          working = markCreativeDirectorActionCompleted(working, missionId, action.id);
          publishWorking(working);
        } catch (caught: any) {
          const message = caught?.message || `Không thể chạy ${action.label}.`;
          working = markCreativeDirectorActionFailed(working, missionId, action.id, message);
          publishWorking(working);
          const currentAction = normalizeCreativeDirectorState(working.creativeDirector)
            .missions.find((item) => item.id === missionId)?.actions.find((item) => item.id === action.id);
          if (currentAction?.status === 'failed') {
            working = finalizeCreativeDirectorMission(working, missionId);
            publishWorking(working);
            setError(`${action.label}: ${message}`);
            break;
          }
        }

        if (missionPauseRef.current === missionId) {
          working = pauseCreativeDirectorMission(working, missionId);
          publishWorking(working);
          break;
        }
      }
    } catch (caught: any) {
      setError(caught?.message || 'Không thể khởi chạy nhiệm vụ sản xuất.');
    } finally {
      missionPauseRef.current = null;
      setPausingMissionId(null);
      setIsExecutingMission(false);
    }
  };

  const createMission = () => {
    setError('');
    const result = createCreativeDirectorMission(project);
    updateProject(result.project);
    if (result.mission.actions.length === 0) return;
    if (state.mode === 'autopilot' && result.mission.estimatedCostUsd <= state.budgetLimitUsd) {
      void runMission(result.mission.id, result.project);
    }
  };

  const requestPauseMission = (missionId: string) => {
    missionPauseRef.current = missionId;
    setPausingMissionId(missionId);
  };

  const cancelMission = (missionId: string) => {
    updateProject((current) => cancelCreativeDirectorMission(current, missionId));
  };

  if (!isOpen) return null;

  return (
    <div className="eg-director-layer" role="presentation">
      <button type="button" className="eg-director-scrim" onClick={onClose} aria-label="Đóng Đạo diễn AI" />
      <aside className="eg-director-panel" role="dialog" aria-modal="false" aria-labelledby="creative-director-title">
        <header className="shrink-0 border-b eg-divider bg-black/10 px-4 pb-3 pt-4 md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/20 bg-cyan-200/[.08] text-cyan-100">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="eg-kicker">Egoric Intelligence</div>
                <h2 id="creative-director-title" className="mt-1 truncate text-base font-semibold text-white">Đạo diễn AI</h2>
              </div>
            </div>
            <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng Đạo diễn AI">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl border border-white/[.07] bg-black/20 p-1" aria-label="Chế độ Đạo diễn AI">
            {(Object.keys(MODE_META) as CreativeDirectorMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMode(mode)}
                className={`min-h-10 rounded-lg px-2 text-[10px] font-semibold transition-colors ${state.mode === mode ? 'bg-cyan-200/[.12] text-cyan-50' : 'text-zinc-600 hover:bg-white/[.04] hover:text-zinc-300'}`}
                aria-pressed={state.mode === mode}
                title={MODE_META[mode].detail}
              >
                {MODE_META[mode].label}
              </button>
            ))}
          </div>
        </header>

        <nav className="grid shrink-0 grid-cols-4 border-b eg-divider px-2" aria-label="Nội dung Đạo diễn AI">
          {TAB_ITEMS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[9px] font-medium transition-colors ${activeTab === tab.id ? 'text-cyan-100' : 'text-zinc-600 hover:text-zinc-300'}`}
                aria-current={activeTab === tab.id ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {activeTab === tab.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--eg-accent)]" />}
              </button>
            );
          })}
        </nav>

        {activeTab === 'chat' && (
          <>
            <div ref={scrollRef} className="eg-safe-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5" aria-live="polite">
              <div className="space-y-4">
                {state.messages.map((message) => {
                  const proposal = message.proposalId ? proposalById.get(message.proposalId) : undefined;
                  return (
                    <div key={message.id} className={message.role === 'user' ? 'pl-8' : 'pr-3'}>
                      <div className={`rounded-2xl border px-4 py-3 ${message.role === 'user' ? 'border-cyan-200/15 bg-cyan-200/[.07]' : 'border-white/[.07] bg-white/[.025]'}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[.12em] text-zinc-600">
                            {message.role === 'user' ? <Target className="h-3 w-3" /> : <Bot className="h-3 w-3 text-cyan-200/70" />}
                            {message.role === 'user' ? 'Bạn' : 'Đạo diễn AI'}
                          </span>
                          <time className="font-mono text-[8px] text-zinc-700">{formatTime(message.createdAt)}</time>
                        </div>
                        <p className="whitespace-pre-wrap text-[11px] leading-5 text-zinc-300">{message.content}</p>
                      </div>
                      {proposal && (
                        <ProposalCard proposal={proposal} mode={state.mode} onApply={() => applyProposal(proposal.id)} onReject={() => rejectProposal(proposal.id)} />
                      )}
                    </div>
                  );
                })}

                {isThinking && (
                  <div className="pr-8">
                    <div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/[.035] px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
                        <div>
                          <p className="text-[11px] font-medium text-zinc-300">Đang đọc dự án và xây phương án…</p>
                          <p className="mt-1 text-[9px] text-zinc-600">Không có API media nào được gọi ở bước này.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!isThinking && state.messages.length <= 1 && (
                <section className="mt-5">
                  <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-zinc-500"><Lightbulb className="h-3.5 w-3.5 text-amber-200/70" /> Bắt đầu nhanh</div>
                  <div className="space-y-2">
                    {QUICK_PROMPTS[project.stage].map((prompt) => (
                      <button key={prompt} type="button" onClick={() => void submit(prompt)} className="group flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-white/[.025] px-3 text-left text-[10px] leading-4 text-zinc-500 hover:border-cyan-200/20 hover:text-zinc-200">
                        <span>{prompt}</span><ArrowUp className="h-3.5 w-3.5 shrink-0 rotate-45 text-zinc-700 group-hover:text-cyan-200" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <footer className="shrink-0 border-t eg-divider bg-black/15 p-3 md:p-4">
              {error && (
                <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-[10px] leading-4 text-rose-100/80">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0 flex-1"><p>{error}</p><button type="button" onClick={onShowModelConfig} className="mt-2 font-semibold text-cyan-100 underline underline-offset-2">Mở cấu hình mô hình</button></div>
                </div>
              )}
              {suggestedReplies.length > 0 && (
                <div className="eg-safe-scroll mb-3 flex gap-2 overflow-x-auto pb-1">
                  {suggestedReplies.map((reply) => (
                    <button key={reply} type="button" onClick={() => void submit(reply)} className="eg-chip shrink-0 hover:border-cyan-200/20 hover:text-cyan-100">{reply}</button>
                  ))}
                </div>
              )}
              <div className="rounded-2xl border border-white/[.09] bg-white/[.035] p-2 focus-within:border-cyan-200/35 focus-within:ring-2 focus-within:ring-cyan-200/[.06]">
                <label htmlFor="creative-director-prompt" className="sr-only">Yêu cầu Đạo diễn AI</label>
                <textarea
                  ref={inputRef}
                  id="creative-director-prompt"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  rows={2}
                  disabled={isThinking}
                  placeholder="Hỏi về kịch bản, storyboard, moodboard hoặc cách dựng…"
                  className="max-h-32 min-h-14 w-full resize-none bg-transparent px-2 py-2 text-xs leading-5 text-white outline-none placeholder:text-zinc-700 disabled:opacity-50"
                />
                <div className="flex items-center justify-between gap-3 px-1 pb-1">
                  <span className="flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-wider text-zinc-700"><ShieldCheck className="h-3 w-3" /> Duyệt trước thay đổi</span>
                  <button type="button" onClick={() => void submit()} disabled={!draft.trim() || isThinking} className="eg-button-primary flex h-11 min-h-11 w-11 items-center justify-center rounded-xl" aria-label="Gửi yêu cầu">
                    {isThinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </footer>
          </>
        )}

        {activeTab === 'plan' && (
          <div className="eg-safe-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="flex items-start justify-between gap-3">
              <div><div className="eg-kicker">Creative route</div><h3 className="mt-1 text-lg font-semibold text-white">Kế hoạch của agent</h3></div>
              <button
                type="button"
                onClick={createMission}
                disabled={isExecutingMission || state.mode === 'advisory'}
                className="eg-button-secondary inline-flex min-h-10 shrink-0 items-center justify-center gap-2 px-3 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                title={state.mode === 'advisory' ? 'Chuyển sang Đồng hành hoặc Tự động an toàn để tạo nhiệm vụ.' : 'Quét media còn thiếu và dựng chuỗi hành động'}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Quét dự án
              </button>
            </div>

            {error && (
              <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-[10px] leading-4 text-rose-100/80">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1"><p>{error}</p><button type="button" onClick={onShowModelConfig} className="mt-2 font-semibold text-cyan-100 underline underline-offset-2">Mở cấu hình kết nối</button></div>
              </div>
            )}

            {state.missions.length > 0 && (
              <section className="mt-5 space-y-4" aria-label="Nhiệm vụ sản xuất tự động">
                {state.missions.slice(0, 5).map((mission) => {
                  const completed = mission.actions.filter((action) => action.status === 'completed' || action.status === 'skipped').length;
                  const blocked = mission.actions.filter((action) => action.status === 'blocked').length;
                  const failed = mission.actions.filter((action) => action.status === 'failed').length;
                  const remainingCost = getCreativeDirectorMissionRemainingCost(mission);
                  const runningAction = mission.actions.find((action) => action.status === 'running');
                  const canRun = ['draft', 'awaiting-approval', 'paused'].includes(mission.status)
                    && mission.actions.some((action) => action.status === 'pending' || (action.status === 'failed' && action.attempts < action.maxAttempts));
                  const progress = mission.actions.length ? Math.round((completed / mission.actions.length) * 100) : 100;
                  return (
                    <article key={mission.id} className="overflow-hidden rounded-2xl border border-cyan-200/15 bg-cyan-200/[.035]">
                      <div className="border-b border-white/[.07] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-mono text-[9px] uppercase tracking-wider ${MISSION_STATUS[mission.status].tone}`}>
                                {mission.status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
                                {MISSION_STATUS[mission.status].label}
                              </span>
                              <span className="font-mono text-[9px] text-zinc-700">còn ${remainingCost.toFixed(3)} / ${mission.estimatedCostUsd.toFixed(3)}</span>
                            </div>
                            <h4 className="mt-2 text-xs font-semibold text-white">{mission.goal}</h4>
                            <p className="mt-1 text-[9px] text-zinc-600">{completed}/{mission.actions.length} hoàn tất{blocked ? ` · ${blocked} cần cấu hình` : ''}{failed ? ` · ${failed} lỗi` : ''}</p>
                          </div>
                          <span className="font-mono text-sm font-semibold text-cyan-100">{progress}%</span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
                          <div className="h-full rounded-full bg-[var(--eg-accent)] transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>

                      <div className="space-y-2 p-3">
                        {mission.actions.map((action, index) => (
                          <div key={action.id} className="flex items-start gap-3 rounded-xl border border-white/[.055] bg-black/15 px-3 py-2.5">
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${action.status === 'completed' || action.status === 'skipped' ? 'border-emerald-200/20 text-emerald-200' : action.status === 'running' ? 'border-cyan-200/30 text-cyan-100' : action.status === 'failed' || action.status === 'blocked' ? 'border-rose-200/20 text-rose-200' : 'border-white/[.08] text-zinc-700'}`}>
                              {action.status === 'completed' || action.status === 'skipped' ? <Check className="h-3 w-3" /> : action.status === 'running' ? <Loader2 className="h-3 w-3 animate-spin" /> : action.status === 'failed' || action.status === 'blocked' ? <AlertTriangle className="h-3 w-3" /> : <span className="font-mono text-[7px]">{index + 1}</span>}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-[10px] leading-4 ${action.status === 'completed' ? 'text-zinc-500' : 'text-zinc-300'}`}>{action.label}</p>
                              {(action.blockedReason || action.error) && <p className="mt-1 text-[9px] leading-4 text-rose-200/65">{action.blockedReason || action.error}</p>}
                            </div>
                            <span className="shrink-0 font-mono text-[8px] text-zinc-700">${action.estimatedCostUsd.toFixed(3)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 border-t border-white/[.07] p-3">
                        {mission.status === 'running' && (
                          <button type="button" onClick={() => requestPauseMission(mission.id)} disabled={pausingMissionId === mission.id} className="eg-button-secondary inline-flex min-h-10 flex-1 items-center justify-center gap-2 px-3 text-[10px] font-semibold disabled:opacity-50">
                            {pausingMissionId === mission.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
                            {pausingMissionId === mission.id ? 'Dừng sau bước này' : 'Tạm dừng'}
                          </button>
                        )}
                        {canRun && (
                          <button type="button" onClick={() => void runMission(mission.id)} disabled={isExecutingMission || remainingCost > state.budgetLimitUsd || state.mode === 'advisory'} className="eg-button-primary inline-flex min-h-10 flex-1 items-center justify-center gap-2 px-3 text-[10px] font-bold disabled:cursor-not-allowed disabled:opacity-40">
                            {isExecutingMission ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                            {mission.status === 'awaiting-approval' ? 'Duyệt & chạy' : 'Tiếp tục'}
                          </button>
                        )}
                        {!['running', 'completed', 'cancelled'].includes(mission.status) && (
                          <button type="button" onClick={() => cancelMission(mission.id)} className="eg-icon-button flex h-10 w-10 shrink-0 items-center justify-center" aria-label="Huỷ nhiệm vụ"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      {runningAction && <div className="border-t border-cyan-200/10 bg-cyan-200/[.025] px-4 py-2 text-[9px] text-cyan-100/70">Đang thực hiện: {runningAction.label}</div>}
                      {remainingCost > state.budgetLimitUsd && <div className="border-t border-amber-200/10 bg-amber-200/[.035] px-4 py-2 text-[9px] leading-4 text-amber-100/70">Phần còn lại vượt trần ${state.budgetLimitUsd.toFixed(2)}. Tăng ngân sách ở tab Chi phí hoặc hoàn thiện thủ công theo từng phần.</div>}
                    </article>
                  );
                })}
              </section>
            )}

            {state.plan.length === 0 && state.missions.length === 0 ? (
              <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.09] px-6 text-center">
                <ClipboardList className="h-8 w-8 text-zinc-700" />
                <h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có nhiệm vụ tự động</h4>
                <p className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-600">Agent sẽ quét dự án, bỏ qua media đã hợp lệ, dựng chuỗi phụ thuộc và dự toán chi phí trước khi gọi API.</p>
                <button type="button" onClick={createMission} disabled={state.mode === 'advisory'} className="eg-button-primary mt-5 inline-flex items-center justify-center gap-2 px-4 text-xs font-bold disabled:opacity-40"><Sparkles className="h-4 w-4" /> Tạo nhiệm vụ sản xuất</button>
              </div>
            ) : (
              <div className="mt-6 space-y-3 border-t border-white/[.07] pt-5">
                <div className="flex items-center justify-between gap-2"><h4 className="text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600">Lộ trình đề xuất</h4><span className="eg-chip"><ClipboardList className="h-3 w-3" /> {state.plan.length} bước</span></div>
                {state.plan.map((step, index) => (
                  <article key={step.id} className="eg-card p-4">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border font-mono text-[10px] ${step.status === 'ready' ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : step.status === 'blocked' ? 'border-rose-200/20 bg-rose-200/[.07] text-rose-100' : 'border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100'}`}>{String(index + 1).padStart(2, '0')}</span>
                      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="text-xs font-semibold text-white">{step.title}</h4><span className="font-mono text-[8px] uppercase tracking-wider text-zinc-700">{step.stage}</span></div><p className="mt-2 text-[10px] leading-4 text-zinc-500">{step.detail}</p></div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'moodboard' && (
          <div className="eg-safe-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div><div className="eg-kicker">Visual Bible</div><h3 className="mt-1 text-lg font-semibold text-white">{state.moodboard?.title || 'Moodboard dự án'}</h3></div>
            {!state.moodboard ? (
              <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.09] px-6 text-center">
                <Palette className="h-8 w-8 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có Visual Bible</h4><p className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-600">Agent sẽ xây bảng màu, ánh sáng, camera, texture, phục trang và những yếu tố cần tránh.</p><button type="button" onClick={() => { setActiveTab('chat'); void submit('Xây một moodboard và Visual Bible đầy đủ cho dự án hiện tại'); }} className="eg-button-primary mt-5 inline-flex items-center justify-center gap-2 px-4 text-xs font-bold"><Sparkles className="h-4 w-4" /> Tạo moodboard</button>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <p className="text-xs leading-6 text-zinc-400">{state.moodboard.creativeDirection}</p>
                <section className="eg-card p-4"><h4 className="text-xs font-semibold text-white">Bảng màu</h4><div className="mt-4 grid grid-cols-2 gap-2">{state.moodboard.palette.map((color) => <div key={`${color.hex}_${color.name}`} className="overflow-hidden rounded-xl border border-white/[.07] bg-black/20"><div className="h-16" style={{ backgroundColor: color.hex }} /><div className="p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-zinc-200">{color.name}</span><span className="font-mono text-[8px] text-zinc-600">{color.hex}</span></div><p className="mt-1 text-[9px] leading-4 text-zinc-600">{color.usage}</p></div></div>)}</div></section>
                {[
                  ['Ánh sáng', state.moodboard.lighting],
                  ['Máy quay & ống kính', state.moodboard.camera],
                  ['Texture', state.moodboard.textures],
                  ['Phục trang', state.moodboard.wardrobe],
                  ['Typography', state.moodboard.typography],
                  ['Cần tránh', state.moodboard.avoid],
                ].map(([title, items]) => Array.isArray(items) && items.length > 0 ? <section key={title as string} className="eg-card p-4"><h4 className="text-xs font-semibold text-white">{title as string}</h4><div className="mt-3 flex flex-wrap gap-2">{items.map((item) => <span key={item} className="eg-chip">{item}</span>)}</div></section> : null)}
              </div>
            )}
          </div>
        )}

        {activeTab === 'cost' && (
          <div className="eg-safe-scroll min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div><div className="eg-kicker">Budget guard</div><h3 className="mt-1 text-lg font-semibold text-white">Ngân sách sản xuất</h3><p className="mt-2 text-[11px] leading-5 text-zinc-500">Ước tính dựa trên đơn giá bạn đặt tại Trung tâm vận hành. Đây là trần dự toán, không phải báo giá của nhà cung cấp.</p></div>
            <section className="eg-panel mt-5 p-5">
              <div className="flex items-end justify-between gap-3"><div><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">Còn lại dự kiến</span><div className="mt-2 text-3xl font-semibold text-white">${cost.totalUsd.toFixed(2)}</div></div><CircleDollarSign className="h-8 w-8 text-cyan-200/50" /></div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {[
                  ['Hình ảnh', cost.imageUsd, `${cost.missingImages} ảnh`],
                  ['Video', cost.videoUsd, `${cost.videoSeconds}s`],
                  ['Giọng', cost.voiceUsd, `${cost.voiceCharacters} ký tự`],
                  ['Lập kế hoạch', cost.planningUsd, 'ước tính'],
                ].map(([label, value, detail]) => <div key={label as string} className="rounded-xl border border-white/[.07] bg-black/20 p-3"><span className="text-[9px] text-zinc-600">{label as string}</span><strong className="mt-1 block text-sm text-zinc-200">${Number(value).toFixed(3)}</strong><span className="mt-1 block font-mono text-[8px] uppercase tracking-wider text-zinc-700">{detail as string}</span></div>)}
              </div>
            </section>
            <section className="eg-card mt-4 p-4">
              <label htmlFor="director-budget" className="text-xs font-semibold text-white">Trần ngân sách mỗi lần agent lập kế hoạch</label>
              <p className="mt-1 text-[10px] leading-4 text-zinc-600">Agent sẽ không đề xuất một batch media vượt con số này mà không cảnh báo.</p>
              <div className="relative mt-4"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-600">$</span><input id="director-budget" type="number" min="0" step="0.5" value={state.budgetLimitUsd} onChange={(event) => setBudget(event.target.value)} className="eg-input pl-8 pr-3 font-mono text-sm" /></div>
            </section>
            <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${cost.totalUsd > state.budgetLimitUsd ? 'border-amber-200/20 bg-amber-200/[.05]' : 'border-emerald-200/20 bg-emerald-200/[.05]'}`}>
              {cost.totalUsd > state.budgetLimitUsd ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" /> : <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" />}
              <div><h4 className="text-[11px] font-semibold text-zinc-200">{cost.totalUsd > state.budgetLimitUsd ? 'Dự toán đang vượt trần' : 'Dự toán nằm trong trần'}</h4><p className="mt-1 text-[10px] leading-4 text-zinc-500">{cost.totalUsd > state.budgetLimitUsd ? 'Agent sẽ ưu tiên giảm batch, tái sử dụng asset và chia sản xuất thành nhiều lượt duyệt.' : 'Các proposal cấu trúc vẫn miễn phí media và luôn có thể duyệt riêng.'}</p></div>
            </div>
            {state.runs.length > 0 && <section className="mt-6"><div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-zinc-500"><Clock3 className="h-3.5 w-3.5" /> Lịch sử agent</div><div className="space-y-2">{state.runs.slice(0, 8).map((run) => <div key={run.id} className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.02] p-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${run.status === 'failed' ? 'border-rose-200/20 text-rose-200' : run.status === 'thinking' ? 'border-cyan-200/20 text-cyan-200' : 'border-emerald-200/20 text-emerald-200'}`}>{run.status === 'thinking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : run.status === 'failed' ? <AlertTriangle className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}</span><div className="min-w-0 flex-1"><p className="truncate text-[10px] text-zinc-300">{run.query}</p><p className="mt-1 font-mono text-[8px] uppercase tracking-wider text-zinc-700">{run.status} · {formatTime(run.startedAt)}</p></div></div>)}</div></section>}
          </div>
        )}
      </aside>
    </div>
  );
};

export default CreativeDirectorPanel;
