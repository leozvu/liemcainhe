import React from 'react';
import { Film, Mic2 } from 'lucide-react';
import { ProjectState } from '../../types';
import { STYLES } from './constants';
import { getVoiceStats } from './utils';

interface Props {
  project: ProjectState;
}

const TimelineVisualizer: React.FC<Props> = ({ project }) => {
  const { shots } = project;
  const voiceStats = getVoiceStats(project);
  const selectedByShot = new Map(voiceStats.selectedTakes.map((take) => [take.shotId, take]));

  return (
    <div className="mb-10">
      <div className="flex justify-between text-[10px] text-zinc-600 font-mono uppercase tracking-widest mb-2 px-1">
        <span>Sơ đồ trình tự</span>
        <span>MÃ THỜI GIAN 00:00:00:00</span>
      </div>
      <div className="rounded-2xl border border-white/[.07] bg-black/20 p-3 md:p-4">
        <div className="mb-2 grid grid-cols-[4.5rem_1fr] items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">
            <Film className="h-3.5 w-3.5" /> Hình
          </span>
          <div className={STYLES.timeline.container}>
        {shots.length === 0 ? (
          <div className="w-full flex items-center justify-center text-zinc-800 text-xs font-mono uppercase tracking-widest">
            <Film className="w-4 h-4 mr-2" />
            Chưa có cảnh quay
          </div>
        ) : (
          shots.map((shot, idx) => {
            const isDone = !!shot.interval?.videoUrl;
            return (
              <div 
                key={shot.id} 
                className={`${STYLES.timeline.segment} ${
                  isDone ? STYLES.timeline.segmentComplete : STYLES.timeline.segmentIncomplete
                }`}
                title={`Cảnh quay ${idx+1}: ${shot.actionSummary}`}
              >
                {isDone && <div className="h-full w-full bg-cyan-300/20"></div>}
                
                <div className={STYLES.timeline.tooltip}>
                  <div className="bg-black text-white text-[10px] px-2 py-1 rounded border border-zinc-700 shadow-xl">
                    Cảnh {idx + 1}
                  </div>
                </div>
              </div>
            );
          })
        )}
          </div>
        </div>

        <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.16em] text-zinc-600">
            <Mic2 className="h-3.5 w-3.5" /> Thoại
          </span>
          <div className="flex h-8 min-w-0 gap-1 overflow-hidden rounded-lg bg-white/[.025] p-1">
            {shots.length === 0 ? (
              <div className="flex w-full items-center justify-center font-mono text-[9px] uppercase tracking-widest text-zinc-700">Chưa có bản thu</div>
            ) : shots.map((shot, idx) => {
              const take = selectedByShot.get(shot.id);
              const needsVoice = Boolean(shot.dialogue?.trim());
              return (
                <div
                  key={shot.id}
                  className={`relative min-w-2 flex-1 rounded-sm border ${take ? 'border-emerald-300/25 bg-emerald-300/45' : needsVoice ? 'border-amber-300/15 bg-amber-300/10' : 'border-white/[.04] bg-white/[.025]'}`}
                  title={take ? `Cảnh ${idx + 1}: ${take.source === 'human' ? 'giọng người thật' : take.voiceName || 'bản giọng đã chọn'}` : needsVoice ? `Cảnh ${idx + 1}: chưa chọn bản thoại` : `Cảnh ${idx + 1}: không có lời thoại`}
                />
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-mono text-[9px] uppercase tracking-[.12em] text-zinc-600">
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />Đã chọn {voiceStats.ready}</span>
          <span><i className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300/70" />Còn thiếu {Math.max(0, voiceStats.required - voiceStats.ready)}</span>
        </div>
      </div>
    </div>
  );
};

export default TimelineVisualizer;
