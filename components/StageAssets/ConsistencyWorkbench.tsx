import React from 'react';
import { AlertTriangle, Check, LockKeyhole, PackageCheck, ShieldCheck } from 'lucide-react';
import { ProjectState } from '../../types';
import { assessCharacterReadiness } from '../../services/consistencyService';
import { useLocale } from '../../contexts/LocaleContext';
import { ASSET_TYPE_LABEL_KEYS } from './assetCopy';

interface Props {
  project: ProjectState;
  onToggleBrandAsset: (assetId: string) => void;
}

const ConsistencyWorkbench: React.FC<Props> = ({ project, onToggleBrandAsset }) => {
  const { t } = useLocale();
  const assets = (project.brandKitSnapshot?.assets || []).filter((asset) => asset.url);
  const configuredIds = project.consistency?.lockedBrandAssetIds;
  const isLocked = (assetId: string) => configuredIds === undefined || configuredIds.includes(assetId);
  const characterReports = (project.scriptData?.characters || []).map(assessCharacterReadiness);
  const readyCharacters = characterReports.filter((report) => report.gaps.length === 0).length;
  const lockedScenes = (project.scriptData?.scenes || []).filter((scene) => scene.lock).length;
  const riskCount = characterReports.filter((report) => report.gaps.length > 0).length;

  return (
    <section className="rounded-3xl border border-cyan-200/15 bg-gradient-to-br from-cyan-300/[0.055] via-slate-950/75 to-sky-400/[0.035] p-5 shadow-xl shadow-cyan-950/10">
      <div className="flex flex-col xl:flex-row xl:items-start gap-5">
        <div className="xl:w-72 shrink-0">
          <div className="flex items-center gap-2 text-cyan-200">
            <ShieldCheck className="w-5 h-5" />
            <h3 className="text-sm font-bold uppercase tracking-widest">{t('assets.consistencyLock')}</h3>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            {t('assets.consistencyDescription')}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-lg font-bold text-white">{readyCharacters}/{characterReports.length}</p>
              <p className="text-[8px] uppercase tracking-wider text-zinc-600">{t('assets.readyCharacters')}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className="text-lg font-bold text-white">{lockedScenes}</p>
              <p className="text-[8px] uppercase tracking-wider text-zinc-600">{t('assets.lockedScenes')}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <p className={`text-lg font-bold ${riskCount ? 'text-amber-300' : 'text-emerald-300'}`}>{riskCount}</p>
              <p className="text-[8px] uppercase tracking-wider text-zinc-600">{t('assets.warnings')}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="w-4 h-4 text-zinc-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t('assets.requiredBrandAssets')}</p>
            </div>
            <span className="text-[9px] text-zinc-600">{t('assets.toggleLockHint')}</span>
          </div>

          {assets.length ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {assets.map((asset) => {
                const locked = isLocked(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => onToggleBrandAsset(asset.id)}
                    aria-pressed={locked}
                    aria-label={t(locked ? 'assets.unlockAsset' : 'assets.lockAsset', { type: t(ASSET_TYPE_LABEL_KEYS[asset.type]), name: asset.name })}
                    className={`group min-h-16 flex items-center gap-3 text-left rounded-2xl border p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 ${locked
                      ? 'border-cyan-200/30 bg-cyan-300/[0.07] shadow-md shadow-cyan-950/20'
                      : 'border-white/10 bg-white/[0.025] opacity-55 hover:opacity-90'}`}
                  >
                    <div className="relative w-12 h-12 rounded-xl overflow-hidden bg-black/30 shrink-0">
                      <img src={asset.url} alt={asset.name} loading="lazy" className="w-full h-full object-cover" />
                      {locked && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-300 text-slate-950 grid place-items-center">
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-zinc-200 truncate">{asset.name}</p>
                      <p className="text-[8px] uppercase tracking-wider text-cyan-200/55">{t(ASSET_TYPE_LABEL_KEYS[asset.type])}</p>
                      <p className="text-[9px] text-zinc-600 mt-1 flex items-center gap-1">
                        <LockKeyhole className="w-2.5 h-2.5" />
                        {locked ? t('assets.locked') : t('assets.notUsed')}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-amber-300/20 bg-amber-300/[0.025] px-4 py-3 flex gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-300/70 shrink-0" />
              <p className="text-[10px] leading-relaxed text-amber-100/55">
                {t('assets.noBrandAssets')}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default ConsistencyWorkbench;
