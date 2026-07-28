import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDollarSign,
  CloudCog,
  CloudOff,
  FlaskConical,
  Gauge,
  Loader2,
  MonitorCheck,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  TimerReset,
  UserCheck,
} from 'lucide-react';
import { AgencyCampaign, AgencyClient, ProjectState } from '../types';
import {
  attachCampaignZeroTelemetry,
  attachCampaignZeroWorkspaceProof,
  buildCampaignZeroPaidPreflight,
  buildCampaignZeroSnapshot,
  CampaignZeroGateGroup,
  CampaignZeroRun,
  CampaignZeroStage,
  completeCampaignZeroRun,
  createCampaignZeroRun,
  loadCampaignZeroRun,
  runCampaignZeroTelemetryDryRun,
  saveCampaignZeroRun,
  setCampaignZeroClientProxy,
  setCampaignZeroProviderBalanceBefore,
  setCampaignZeroProviderBalances,
  startCampaignZeroWorkSession,
  stopCampaignZeroWorkSession,
} from '../services/campaignZeroService';
import { getUsageRecords } from '../services/usageService';
import { getBillableLifecycleEvents } from '../services/billableTelemetryService';
import { requestWorkspaceSync, WorkspaceSyncRuntimePhase } from '../services/workspaceSyncCoordinatorService';
import { loadLatestVerifiedWorkspaceFieldTest } from '../services/workspaceFieldTestService';
import { isVoiceProviderConfigured } from '../services/voiceRegistry';

interface Props {
  campaign: AgencyCampaign;
  client: AgencyClient;
  projects: ProjectState[];
}

const STAGE_LABELS: Record<CampaignZeroStage, string> = {
  brief: 'Brief và account',
  'pre-production': 'Tiền kỳ',
  production: 'Sản xuất media',
  review: 'Duyệt nội bộ/khách hàng',
  editing: 'Dựng và hoàn thiện',
  delivery: 'Bàn giao',
  operations: 'Vận hành và đối soát',
};

type PanelCloudPhase = Exclude<WorkspaceSyncRuntimePhase, 'idle'> | 'loading';

const toPanelCloudPhase = (phase: WorkspaceSyncRuntimePhase): PanelCloudPhase =>
  phase === 'idle' ? 'syncing' : phase;

const GROUP_LABELS: Record<CampaignZeroGateGroup, string> = {
  foundation: 'Nền móng',
  instrumentation: 'Đo lường',
  production: 'Sản xuất',
  review: 'Duyệt',
  delivery: 'Bàn giao',
};

const usd = (value?: number): string => value === undefined ? '—' : `${value.toFixed(4)} USD`;

const CampaignZeroPanel: React.FC<Props> = ({ campaign, client, projects }) => {
  const [run, setRun] = useState<CampaignZeroRun | undefined>();
  const [expanded, setExpanded] = useState(false);
  const [proxyName, setProxyName] = useState('');
  const [stage, setStage] = useState<CampaignZeroStage>('pre-production');
  const [balanceBefore, setBalanceBefore] = useState('');
  const [balanceAfter, setBalanceAfter] = useState('');
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isProofLoading, setIsProofLoading] = useState(false);
  const [usageRevision, setUsageRevision] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [cloudPhase, setCloudPhase] = useState<PanelCloudPhase>('loading');

  useEffect(() => {
    let active = true;
    const loadAndSync = async () => {
      setCloudPhase('loading');
      setError('');
      try {
        const local = await loadCampaignZeroRun(campaign.id);
        if (!active) return;
        setRun(local);
        setExpanded(Boolean(local));
        setProxyName(local?.clientProxyName || '');
        setBalanceBefore(local?.providerBalanceBeforeUsd !== undefined ? String(local.providerBalanceBeforeUsd) : '');
        setBalanceAfter(local?.providerBalanceAfterUsd !== undefined ? String(local.providerBalanceAfterUsd) : '');
        setCloudPhase('syncing');
        const report = await requestWorkspaceSync({ full: true });
        const merged = await loadCampaignZeroRun(campaign.id);
        if (!active) return;
        setRun(merged);
        setExpanded(Boolean(merged));
        setProxyName(merged?.clientProxyName || '');
        setBalanceBefore(merged?.providerBalanceBeforeUsd !== undefined ? String(merged.providerBalanceBeforeUsd) : '');
        setBalanceAfter(merged?.providerBalanceAfterUsd !== undefined ? String(merged.providerBalanceAfterUsd) : '');
        setCloudPhase(toPanelCloudPhase(report.phase));
        if (report.phase === 'error') setError(`Không đồng bộ được Campaign 0: ${report.summary}`);
      } catch (nextError) {
        if (!active) return;
        setCloudPhase('error');
        setError(nextError instanceof Error ? nextError.message : 'Không thể tải Campaign 0. Hãy thử đồng bộ lại.');
      }
    };
    void loadAndSync();
    return () => { active = false; };
  }, [campaign.id]);

  useEffect(() => {
    const refresh = () => setUsageRevision((value) => value + 1);
    window.addEventListener('egoric-usage-updated', refresh);
    window.addEventListener('egoric-billable-lifecycle-updated', refresh);
    return () => {
      window.removeEventListener('egoric-usage-updated', refresh);
      window.removeEventListener('egoric-billable-lifecycle-updated', refresh);
    };
  }, []);

  const hasActiveSession = Boolean(run?.workSessions.some((session) => !session.endedAt));
  useEffect(() => {
    if (!hasActiveSession) return undefined;
    const interval = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, [hasActiveSession]);

  const usageRecords = useMemo(() => getUsageRecords(), [usageRevision, run?.updatedAt]);
  const lifecycleEvents = useMemo(() => getBillableLifecycleEvents(), [usageRevision, run?.updatedAt]);
  const snapshot = useMemo(() => buildCampaignZeroSnapshot({
    campaign,
    client,
    projects,
    run,
    usageRecords,
    lifecycleEvents,
    now: clock,
  }), [campaign, client, clock, lifecycleEvents, projects, run, usageRecords]);
  const hasConfiguredVoiceProvider = (['fpt', 'viettel', 'elevenlabs'] as const).some(isVoiceProviderConfigured);
  const paidPreflight = useMemo(() => buildCampaignZeroPaidPreflight({
    campaign,
    run,
    snapshot,
    hasConfiguredVoiceProvider,
  }), [campaign, hasConfiguredVoiceProvider, run, snapshot]);

  const persist = async (next: CampaignZeroRun) => {
    setCloudPhase('syncing');
    setError('');
    const saved = await saveCampaignZeroRun(next);
    setRun(saved);
    const report = await requestWorkspaceSync();
    const merged = await loadCampaignZeroRun(campaign.id);
    setRun(merged || saved);
    setCloudPhase(toPanelCloudPhase(report.phase));
    if (report.phase === 'error') setError(`Không đồng bộ được Campaign 0: ${report.summary}`);
  };

  const mutate = async (operation: (current: CampaignZeroRun) => CampaignZeroRun) => {
    if (!run) return;
    try {
      await persist(operation(run));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể cập nhật Campaign 0.');
      setCloudPhase('error');
    }
  };

  const startRun = async () => {
    try {
      await persist(createCampaignZeroRun(campaign.id));
      setExpanded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không thể bắt đầu Campaign 0.');
      setCloudPhase('error');
    }
  };

  const syncNow = async () => {
    setCloudPhase('syncing');
    setError('');
    try {
      const report = await requestWorkspaceSync({ full: true });
      const merged = await loadCampaignZeroRun(campaign.id);
      setRun(merged);
      setProxyName(merged?.clientProxyName || '');
      setBalanceBefore(merged?.providerBalanceBeforeUsd !== undefined ? String(merged.providerBalanceBeforeUsd) : '');
      setBalanceAfter(merged?.providerBalanceAfterUsd !== undefined ? String(merged.providerBalanceAfterUsd) : '');
      setCloudPhase(toPanelCloudPhase(report.phase));
      if (report.phase === 'error') setError(`Không đồng bộ được Campaign 0: ${report.summary}`);
    } catch (nextError) {
      setCloudPhase('error');
      setError(nextError instanceof Error ? nextError.message : 'Không thể đồng bộ Campaign 0. Hãy thử lại.');
    }
  };

  const runDryTelemetry = async () => {
    if (!run) return;
    setIsDryRunning(true);
    setError('');
    try {
      const report = await runCampaignZeroTelemetryDryRun(campaign.id);
      await persist(attachCampaignZeroTelemetry(run, report));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Telemetry chạy khô thất bại. Hãy thử lại trên bản production.');
    } finally {
      setIsDryRunning(false);
    }
  };

  const importWorkspaceProof = async () => {
    if (!run) return;
    setIsProofLoading(true);
    setError('');
    try {
      const proof = await loadLatestVerifiedWorkspaceFieldTest();
      if (!proof) throw new Error('Chưa có bằng chứng đã chốt. Hãy hoàn tất bài kiểm tra trong Trung tâm đồng bộ trước.');
      await persist(attachCampaignZeroWorkspaceProof(run, proof));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Không nạp được bằng chứng hai thiết bị.');
    } finally {
      setIsProofLoading(false);
    }
  };

  const progressTone = snapshot.progress === 100
    ? 'text-emerald-200'
    : snapshot.progress >= 50 ? 'text-cyan-100' : 'text-amber-200';
  const completed = run?.status === 'completed';
  const syncBusy = cloudPhase === 'loading' || cloudPhase === 'syncing';
  const syncMeta = cloudPhase === 'synced'
    ? { label: 'Đã đồng bộ workspace', tone: 'text-emerald-200 border-emerald-200/20 bg-emerald-200/[.06]', icon: CheckCircle2 }
    : cloudPhase === 'local-only'
      ? { label: 'Chỉ lưu trên máy', tone: 'text-amber-200 border-amber-200/20 bg-amber-200/[.06]', icon: CloudOff }
      : cloudPhase === 'offline'
        ? { label: 'Mất mạng · đã lưu local', tone: 'text-amber-200 border-amber-200/20 bg-amber-200/[.06]', icon: CloudOff }
      : cloudPhase === 'error'
        ? { label: 'Đồng bộ đang lỗi', tone: 'text-rose-200 border-rose-200/20 bg-rose-200/[.06]', icon: AlertTriangle }
        : { label: cloudPhase === 'loading' ? 'Đang tải runbook' : 'Đang đồng bộ', tone: 'text-cyan-100 border-cyan-200/20 bg-cyan-200/[.06]', icon: Loader2 };
  const SyncIcon = syncMeta.icon;

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-white/[.09] bg-[linear-gradient(130deg,rgba(19,27,37,.92),rgba(8,12,17,.96))]">
      <div className="p-5 md:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-200/[.055] text-amber-200">
              <FlaskConical className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="eg-kicker">Golden workflow · không tự tiêu tiền</div>
                <span className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-semibold uppercase tracking-wider ${syncMeta.tone}`}>
                  <SyncIcon className={`h-3 w-3 ${syncBusy ? 'animate-spin' : ''}`} /> {syncMeta.label}
                </span>
              </div>
              <h3 className="mt-1 text-base font-semibold text-white">Campaign 0 — ca vận hành chuẩn đầu tiên</h3>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">
                Gom brief, telemetry, thời gian team, duyệt và đối soát provider vào một đường chạy có bằng chứng. Bản mới nhất được hợp nhất lên workspace cloud; khi mất mạng app vẫn giữ bản local và cho phép thử lại.
              </p>
            </div>
          </div>
          {cloudPhase === 'loading' ? (
            <button type="button" disabled className="eg-button-secondary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-xs font-semibold opacity-50">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải runbook
            </button>
          ) : !run ? (
            <button type="button" onClick={() => void startRun()} disabled={syncBusy} className="eg-button-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-xs font-bold disabled:opacity-50">
              {syncBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Bắt đầu Campaign 0
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void syncNow()} disabled={syncBusy} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50">
                <RefreshCw className={`h-4 w-4 ${syncBusy ? 'animate-spin' : ''}`} /> Đồng bộ ngay
              </button>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="eg-button-secondary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-xs font-semibold"
                aria-expanded={expanded}
                aria-controls={`campaign-zero-${campaign.id}`}
              >
                <Gauge className="h-4 w-4" /> {snapshot.completedGates}/{snapshot.totalGates} cổng
                <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {run && (
          <div className="mt-5" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider">
              <span className="text-zinc-600">Tiến độ Golden Run</span>
              <strong className={`font-mono ${progressTone}`}>{snapshot.progress}%</strong>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]">
              <div className="h-full rounded-full bg-[var(--eg-accent)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${snapshot.progress}%` }} />
            </div>
            {snapshot.nextGate && (
              <div className="mt-4 flex items-start gap-3 rounded-xl border border-cyan-200/[.12] bg-cyan-200/[.035] p-3">
                <Activity className="mt-0.5 h-4 w-4 shrink-0 text-cyan-100" />
                <div><span className="text-[9px] font-semibold uppercase tracking-wider text-cyan-100/70">Việc tiếp theo</span><p className="mt-1 text-xs font-semibold text-white">{snapshot.nextGate.label}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{snapshot.nextGate.detail}</p></div>
              </div>
            )}
          </div>
        )}
      </div>

      {run && expanded && (
        <div id={`campaign-zero-${campaign.id}`} className="border-t eg-divider p-5 md:p-6">
          {error && <div role="alert" className="mb-4 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-xs leading-5 text-rose-100">{error}</div>}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="eg-card p-4"><CircleDollarSign className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">API ước tính</span><strong className="mt-1 block font-mono text-sm text-white">{usd(snapshot.estimatedCostUsd)}</strong><span className="mt-1 block text-[9px] text-zinc-600">{snapshot.requestCount} request · {snapshot.failureCount} lỗi</span></div>
            <div className="eg-card p-4"><ShieldCheck className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">Provider thực tế</span><strong className="mt-1 block font-mono text-sm text-white">{usd(snapshot.actualProviderSpendUsd)}</strong><span className="mt-1 block text-[9px] text-zinc-600">Lệch {usd(snapshot.costVarianceUsd)}</span></div>
            <div className="eg-card p-4"><TimerReset className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">Thời gian team</span><strong className="mt-1 block font-mono text-sm text-white">{snapshot.workMinutes} phút</strong><span className="mt-1 block text-[9px] text-zinc-600">{run.workSessions.filter((session) => session.endedAt).length} phiên đã đóng</span></div>
            <div className="eg-card p-4"><CloudCog className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">Telemetry</span><strong className={`mt-1 block text-sm ${run.telemetry?.cloud === 'synced' && run.telemetry.lifecycle?.cloud === 'synced' ? 'text-emerald-200' : 'text-amber-200'}`}>{run.telemetry?.cloud === 'synced' && run.telemetry.lifecycle?.cloud === 'synced' ? '2/2 đường đã xác nhận' : 'Chưa đủ bằng chứng'}</strong><span className="mt-1 block text-[9px] text-zinc-600">Usage + lifecycle · 0 USD</span></div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
            <section className="eg-card p-5">
              <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">{snapshot.totalGates} cổng bằng chứng</h4></div>
              <div className="mt-4 space-y-5">
                {(Object.keys(GROUP_LABELS) as CampaignZeroGateGroup[]).map((group) => (
                  <div key={group}>
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{GROUP_LABELS[group]}</div>
                    <div className="mt-2 space-y-2">
                      {snapshot.gates.filter((gate) => gate.group === group).map((gate) => (
                        <div key={gate.id} className="flex items-start gap-3 rounded-xl border border-white/[.06] bg-black/10 p-3">
                          {gate.complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-200" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />}
                          <div><p className="text-xs font-semibold text-zinc-200">{gate.label}</p><p className="mt-1 text-xs leading-5 text-zinc-600">{gate.detail}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <section className="eg-card p-5">
                <div className="flex items-center gap-2"><MonitorCheck className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Bằng chứng hai thiết bị</h4></div>
                <p className="mt-2 text-xs leading-5 text-zinc-600">Nạp phiên A ↔ B đã chốt từ cloud. Bằng chứng hết hạn sau 7 ngày và không tiêu credit AI.</p>
                {run.workspaceSyncProof && <div className="mt-3 rounded-xl border border-emerald-200/15 bg-emerald-200/[.04] p-3 text-[10px] leading-5 text-emerald-100/80">Mã {run.workspaceSyncProof.code} · {run.workspaceSyncProof.deviceA.label} ↔ {run.workspaceSyncProof.deviceB?.label}</div>}
                <button type="button" onClick={() => void importWorkspaceProof()} disabled={isProofLoading || syncBusy || completed} className="eg-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50">
                  {isProofLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorCheck className="h-4 w-4" />} {run.workspaceSyncProof ? 'Nạp lại bằng chứng mới nhất' : 'Nạp bằng chứng từ cloud'}
                </button>
              </section>

              <section className="eg-card p-5">
                <div className="flex items-center gap-2"><CloudCog className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Kiểm tra trước khi tốn credit</h4></div>
                <p className="mt-2 text-xs leading-5 text-zinc-600">Ghi usage 0đ và một attempt giả đủ 6 pha, đọc lại local rồi đợi cloud xác nhận. Không gọi model hoặc provider media.</p>
                <button type="button" onClick={() => void runDryTelemetry()} disabled={isDryRunning || syncBusy || completed} className="eg-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50">
                  {isDryRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudCog className="h-4 w-4" />} {isDryRunning ? 'Đang kiểm tra…' : 'Chạy dry-run 0đ'}
                </button>
                <div className={`mt-4 rounded-xl border p-3 ${paidPreflight.ready ? 'border-emerald-200/20 bg-emerald-200/[.045]' : 'border-amber-200/15 bg-amber-200/[.035]'}`}>
                  <div className="flex items-center gap-2">
                    {paidPreflight.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-200" /> : <ShieldCheck className="h-4 w-4 text-amber-200" />}
                    <strong className={`text-[10px] ${paidPreflight.ready ? 'text-emerald-100' : 'text-amber-100'}`}>{paidPreflight.ready ? 'Đã mở cổng paid smoke test' : `Đang khóa request thật · còn ${paidPreflight.blockers.length} điều kiện`}</strong>
                  </div>
                  <div className="mt-3 space-y-2">
                    {paidPreflight.checks.map((check) => <div key={check.id} className="flex items-start gap-2 text-[9px] leading-4"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${check.complete ? 'bg-emerald-200' : 'bg-zinc-700'}`} /><span className={check.complete ? 'text-zinc-400' : 'text-zinc-600'}>{check.label}</span></div>)}
                  </div>
                  {paidPreflight.ready && <p className="mt-3 text-[9px] leading-4 text-emerald-100/70">Sang Lồng tiếng và tạo đúng 1 câu tối đa {paidPreflight.maxTestCharacters} ký tự. App không tự bấm gọi provider.</p>}
                </div>
              </section>

              <section className="eg-card p-5">
                <div className="flex items-center gap-2"><UserCheck className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Người đóng vai khách hàng</h4></div>
                <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Họ tên
                  <input value={proxyName} onChange={(event) => setProxyName(event.target.value)} disabled={syncBusy || completed} className="eg-input mt-2 px-3 text-sm font-normal normal-case tracking-normal disabled:opacity-50" placeholder="Người không tham gia sinh nội dung" />
                </label>
                <button type="button" onClick={() => void mutate((current) => setCampaignZeroClientProxy(current, proxyName))} disabled={syncBusy || completed} className="eg-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><UserCheck className="h-4 w-4" /> Lưu người duyệt proxy</button>
              </section>

              <section className="eg-card p-5">
                <div className="flex items-center gap-2"><TimerReset className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Đồng hồ nhân sự</h4></div>
                <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Công đoạn
                  <select value={stage} onChange={(event) => setStage(event.target.value as CampaignZeroStage)} disabled={Boolean(snapshot.activeSession) || syncBusy || completed} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal disabled:opacity-50">
                    {(Object.keys(STAGE_LABELS) as CampaignZeroStage[]).map((value) => <option key={value} value={value}>{STAGE_LABELS[value]}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => void (snapshot.activeSession ? mutate((current) => stopCampaignZeroWorkSession(current)) : mutate((current) => startCampaignZeroWorkSession(current, stage)))} disabled={syncBusy || completed} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/60 disabled:opacity-50 ${snapshot.activeSession ? 'border-rose-200/20 text-rose-100 hover:bg-rose-200/[.06]' : 'border-white/[.1] text-zinc-200 hover:bg-white/[.05]'}`}>
                  {snapshot.activeSession ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />} {snapshot.activeSession ? `Kết thúc · ${STAGE_LABELS[snapshot.activeSession.stage]}` : 'Bắt đầu tính giờ'}
                </button>
              </section>

              <section className="eg-card p-5">
                <div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Đối soát provider</h4></div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Trước (USD)<input type="number" min="0" step="0.0001" value={balanceBefore} onChange={(event) => setBalanceBefore(event.target.value)} disabled={syncBusy || completed} className="eg-input mt-2 px-3 text-sm font-normal normal-case tracking-normal disabled:opacity-50" /></label>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Sau (USD)<input type="number" min="0" step="0.0001" value={balanceAfter} onChange={(event) => setBalanceAfter(event.target.value)} disabled={syncBusy || completed} className="eg-input mt-2 px-3 text-sm font-normal normal-case tracking-normal disabled:opacity-50" /></label>
                </div>
                <button type="button" onClick={() => void mutate((current) => setCampaignZeroProviderBalanceBefore(current, balanceBefore.trim() ? Number(balanceBefore) : Number.NaN))} disabled={syncBusy || completed} className="eg-button-secondary mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><ShieldCheck className="h-4 w-4" /> Chốt số dư trước test</button>
                <button type="button" onClick={() => void mutate((current) => setCampaignZeroProviderBalances(current, balanceBefore.trim() ? Number(balanceBefore) : Number.NaN, balanceAfter.trim() ? Number(balanceAfter) : Number.NaN))} disabled={syncBusy || completed} className="eg-button-secondary mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><CircleDollarSign className="h-4 w-4" /> Lưu đối soát sau test</button>
              </section>

              <button
                type="button"
                onClick={() => void mutate((current) => completeCampaignZeroRun(current, snapshot))}
                disabled={syncBusy || snapshot.completedGates !== snapshot.totalGates || Boolean(snapshot.activeSession)}
                className="eg-button-primary inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckCircle2 className="h-4 w-4" /> {run.status === 'completed' ? 'Campaign 0 đã hoàn tất' : 'Đóng Campaign 0'}
              </button>
            </div>
          </div>

          <section className="eg-card mt-5 p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-100/60" /><h4 className="text-xs font-semibold text-white">Đối chiếu execution trail</h4></div><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-600">Ghép job, usage và lifecycle theo project/tài nguyên để tìm khoản có thể đã bị provider tính tiền nhưng Dashboard chưa ghi nhận đúng.</p></div>
              <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-[9px] font-semibold uppercase tracking-wider ${snapshot.billable.riskCount ? 'border-rose-200/20 bg-rose-200/[.05] text-rose-100' : 'border-emerald-200/20 bg-emerald-200/[.05] text-emerald-100'}`}>{snapshot.billable.riskCount ? `${snapshot.billable.riskCount} điểm cần xử lý` : 'Không có điểm mù'}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
              {[
                ['Attempt', snapshot.billable.attempts],
                ['Submitted', snapshot.billable.submitted],
                ['Provider nhận', snapshot.billable.providerAccepted],
                ['Hoàn tất', snapshot.billable.completed],
                ['Khớp usage', snapshot.billable.matched],
                ['Interrupted', snapshot.billable.interrupted],
                ['Đã chặn trùng', snapshot.billable.deduplicated],
                ['Rủi ro', snapshot.billable.riskCount],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-white/[.06] bg-black/15 p-3"><span className="block text-[8px] uppercase tracking-wider text-zinc-700">{label}</span><strong className="mt-1 block font-mono text-sm text-zinc-200">{value}</strong></div>)}
            </div>
            {snapshot.billable.issues.length > 0 && <div className="mt-4 space-y-2">{snapshot.billable.issues.slice(0, 8).map((issue) => <div key={issue.id} className="flex items-start gap-3 rounded-xl border border-rose-200/10 bg-rose-200/[.025] p-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-200" /><div><p className="text-[10px] font-semibold text-rose-100">{issue.label}</p><p className="mt-1 text-[9px] leading-4 text-zinc-600">{issue.detail}</p>{issue.providerTaskId && <span className="mt-1 block font-mono text-[8px] text-zinc-700">Task {issue.providerTaskId}</span>}</div></div>)}</div>}
          </section>
        </div>
      )}
    </section>
  );
};

export default CampaignZeroPanel;
