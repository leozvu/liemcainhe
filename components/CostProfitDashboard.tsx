import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Download,
  Gauge,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { ProjectState } from '../types';
import {
  AgencyEconomicsWorkspace,
  analyzeAgencyEconomics,
  CampaignFinancialProfile,
  createCampaignFinancialProfile,
  exportAgencyEconomicsCsv,
  getAgencyEconomicsWorkspace,
  saveCampaignFinancialProfile,
} from '../services/agencyEconomicsService';
import { getUsagePolicy, saveUsagePolicy, UsageKind, UsagePolicy } from '../services/usageService';

interface Props {
  project?: ProjectState | null;
}

type PeriodId = 'all' | '30' | '90' | '365';

const PERIODS: Array<{ id: PeriodId; label: string }> = [
  { id: 'all', label: 'Toàn thời gian' },
  { id: '30', label: '30 ngày' },
  { id: '90', label: '90 ngày' },
  { id: '365', label: '12 tháng' },
];

const KIND_LABELS: Record<UsageKind, string> = {
  chat: 'Kịch bản', image: 'Hình ảnh', video: 'Video', voice: 'Voice', cloud: 'Cloud', export: 'Xuất bản',
};

const RATE_META: Record<UsageKind, { key?: keyof UsagePolicy['rates']; label: string }> = {
  chat: { key: 'chatPerMillionCharacters', label: 'USD / 1M ký tự' },
  image: { key: 'imagePerOutput', label: 'USD / ảnh' },
  video: { key: 'videoPerSecond', label: 'USD / giây' },
  voice: { key: 'voicePerThousandCharacters', label: 'USD / 1.000 ký tự' },
  cloud: { label: 'Không tính API' },
  export: { label: 'Render nội bộ' },
};

const formatVnd = (value: number): string => `${Math.round(value).toLocaleString('vi-VN')} ₫`;
const formatUsd = (value: number): string => `$${value.toLocaleString('en-US', { minimumFractionDigits: value < 1 ? 3 : 2, maximumFractionDigits: value < 1 ? 4 : 2 })}`;
const formatPercent = (value: number): string => `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;

const metricTone = (value: number) => value > 0
  ? 'border-emerald-200/20 bg-emerald-200/[.055] text-emerald-100'
  : value < 0 ? 'border-rose-200/20 bg-rose-200/[.055] text-rose-100' : 'border-white/[.08] bg-white/[.025] text-zinc-300';

const CostProfitDashboard: React.FC<Props> = ({ project }) => {
  const [workspace, setWorkspace] = useState<AgencyEconomicsWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('all');
  const [period, setPeriod] = useState<PeriodId>('all');
  const [financialDraft, setFinancialDraft] = useState<CampaignFinancialProfile | null>(null);
  const [usagePolicy, setUsagePolicy] = useState<UsagePolicy>(() => getUsagePolicy());

  const load = async () => {
    setLoading(true);
    setMessage('');
    try {
      const next = await getAgencyEconomicsWorkspace();
      setWorkspace(next);
      setCampaignFilter((current) => current !== 'all'
        ? current
        : project?.campaignId && (next.campaigns.some((campaign) => campaign.id === project.campaignId) || next.financials.some((profile) => profile.campaignId === project.campaignId))
          ? project.campaignId
          : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể tải Cost & Profit Dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('egoric-usage-updated', refresh);
    return () => window.removeEventListener('egoric-usage-updated', refresh);
  }, []);

  const since = period === 'all' ? undefined : Date.now() - Number(period) * 86400000;
  const report = useMemo(
    () => workspace ? analyzeAgencyEconomics(workspace, campaignFilter, since) : null,
    [workspace, campaignFilter, period],
  );
  const allReport = useMemo(() => workspace ? analyzeAgencyEconomics(workspace) : null, [workspace]);
  const campaignOptions = allReport?.campaigns || [];
  const selectedCampaign = campaignOptions.find((campaign) => campaign.campaignId === campaignFilter);

  useEffect(() => {
    if (campaignFilter === 'all' || !workspace) {
      setFinancialDraft(null);
      return;
    }
    const campaign = workspace.campaigns.find((item) => item.id === campaignFilter);
    const client = campaign ? workspace.clients.find((item) => item.id === campaign.clientId) : undefined;
    setFinancialDraft(workspace.financials.find((item) => item.campaignId === campaignFilter)
      || createCampaignFinancialProfile(campaignFilter, campaign?.name || selectedCampaign?.campaignName || campaignFilter, client?.brandName || client?.name || selectedCampaign?.clientName));
  }, [campaignFilter, workspace?.financials, workspace?.campaigns]);

  const saveFinancial = async () => {
    if (!financialDraft || !workspace) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await saveCampaignFinancialProfile(financialDraft);
      setFinancialDraft(saved);
      setWorkspace({ ...workspace, financials: [saved, ...workspace.financials.filter((item) => item.campaignId !== saved.campaignId)] });
      setMessage('Đã lưu giá báo, chi phí nhân sự và giả định tài chính cho chiến dịch.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu dữ liệu tài chính.');
    } finally {
      setSaving(false);
    }
  };

  const saveRateCard = () => {
    saveUsagePolicy(usagePolicy);
    setMessage('Đã lưu rate card. Giá mới áp dụng cho các lượt tạo phát sinh từ bây giờ.');
  };

  const updateModelRate = (modelId: string, kind: UsageKind, value: number) => {
    const rateKey = RATE_META[kind].key;
    if (!rateKey) return;
    setUsagePolicy((current) => ({
      ...current,
      modelRates: {
        ...(current.modelRates || {}),
        [modelId]: { ...(current.modelRates?.[modelId] || {}), [rateKey]: Math.max(0, value || 0) },
      },
    }));
  };

  if (loading || !report || !workspace) {
    return <div className="flex min-h-[520px] items-center justify-center gap-3 text-sm text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang hợp nhất chi phí production…</div>;
  }

  const maxCost = Math.max(report.totals.apiCostVnd, report.totals.laborCostVnd, report.totals.otherCostVnd, 1);
  const lowMargin = report.totals.quotedRevenueVnd > 0 && report.totals.marginPercent < 30;
  const riskyProvider = report.providers.find((provider) => provider.requests >= 3 && (provider.successRate < 75 || provider.approvalRate < 40));

  return (
    <div className="space-y-6">
      <section className="eg-panel relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-cyan-300/[.07] blur-[100px]" />
        <div className="relative flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="eg-chip border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100"><BarChart3 className="h-3 w-3" /> Margin Command Center</span><span className={`eg-chip ${workspace.hosted ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>{workspace.hosted ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{workspace.hosted ? 'Dữ liệu cloud + local' : 'Đang dùng dữ liệu thiết bị'}</span></div>
            <h3 className="mt-4 text-2xl font-semibold tracking-[-.03em] text-white md:text-4xl">Biết giá vốn trước khi báo giá.</h3>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Quy chi phí API về campaign, project và shot; cộng giờ nhân sự, chi phí ngoài rồi đo lợi nhuận thật. Rate card model có thể chỉnh theo hợp đồng nhà cung cấp.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px_auto]">
            <label className="text-xs font-semibold text-zinc-500">Phạm vi chiến dịch<select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)} className="eg-input mt-2 min-h-11 px-3 text-sm font-normal"><option value="all">Toàn bộ portfolio</option>{campaignOptions.map((campaign) => <option key={campaign.campaignId} value={campaign.campaignId}>{campaign.campaignName}</option>)}</select></label>
            <label className="text-xs font-semibold text-zinc-500">Khoảng thời gian<select value={period} onChange={(event) => setPeriod(event.target.value as PeriodId)} className="eg-input mt-2 min-h-11 px-3 text-sm font-normal">{PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="flex items-end gap-2"><button type="button" onClick={() => void load()} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Làm mới dashboard"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={() => exportAgencyEconomicsCsv(report)} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><Download className="h-4 w-4" /> CSV</button></div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số tài chính chính">
        {[
          { label: 'Giá báo khách hàng', value: formatVnd(report.totals.quotedRevenueVnd), detail: `${report.campaigns.length} campaign`, icon: WalletCards, tone: 'text-white' },
          { label: 'Tổng giá vốn', value: formatVnd(report.totals.totalCostVnd), detail: `${formatVnd(report.totals.apiCostVnd)} API`, icon: CircleDollarSign, tone: 'text-white' },
          { label: 'Lợi nhuận ước tính', value: formatVnd(report.totals.profitVnd), detail: report.totals.quotedRevenueVnd ? `Margin ${formatPercent(report.totals.marginPercent)}` : 'Chưa nhập giá báo', icon: report.totals.profitVnd >= 0 ? TrendingUp : TrendingDown, tone: report.totals.profitVnd >= 0 ? 'text-emerald-100' : 'text-rose-100' },
          { label: 'Lượt tạo lại', value: report.totals.regenerateCount.toLocaleString('vi-VN'), detail: `${report.totals.failures} lỗi / ${report.totals.requests} requests`, icon: RefreshCw, tone: 'text-amber-100' },
        ].map((item) => <article key={item.label} className="eg-panel p-5"><div className="flex items-start justify-between gap-3"><span className="text-xs font-semibold text-zinc-500">{item.label}</span><item.icon className={`h-5 w-5 ${item.tone}`} /></div><strong className={`mt-5 block font-mono text-2xl tracking-[-.03em] ${item.tone}`}>{item.value}</strong><span className="mt-2 block text-xs text-zinc-600">{item.detail}</span></article>)}
      </section>

      {(lowMargin || riskyProvider || report.totals.quotedRevenueVnd === 0) && (
        <section className="grid gap-3 lg:grid-cols-3" aria-label="Cảnh báo vận hành">
          {report.totals.quotedRevenueVnd === 0 && <div className="flex items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[.055] p-4 text-amber-100"><BadgeDollarSign className="mt-0.5 h-4 w-4 shrink-0" /><div><h4 className="text-xs font-semibold">Chưa có giá báo</h4><p className="mt-1 text-xs leading-5 opacity-75">Chọn từng campaign và nhập giá khách hàng để tính profit/margin.</p></div></div>}
          {lowMargin && <div className="flex items-start gap-3 rounded-2xl border border-rose-200/20 bg-rose-200/[.055] p-4 text-rose-100"><TrendingDown className="mt-0.5 h-4 w-4 shrink-0" /><div><h4 className="text-xs font-semibold">Biên lợi nhuận dưới 30%</h4><p className="mt-1 text-xs leading-5 opacity-75">Rà shot đốt tiền, rate model và giờ nhân sự trước khi nhận thêm vòng sửa.</p></div></div>}
          {riskyProvider && <div className="flex items-start gap-3 rounded-2xl border border-amber-200/20 bg-amber-200/[.055] p-4 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><h4 className="text-xs font-semibold">Provider cần xem lại</h4><p className="mt-1 text-xs leading-5 opacity-75">{riskyProvider.providerId} · {riskyProvider.modelId}: thành công {formatPercent(riskyProvider.successRate)}, nghiệm thu {formatPercent(riskyProvider.approvalRate)}.</p></div></div>}
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start gap-3"><Layers3 className="mt-0.5 h-5 w-5 text-cyan-200" /><div><div className="eg-kicker">Cost structure</div><h3 className="mt-1 text-base font-semibold text-white">Cơ cấu giá vốn</h3><p className="mt-2 text-xs leading-5 text-zinc-500">API quy đổi theo tỷ giá của từng campaign. Nhân sự và chi phí khác lấy từ hồ sơ thương mại.</p></div></div>
          <div className="mt-6 space-y-5">
            {[
              { label: 'API & AI media', value: report.totals.apiCostVnd, className: 'bg-cyan-200', icon: Sparkles },
              { label: 'Nhân sự production', value: report.totals.laborCostVnd, className: 'bg-violet-200', icon: UsersRound },
              { label: 'Chi phí ngoài', value: report.totals.otherCostVnd, className: 'bg-amber-200', icon: Activity },
            ].map((item) => <div key={item.label}><div className="flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2 text-zinc-400"><item.icon className="h-4 w-4" /> {item.label}</span><strong className="font-mono text-white">{formatVnd(item.value)}</strong></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[.06]" role="progressbar" aria-label={`${item.label}: ${formatVnd(item.value)}`} aria-valuenow={item.value} aria-valuemax={maxCost}><div className={`h-full rounded-full ${item.className}`} style={{ width: `${Math.max(item.value ? 3 : 0, (item.value / maxCost) * 100)}%` }} /></div></div>)}
          </div>
          <div className={`mt-6 rounded-2xl border p-4 ${metricTone(report.totals.profitVnd)}`}><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">Profit sau giá vốn</span><strong className="font-mono text-lg">{formatVnd(report.totals.profitVnd)}</strong></div><p className="mt-2 text-xs leading-5 opacity-70">Số liệu chưa bao gồm thuế, phí thanh toán và chi phí sales nếu team chưa nhập vào “chi phí khác”.</p></div>
        </div>

        <div className="eg-panel p-5 md:p-6">
          <div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><BadgeDollarSign className="mt-0.5 h-5 w-5 text-cyan-200" /><div><div className="eg-kicker">Commercial inputs</div><h3 className="mt-1 text-base font-semibold text-white">Giá báo và nguồn lực</h3></div></div>{selectedCampaign && <span className="eg-chip">{selectedCampaign.clientName}</span>}</div>
          {!financialDraft ? <div className="mt-6 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.1] p-6 text-center"><Gauge className="h-8 w-8 text-zinc-700" /><h4 className="mt-4 text-sm font-semibold text-zinc-300">Chọn một campaign để nhập giá vốn</h4><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Portfolio tổng hợp chỉ để so sánh. Hồ sơ thương mại được lưu riêng theo từng chiến dịch.</p></div> : <div className="mt-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-zinc-500">Giá báo khách hàng (VND)<input type="number" min="0" value={financialDraft.quotedRevenueVnd} onChange={(event) => setFinancialDraft({ ...financialDraft, quotedRevenueVnd: Number(event.target.value) })} className="eg-input mt-2 min-h-11 px-4 font-mono text-sm" /></label><label className="text-xs font-semibold text-zinc-500">Tỷ giá VND / USD<input type="number" min="1" value={financialDraft.exchangeRateVndPerUsd} onChange={(event) => setFinancialDraft({ ...financialDraft, exchangeRateVndPerUsd: Number(event.target.value) })} className="eg-input mt-2 min-h-11 px-4 font-mono text-sm" /></label><label className="text-xs font-semibold text-zinc-500">Giờ nhân sự<input type="number" min="0" step="0.5" value={financialDraft.laborHours} onChange={(event) => setFinancialDraft({ ...financialDraft, laborHours: Number(event.target.value) })} className="eg-input mt-2 min-h-11 px-4 font-mono text-sm" /></label><label className="text-xs font-semibold text-zinc-500">Đơn giá nhân sự / giờ<input type="number" min="0" value={financialDraft.laborHourlyRateVnd} onChange={(event) => setFinancialDraft({ ...financialDraft, laborHourlyRateVnd: Number(event.target.value) })} className="eg-input mt-2 min-h-11 px-4 font-mono text-sm" /></label><label className="text-xs font-semibold text-zinc-500 sm:col-span-2">Chi phí khác (talent, nhạc, media, outsource…)<input type="number" min="0" value={financialDraft.otherCostVnd} onChange={(event) => setFinancialDraft({ ...financialDraft, otherCostVnd: Number(event.target.value) })} className="eg-input mt-2 min-h-11 px-4 font-mono text-sm" /></label></div><label className="mt-4 block text-xs font-semibold text-zinc-500">Ghi chú nội bộ<textarea rows={3} value={financialDraft.notes || ''} onChange={(event) => setFinancialDraft({ ...financialDraft, notes: event.target.value })} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal leading-6" placeholder="Điều khoản sửa, số vòng duyệt, chi phí chưa bao gồm…" /></label><button type="button" onClick={() => void saveFinancial()} disabled={saving} className="eg-button-primary mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-xs font-bold disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Lưu hồ sơ thương mại</button></div>}
        </div>
      </section>

      <section className="eg-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b eg-divider px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6"><div><div className="eg-kicker">Campaign portfolio</div><h3 className="mt-1 text-base font-semibold text-white">So sánh hiệu quả chiến dịch</h3></div><span className="text-xs text-zinc-600">Lợi nhuận = giá báo − API − nhân sự − chi phí khác</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="border-b eg-divider bg-black/20 text-zinc-600"><tr><th className="px-5 py-4 font-semibold">Campaign</th><th className="px-4 py-4 font-semibold">Doanh thu</th><th className="px-4 py-4 font-semibold">Giá vốn</th><th className="px-4 py-4 font-semibold">Lợi nhuận</th><th className="px-4 py-4 font-semibold">Margin</th><th className="px-4 py-4 font-semibold">API</th><th className="px-4 py-4 font-semibold">Regenerate</th><th className="px-5 py-4 font-semibold">Nghiệm thu</th></tr></thead><tbody className="divide-y divide-white/[.06]">{report.campaigns.map((row) => <tr key={row.campaignId} className="hover:bg-white/[.02]"><td className="px-5 py-4"><strong className="block text-zinc-200">{row.campaignName}</strong><span className="mt-1 block text-zinc-600">{row.clientName} · {row.projectCount} project</span></td><td className="px-4 py-4 font-mono text-zinc-300">{formatVnd(row.quotedRevenueVnd)}</td><td className="px-4 py-4 font-mono text-zinc-300">{formatVnd(row.totalCostVnd)}</td><td className={`px-4 py-4 font-mono ${row.profitVnd >= 0 ? 'text-emerald-100' : 'text-rose-100'}`}>{formatVnd(row.profitVnd)}</td><td className="px-4 py-4"><span className={`eg-chip ${row.marginPercent >= 30 ? 'border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100' : 'border-amber-200/20 bg-amber-200/[.07] text-amber-100'}`}>{formatPercent(row.marginPercent)}</span></td><td className="px-4 py-4 font-mono text-zinc-400">{formatUsd(row.apiCostUsd)}</td><td className="px-4 py-4 font-mono text-amber-100">{row.regenerateCount}</td><td className="px-5 py-4 text-zinc-400">{row.approvedProjects}/{row.projectCount}</td></tr>)}{!report.campaigns.length && <tr><td colSpan={8} className="px-5 py-16 text-center text-zinc-600">Chưa có campaign phù hợp với bộ lọc.</td></tr>}</tbody></table></div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[1.1fr_.9fr]">
        <div className="eg-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b eg-divider px-5 py-5 md:px-6"><div><div className="eg-kicker">Provider intelligence</div><h3 className="mt-1 text-base font-semibold text-white">Chi phí và tỷ lệ output được duyệt</h3></div><Sparkles className="h-5 w-5 text-cyan-200/70" /></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-xs"><thead className="border-b eg-divider bg-black/20 text-zinc-600"><tr><th className="px-5 py-4">Provider / model</th><th className="px-4 py-4">Requests</th><th className="px-4 py-4">Thành công</th><th className="px-4 py-4">Được duyệt</th><th className="px-4 py-4">Chi phí</th><th className="px-5 py-4">$/output duyệt</th></tr></thead><tbody className="divide-y divide-white/[.06]">{report.providers.slice(0, 20).map((row) => <tr key={row.id}><td className="px-5 py-4"><strong className="block text-zinc-200">{row.providerId} · {row.modelId}</strong><span className="mt-1 block text-zinc-600">{KIND_LABELS[row.kind]}</span></td><td className="px-4 py-4 font-mono text-zinc-400">{row.requests}</td><td className="px-4 py-4"><span className="font-mono text-zinc-300">{formatPercent(row.successRate)}</span><span className="ml-2 text-zinc-700">{row.successes}/{row.requests}</span></td><td className="px-4 py-4"><span className={`font-mono ${row.approvalRate >= 50 ? 'text-emerald-100' : 'text-amber-100'}`}>{formatPercent(row.approvalRate)}</span><span className="ml-2 text-zinc-700">{row.acceptedOutputs}/{row.successes}</span></td><td className="px-4 py-4 font-mono text-zinc-300">{formatUsd(row.costUsd)}</td><td className="px-5 py-4 font-mono text-cyan-100">{row.costPerApprovedUsd ? formatUsd(row.costPerApprovedUsd) : '—'}</td></tr>)}{!report.providers.length && <tr><td colSpan={6} className="px-5 py-16 text-center text-zinc-600">Chưa có usage record trong khoảng thời gian này.</td></tr>}</tbody></table></div>
        </div>

        <div className="eg-panel overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b eg-divider px-5 py-5 md:px-6"><div><div className="eg-kicker">Burn map</div><h3 className="mt-1 text-base font-semibold text-white">Shot và asset đốt tiền nhất</h3></div><Gauge className="h-5 w-5 text-amber-100/70" /></div>
          <div className="max-h-[520px] divide-y divide-white/[.06] overflow-y-auto">{report.resources.slice(0, 20).map((row, index) => <article key={row.id} className="p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-xs text-zinc-700">#{index + 1}</span><strong className="truncate text-xs text-zinc-200">{row.label}</strong></div><p className="mt-2 truncate text-xs text-zinc-600">{row.projectTitle}</p></div><div className="text-right"><strong className="block font-mono text-sm text-white">{formatUsd(row.costUsd)}</strong><span className={`mt-1 inline-flex items-center gap-1 text-xs ${row.accepted ? 'text-emerald-100' : 'text-zinc-600'}`}>{row.accepted ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{row.accepted ? 'Đã duyệt' : 'Chưa duyệt'}</span></div></div><div className="mt-4 flex flex-wrap gap-2"><span className="eg-chip">{row.requests} requests</span><span className="eg-chip border-amber-200/20 bg-amber-200/[.06] text-amber-100">{row.regenerateCount} tạo lại</span><span className="eg-chip border-rose-200/20 bg-rose-200/[.05] text-rose-100">{row.failures} lỗi</span></div><p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-700">{row.providerModels.join(' · ')}</p></article>)}{!report.resources.length && <div className="flex min-h-72 items-center justify-center p-6 text-center text-zinc-600">Các lượt tạo mới sẽ được tự động quy về shot/asset tại đây.</div>}</div>
        </div>
      </section>

      <section className="eg-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b eg-divider px-5 py-5 md:flex-row md:items-center md:justify-between md:px-6"><div><div className="eg-kicker">Rate card</div><h3 className="mt-1 text-base font-semibold text-white">Đơn giá model theo hợp đồng thực tế</h3><p className="mt-2 text-xs leading-5 text-zinc-600">Override chỉ áp dụng cho usage mới; lịch sử giữ nguyên giá vốn đã ghi tại thời điểm sản xuất.</p></div><button type="button" onClick={saveRateCard} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold"><Save className="h-4 w-4" /> Lưu rate card</button></div>
        <div className="grid gap-3 p-5 md:grid-cols-2 md:p-6 xl:grid-cols-3">{report.providers.filter((row) => RATE_META[row.kind].key).slice(0, 12).map((row) => { const meta = RATE_META[row.kind]; const rateKey = meta.key!; const value = usagePolicy.modelRates?.[row.modelId]?.[rateKey] ?? usagePolicy.rates[rateKey]; return <label key={row.id} className="rounded-2xl border border-white/[.07] bg-black/15 p-4 text-xs font-semibold text-zinc-500"><span className="block truncate text-zinc-300">{row.providerId} · {row.modelId}</span><span className="mt-1 block text-xs font-normal text-zinc-700">{meta.label}</span><input type="number" min="0" step="0.001" value={value} onChange={(event) => updateModelRate(row.modelId, row.kind, Number(event.target.value))} className="eg-input mt-3 min-h-11 px-4 font-mono text-sm" /></label>; })}{!report.providers.some((row) => RATE_META[row.kind].key) && <div className="col-span-full py-10 text-center text-xs text-zinc-600">Rate card sẽ xuất hiện sau khi có usage từ model AI.</div>}</div>
      </section>

      {message && <div className="rounded-2xl border border-cyan-200/20 bg-cyan-200/[.055] p-4 text-xs leading-5 text-cyan-100" role="status" aria-live="polite">{message}</div>}
    </div>
  );
};

export default CostProfitDashboard;
