import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  Compass,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  ContentBrief,
  CreativeDirection,
  CreativeIntensity,
  CreativeLensKey,
} from '../../types/content';
import {
  CREATIVE_LENSES,
  MAX_ACTIVE_LENSES,
  describeCreativeDirection,
  getCreativeLensOption,
  suggestCreativeDirections,
  updateDirectionSelection,
} from '../../services/content/creativeDirectionService';

interface Props {
  brief: ContentBrief;
  onChange: (direction: CreativeDirection | undefined) => void;
}

const INTENSITY_OPTIONS: Array<{ value: CreativeIntensity; label: string; detail: string }> = [
  { value: 'an_toan', label: 'An toàn', detail: 'Dễ duyệt, bám chuẩn ngành' },
  { value: 'can_bang', label: 'Cân bằng', detail: 'Khác biệt nhưng dễ hiểu' },
  { value: 'tao_bao', label: 'Táo bạo', detail: 'Tương phản mạnh, vẫn đúng Brand Kit' },
];

const CreativeDirectionPanel: React.FC<Props> = ({ brief, onChange }) => {
  const [showSuggestions, setShowSuggestions] = useState(!brief.creativeDirection);
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(
    () => suggestCreativeDirections(brief, 3),
    [brief.topic, brief.intent, brief.approach, brief.audience],
  );
  const direction = brief.creativeDirection;

  const chooseDirection = (value: CreativeDirection) => {
    setError(null);
    setShowSuggestions(false);
    onChange(structuredClone(value));
  };

  const patchDirection = (patch: Partial<CreativeDirection>) => {
    if (!direction) return;
    setError(null);
    onChange({ ...direction, ...patch });
  };

  const changeLens = (lens: CreativeLensKey, optionId: string) => {
    if (!direction) return;
    try {
      setError(null);
      onChange(updateDirectionSelection(direction, lens, optionId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật lăng kính này.');
    }
  };

  return (
    <section className="eg-panel mt-6 overflow-hidden" aria-labelledby="creative-direction-heading">
      <div className="border-b eg-divider p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100">
              <Compass className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="creative-direction-heading" className="text-sm font-semibold text-white">
                  Phòng chiến lược Egoric
                </h2>
                <span className="eg-chip border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100">
                  <Zap className="h-3 w-3" aria-hidden="true" /> 0 credit
                </span>
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-400">
                Hệ thống phối tối đa năm trong 15 lăng kính để tạo một hướng đủ khác biệt nhưng vẫn
                nhất quán. Hướng đã chọn sẽ đi vào cả bài viết lẫn phim ngắn.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {direction && (
              <button
                type="button"
                className="eg-button-secondary inline-flex min-h-11 items-center gap-2 px-4 text-xs font-semibold"
                onClick={() => setShowSuggestions((value) => !value)}
                aria-expanded={showSuggestions}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Đổi hướng
              </button>
            )}
            {direction && (
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/[.08] px-4 text-xs font-semibold text-zinc-400 transition-colors hover:border-white/[.14] hover:text-white"
                onClick={() => onChange(undefined)}
              >
                Chỉ dùng bốn trục
              </button>
            )}
          </div>
        </div>
      </div>

      {showSuggestions && (
        <div className="border-b eg-divider p-5 md:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <Sparkles className="h-4 w-4 text-cyan-100" aria-hidden="true" />
            Ba hướng phù hợp nhất với brief hiện tại
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
            Được tính ngay trên thiết bị, không gọi model. Đổi chủ đề hoặc mục tiêu sẽ tự đổi đề xuất.
          </p>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            {suggestions.map((suggestion) => {
              const selected = direction?.id === suggestion.id;
              return (
                <article
                  key={suggestion.id}
                  className={`flex h-full flex-col rounded-2xl border p-4 transition-colors ${
                    selected
                      ? 'border-cyan-200/35 bg-cyan-200/[.07]'
                      : 'border-white/[.08] bg-black/15 hover:border-white/[.14]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-white">{suggestion.name}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-zinc-400">{suggestion.promise}</p>
                    </div>
                    {selected && (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-200 text-slate-950" aria-label="Đang dùng">
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-[11px] leading-5 text-zinc-500">{suggestion.rationale}</p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {suggestion.selections.map((selection) => (
                      <span key={selection.lens} className="eg-chip border-white/[.08] bg-white/[.025] text-zinc-400">
                        {getCreativeLensOption(selection).label}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={`mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-bold ${
                      selected ? 'eg-button-secondary' : 'eg-button-primary'
                    }`}
                    onClick={() => chooseDirection(suggestion)}
                  >
                    {selected ? 'Đang sử dụng' : 'Dùng hướng này'}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {direction ? (
        <div className="p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="eg-kicker">Hướng đã chốt</div>
              <h3 className="mt-1.5 text-lg font-semibold text-white">{direction.name}</h3>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-400">{direction.promise}</p>
              <p className="mt-2 max-w-2xl text-[11px] leading-5 text-zinc-600">{direction.rationale}</p>
            </div>
            <span className="eg-chip self-start border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              {direction.selections.length}/{MAX_ACTIVE_LENSES} lăng kính
            </span>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
              <div className="eg-kicker">Công thức đang dùng</div>
              <p className="mt-2 text-xs leading-6 text-zinc-300">
                {describeCreativeDirection(direction)}
              </p>
            </div>
            <label className="block rounded-2xl border border-white/[.07] bg-black/15 p-4">
              <span className="eg-kicker">Cường độ sáng tạo</span>
              <select
                className="eg-input mt-2 min-h-11 w-full px-3 text-xs"
                value={direction.intensity}
                onChange={(event) => patchDirection({ intensity: event.target.value as CreativeIntensity })}
              >
                {INTENSITY_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label} — {item.detail}</option>
                ))}
              </select>
            </label>
          </div>

          <details className="mt-4 rounded-2xl border border-white/[.07] bg-black/10">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-semibold text-zinc-300 marker:hidden">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-cyan-100" aria-hidden="true" />
                Tinh chỉnh 15 lăng kính
              </span>
              <ChevronDown className="h-4 w-4 text-zinc-600" aria-hidden="true" />
            </summary>
            <div className="border-t eg-divider p-4">
              <p className="mb-4 text-[11px] leading-5 text-zinc-500">
                Chọn “Không dùng” để bỏ một mục. Hệ thống giữ tối đa năm lăng kính để đầu ra không
                bị xung đột và vẫn dễ duyệt.
              </p>
              {error && (
                <div role="alert" className="mb-4 rounded-xl border border-amber-200/25 bg-amber-200/[.07] px-4 py-3 text-xs text-amber-100">
                  {error}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {CREATIVE_LENSES.map((lens) => {
                  const selected = direction.selections.find((item) => item.lens === lens.key);
                  const current = selected ? getCreativeLensOption(selected) : undefined;
                  return (
                    <label key={lens.key} className={`block rounded-xl border p-3 ${selected ? 'border-cyan-200/20 bg-cyan-200/[.035]' : 'border-white/[.06] bg-black/10'}`}>
                      <span className="text-xs font-semibold text-zinc-300">{lens.label}</span>
                      <span className="mt-1 block min-h-8 text-[10px] leading-4 text-zinc-600">{lens.description}</span>
                      <select
                        className="eg-input mt-2 min-h-11 w-full px-3 text-xs"
                        value={selected?.optionId ?? ''}
                        onChange={(event) => changeLens(lens.key, event.target.value)}
                      >
                        <option value="">Không dùng</option>
                        {lens.options.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      <span className="mt-2 block min-h-8 text-[10px] leading-4 text-zinc-500">
                        {current?.description ?? 'Lăng kính này không tác động vào prompt.'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </details>
        </div>
      ) : (
        !showSuggestions && (
          <div className="p-5 text-center text-xs text-zinc-500 md:p-6">
            Chưa chọn hướng nâng cao. Bài viết sẽ dùng bốn trục trong brief.
          </div>
        )
      )}
    </section>
  );
};

export default CreativeDirectionPanel;
