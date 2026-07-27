import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ImagePlus,
  Lock,
  Loader2,
  ShieldCheck,
  Trash2,
  Unlock,
} from 'lucide-react';
import { AspectRatio, Character, ReferenceAngle } from '../../types';
import { assessCharacterReadiness, collectReferences } from '../../services/consistencyService';

const ANGLE_LABELS: Record<ReferenceAngle, string> = {
  front: 'Chính diện',
  'three-quarter': 'Ba phần tư',
  profile: 'Nghiêng',
  back: 'Sau lưng',
  unknown: 'Chưa rõ',
};

interface Props {
  character: Character;
  currentModelId: string;
  currentAspectRatio: AspectRatio;
  disabled?: boolean;
  onAddReference: (file: File, angle: ReferenceAngle) => void | Promise<void>;
  onApproveReference: (referenceId: string) => void;
  onRemoveReference: (referenceId: string) => void;
  onLock: () => void;
  onUnlock: () => void;
  onImageClick: (imageUrl: string) => void;
}

const CharacterConsistencyPanel: React.FC<Props> = ({
  character,
  currentModelId,
  currentAspectRatio,
  disabled,
  onAddReference,
  onApproveReference,
  onRemoveReference,
  onLock,
  onUnlock,
  onImageClick,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [angle, setAngle] = useState<ReferenceAngle>('three-quarter');
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const references = useMemo(() => collectReferences(character), [character]);
  const readiness = useMemo(() => assessCharacterReadiness(character), [character]);
  const ready = readiness.gaps.length === 0;

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setIsAdding(true);
    try {
      await onAddReference(file, angle);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="mb-3 rounded-2xl border border-white/10 bg-slate-950/45 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="min-h-11 w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        aria-expanded={expanded}
        aria-controls={`consistency-${character.id}`}
      >
        <ShieldCheck className={`w-4 h-4 shrink-0 ${ready ? 'text-emerald-300' : 'text-amber-300'}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-200">Nhất quán nhân vật</span>
          <span className="block text-[10px] text-slate-500 mt-0.5">
            {references.length} ảnh · {character.lock ? `Đã khóa ${character.lock.modelId}` : 'Chưa khóa model'}
          </span>
        </span>
        <span className={`text-[9px] font-bold uppercase tracking-wider ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
          {ready ? 'Sẵn sàng' : `${readiness.gaps.length} cảnh báo`}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div id={`consistency-${character.id}`} className="border-t border-white/10 p-3 space-y-3">
          {readiness.gaps.length > 0 && (
            <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3" role="status">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" /> Cần bổ sung trước khi tạo hàng loạt
              </div>
              <ul className="mt-2 space-y-1 text-[11px] leading-5 text-amber-100/70">
                {readiness.gaps.map((gap) => <li key={gap}>• {gap}</li>)}
              </ul>
            </div>
          )}

          {references.length > 0 && (
            <div className="space-y-2">
              {references.map((reference) => {
                const isBase = reference.imageUrl === character.referenceImage;
                return (
                  <div key={reference.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-2">
                    <button
                      type="button"
                      className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                      onClick={() => onImageClick(reference.imageUrl)}
                      aria-label={`Xem ảnh ${ANGLE_LABELS[reference.angle]} của ${character.name}`}
                    >
                      <img src={reference.imageUrl} alt="" className="h-full w-full object-cover" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold text-slate-200">{ANGLE_LABELS[reference.angle]}</div>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                        {reference.approved ? <CheckCircle2 className="w-3 h-3 text-emerald-300" /> : null}
                        {reference.approved ? 'Đã duyệt' : 'Chưa duyệt'}{isBase ? ' · Ảnh gốc' : ''}
                      </div>
                    </div>
                    {!reference.approved && !isBase && (
                      <button
                        type="button"
                        onClick={() => onApproveReference(reference.id)}
                        disabled={disabled}
                        className="min-h-11 px-3 rounded-xl border border-emerald-300/25 text-[10px] font-bold text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-40"
                      >
                        Duyệt
                      </button>
                    )}
                    {!isBase && (
                      <button
                        type="button"
                        onClick={() => onRemoveReference(reference.id)}
                        disabled={disabled}
                        className="h-11 w-11 inline-flex items-center justify-center rounded-xl border border-red-400/20 text-red-300 hover:bg-red-400/10 disabled:opacity-40"
                        aria-label={`Xóa ảnh ${ANGLE_LABELS[reference.angle]}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
            <label className="block">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Góc ảnh mới</span>
              <select
                value={angle}
                onChange={(event) => setAngle(event.target.value as ReferenceAngle)}
                disabled={disabled || isAdding}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-slate-200 focus:outline-none focus:border-cyan-300/50 disabled:opacity-40"
              >
                {Object.entries(ANGLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value} className="bg-slate-900">{label}</option>
                ))}
              </select>
            </label>
            <div className="sm:self-end">
              <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={handleFile} />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled || isAdding}
                className="min-h-11 w-full px-4 rounded-xl border border-cyan-300/25 text-[10px] font-bold uppercase tracking-wider text-cyan-100 hover:bg-cyan-300/10 disabled:opacity-40 inline-flex items-center justify-center gap-2"
              >
                {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                {isAdding ? 'Đang thêm...' : 'Thêm ảnh'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Khóa lần sinh đã duyệt</div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">
              Giữ nguyên model và tỷ lệ cho các keyframe sau: <span className="font-mono text-slate-300 break-all">{currentModelId} · {currentAspectRatio}</span>
            </p>
            <button
              type="button"
              onClick={character.lock ? onUnlock : onLock}
              disabled={disabled || references.length === 0}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-200 hover:border-cyan-300/35 hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              {character.lock ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {character.lock ? 'Mở khóa model' : 'Khóa model hiện tại'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CharacterConsistencyPanel;
