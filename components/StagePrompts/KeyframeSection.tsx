import React from 'react';
import { Film } from 'lucide-react';
import { Shot, ScriptData } from '../../types';
import { EditingPrompt, STYLES } from './constants';
import { getDefaultVideoPrompt } from './utils';
import CollapsibleSection from './CollapsibleSection';
import PromptEditor from './PromptEditor';
import StatusBadge from './StatusBadge';

interface Props {
  shots: Shot[];
  scriptData?: ScriptData;
  isExpanded: boolean;
  onToggle: () => void;
  editingPrompt: EditingPrompt;
  onStartEdit: (type: 'keyframe' | 'video', id: string, value: string, variationId: undefined, shotId: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onPromptChange: (value: string) => void;
}

const KeyframeSection: React.FC<Props> = ({
  shots,
  scriptData,
  isExpanded,
  onToggle,
  editingPrompt,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onPromptChange
}) => {
  if (shots.length === 0) return null;

  return (
    <CollapsibleSection
      title="Keyframe storyboard"
      icon={<Film className="w-5 h-5" />}
      count={shots.length}
      isExpanded={isExpanded}
      onToggle={onToggle}
    >
      {shots.map((shot, shotIndex) => {
        const scene = scriptData?.scenes.find(s => s.id === shot.sceneId);
        return (
          <div key={shot.id} className={STYLES.card.base}>
            <div className="mb-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={STYLES.badge.shotNumber}>
                  Cảnh quay {shotIndex + 1}
                </span>
                {scene && (
                  <span className="text-xs text-zinc-500">
                    {scene.location}
                  </span>
                )}
              </div>
              <p className="text-sm text-zinc-400">{shot.actionSummary}</p>
              <p className="text-xs text-zinc-600 mt-1">
                {shot.cameraMovement} · {shot.shotSize || 'Cỡ cảnh tiêu chuẩn'}
              </p>
            </div>

            <div className="space-y-3 pl-4 border-l-2 border-cyan-300/30">
              {shot.keyframes.map((keyframe) => (
                <div key={keyframe.id} className={STYLES.card.nested}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={
                        keyframe.type === 'start' 
                          ? STYLES.badge.keyframeStart 
                          : STYLES.badge.keyframeEnd
                      }>
                        {keyframe.type === 'start' ? 'Khung bắt đầu' : 'Khung kết thúc'}
                      </span>
                      <StatusBadge status={keyframe.status || 'idle'} />
                    </div>
                    <button
                      onClick={() => onStartEdit('keyframe', keyframe.id, keyframe.visualPrompt, undefined, shot.id)}
                      className={STYLES.button.editSmall}
                    >
                      Chỉnh sửa
                    </button>
                  </div>

                  {editingPrompt?.type === 'keyframe' && 
                   editingPrompt.id === keyframe.id && 
                   editingPrompt.shotId === shot.id ? (
                    <PromptEditor
                      value={editingPrompt.value}
                      onChange={onPromptChange}
                      onSave={onSaveEdit}
                      onCancel={onCancelEdit}
                      size="small"
                    />
                  ) : (
                    <p className={STYLES.display.small}>
                      {keyframe.visualPrompt}
                    </p>
                  )}

                  {keyframe.imageUrl && (
                    <div className="mt-2 rounded-xl overflow-hidden border border-white/10">
                      <img 
                        src={keyframe.imageUrl} 
                        alt={`Keyframe ${keyframe.type}`}
                        className="w-full h-auto"
                      />
                    </div>
                  )}
                </div>
              ))}

              {shot.interval && (
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="bg-purple-950/30 border border-purple-500/30 rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={STYLES.badge.videoPrompt}>
                          Prompt tạo video
                        </span>
                        <StatusBadge status={shot.interval.status || 'idle'} />
                      </div>
                      <button
                        onClick={() => {
                          const defaultPrompt = shot.interval!.videoPrompt || getDefaultVideoPrompt(shot);
                          onStartEdit('video', shot.interval!.id, defaultPrompt, undefined, shot.id);
                        }}
                        className={STYLES.button.editVideo}
                      >
                        Chỉnh sửa
                      </button>
                    </div>

                    {editingPrompt?.type === 'video' && editingPrompt.shotId === shot.id ? (
                      <PromptEditor
                        value={editingPrompt.value}
                        onChange={onPromptChange}
                        onSave={onSaveEdit}
                        onCancel={onCancelEdit}
                        size="video"
                        isVideo={true}
                      />
                    ) : (
                      <div className="space-y-2">
                        <p className={STYLES.display.small}>
                          {shot.interval.videoPrompt || (
                            <span className="text-zinc-500">
                              {getDefaultVideoPrompt(shot)}
                              <span className="block mt-1 text-yellow-600/70">
                                Lưu ý: video này không lưu prompt khi tạo; nội dung trên chỉ là suy luận
                              </span>
                            </span>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
};

export default KeyframeSection;
