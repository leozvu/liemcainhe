import React from 'react';
import { Flame, Loader2, RefreshCw } from 'lucide-react';
import { TrendItem, TrendSource } from '../../types/content';
import { useLocale } from '../../contexts/LocaleContext';

interface Props {
  sources: TrendSource[];
  sourceId: string;
  onSourceChange: (id: string) => void;
  trends: TrendItem[];
  loading: boolean;
  selectedTopic: string;
  onLoad: () => void;
  onPick: (trend: TrendItem) => void;
}

const TrendBoard: React.FC<Props> = ({
  sources,
  sourceId,
  onSourceChange,
  trends,
  loading,
  selectedTopic,
  onLoad,
  onPick,
}) => {
  const { t } = useLocale();

  return (
  <section className="eg-panel p-5" aria-labelledby="trend-heading">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="trend-heading" className="text-sm font-semibold text-white">{t('content.trend.title')}</h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t('content.trend.description')}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <label className="block">
          <span className="eg-kicker">{t('content.trend.source')}</span>
          <select
            className="eg-input mt-2"
            value={sourceId}
            onChange={(event) => onSourceChange(event.target.value)}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.label}
                {source.kind === 'search' ? t('content.trend.searchSuffix') : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="eg-button-secondary min-h-11 px-4" onClick={onLoad} disabled={loading}>
          {loading ? <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 inline h-4 w-4" />}
          {t('content.trend.load')}
        </button>
      </div>
    </div>

    {loading && trends.length === 0 && (
      <p className="mt-5 text-sm text-zinc-500">{t('content.trend.loading')}</p>
    )}

    {!loading && trends.length === 0 && (
      <p className="mt-5 text-sm text-zinc-500">
        {t('content.trend.empty')}
      </p>
    )}

    {trends.length > 0 && (
      <ul className="mt-5 space-y-1.5">
        {trends.map((trend) => {
          const active = trend.title === selectedTopic;
          return (
            <li key={`${trend.sourceId}-${trend.rank}-${trend.title}`}>
              <button
                type="button"
                onClick={() => onPick(trend)}
                aria-pressed={active}
                className={`flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-cyan-200/25 bg-cyan-200/[.09] text-white'
                    : 'border-transparent text-zinc-400 hover:border-white/[.07] hover:bg-white/[.035] hover:text-zinc-200'
                }`}
              >
                <span className={`eg-mono w-6 shrink-0 text-right text-[10px] ${active ? 'text-cyan-100/70' : 'text-zinc-600'}`}>
                  {trend.rank}
                </span>
                {trend.rank <= 3 && <Flame className="h-3.5 w-3.5 shrink-0 text-amber-300/70" aria-label={t('content.trend.hot')} />}
                <span className="min-w-0 flex-1 truncate text-sm">{trend.title}</span>
                <span className="eg-mono shrink-0 text-[9px] uppercase tracking-wider text-zinc-600">
                  {trend.sourceLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    )}
  </section>
  );
};

export default TrendBoard;
