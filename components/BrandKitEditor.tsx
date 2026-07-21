import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  ImagePlus,
  Mic2,
  Palette,
  Plus,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Type,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  AgencyClient,
  BrandAssetType,
  BrandKit,
  BrandPlatformRule,
  CampaignPlatform,
} from '../types';
import {
  getBrandKitReadiness,
  normalizeBrandKit,
} from '../services/brandKitService';

interface BrandKitEditorProps {
  client: AgencyClient;
  onSave: (client: AgencyClient) => Promise<void>;
  onClose: () => void;
}

type BrandKitTab = 'identity' | 'voice' | 'platforms' | 'approved';

const TABS: Array<{ id: BrandKitTab; label: string; detail: string; icon: React.ElementType }> = [
  { id: 'identity', label: 'Nhận diện', detail: 'Logo, màu, font, asset', icon: Palette },
  { id: 'voice', label: 'Ngôn ngữ & voice', detail: 'Tone, từ khóa, CTA', icon: Mic2 },
  { id: 'platforms', label: 'Quy chuẩn kênh', detail: 'Safe zone và caption', icon: Smartphone },
  { id: 'approved', label: 'Mẫu đã duyệt', detail: 'Bộ nhớ từ nội dung tốt', icon: FileCheck2 },
];

const PLATFORM_LABELS: Record<CampaignPlatform, string> = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram / Reels',
  youtube: 'YouTube / Shorts',
  website: 'Website',
  other: 'Kênh khác',
};

const ASSET_LABELS: Record<BrandAssetType, string> = {
  logo: 'Logo chuẩn',
  product: 'Hình sản phẩm',
  character: 'Nhân vật đại diện',
  reference: 'Hình tham chiếu',
};

const createId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const lines = (value: string): string[] => value.split('\n').map((item) => item.trim()).filter(Boolean);
const textLines = (value: string[]): string => value.join('\n');

const readImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh.'));
  reader.readAsDataURL(file);
});

const BrandKitEditor: React.FC<BrandKitEditorProps> = ({ client, onSave, onClose }) => {
  const [activeTab, setActiveTab] = useState<BrandKitTab>('identity');
  const [draft, setDraft] = useState<BrandKit>(() => normalizeBrandKit(client.brandKit));
  const [assetType, setAssetType] = useState<BrandAssetType>('logo');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const readiness = useMemo(() => getBrandKitReadiness(draft), [draft]);

  const patch = (updates: Partial<BrandKit>) => setDraft((current) => ({ ...current, ...updates }));

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    event.target.value = '';
    if (!files.length) return;
    setError('');
    setIsUploading(true);
    try {
      const nextAssets = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) throw new Error(`“${file.name}” không phải hình ảnh.`);
        if (file.size > 5 * 1024 * 1024) throw new Error(`“${file.name}” lớn hơn 5 MB. Hãy tối ưu ảnh trước khi tải lên.`);
        nextAssets.push({
          id: createId('brand_asset'),
          type: assetType,
          name: file.name.replace(/\.[^.]+$/, ''),
          url: await readImage(file),
        });
      }
      patch({ assets: [...draft.assets, ...nextAssets] });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Không thể tải tài nguyên thương hiệu.');
    } finally {
      setIsUploading(false);
    }
  };

  const patchPlatformRule = (platform: CampaignPlatform, updates: Partial<BrandPlatformRule>) => {
    const existing = draft.platformRules.find((rule) => rule.platform === platform);
    const next = existing
      ? draft.platformRules.map((rule) => rule.platform === platform ? { ...rule, ...updates } : rule)
      : [...draft.platformRules, { platform, ...updates }];
    patch({ platformRules: next });
  };

  const save = async () => {
    setError('');
    setIsSaving(true);
    try {
      await onSave({
        ...client,
        brandKit: normalizeBrandKit({ ...draft, updatedAt: Date.now() }),
        updatedAt: Date.now(),
      });
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không thể lưu Brand Kit.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby="brand-kit-title">
      <section className="flex max-h-[96dvh] w-full max-w-[1460px] flex-col overflow-hidden rounded-t-[28px] border border-white/[.1] bg-[#0a0e13] shadow-2xl shadow-black/50 md:max-h-[92dvh] md:rounded-[28px]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b eg-divider px-5 py-5 md:px-7">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-200/[.06] text-cyan-100"><ShieldCheck className="h-5 w-5" /></span>
            <div className="min-w-0"><div className="eg-kicker">Brand memory · {client.brandName}</div><h2 id="brand-kit-title" className="mt-1 truncate text-xl font-semibold text-white md:text-2xl">Brand Kit trung tâm</h2><p className="mt-1 text-xs text-zinc-500">Mọi campaign mới sẽ tự nạp bộ quy chuẩn này vào Đạo diễn AI.</p></div>
          </div>
          <button type="button" onClick={onClose} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng Brand Kit"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="shrink-0 border-b eg-divider bg-black/20 p-4 md:border-b-0 md:border-r md:p-5">
            <div className="rounded-2xl border border-white/[.08] bg-white/[.025] p-4">
              <div className="flex items-end justify-between gap-3"><div><span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Mức hoàn thiện</span><strong className="mt-1 block font-mono text-3xl text-white">{readiness.score}%</strong></div>{readiness.score >= 80 ? <CheckCircle2 className="h-6 w-6 text-emerald-200" /> : <AlertTriangle className="h-6 w-6 text-amber-200" />}</div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--eg-accent)] transition-[width] duration-300" style={{ width: `${readiness.score}%` }} /></div>
              <p className="mt-3 text-[10px] leading-4 text-zinc-500">{readiness.ready}/{readiness.total} nhóm dữ liệu đã sẵn sàng cho agent.</p>
            </div>
            <nav className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-1" aria-label="Các phần Brand Kit">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const selected = activeTab === tab.id;
                return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-pressed={selected} className={`flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left transition-colors ${selected ? 'border-cyan-200/20 bg-cyan-200/[.07] text-white' : 'border-transparent text-zinc-500 hover:border-white/[.08] hover:bg-white/[.025] hover:text-zinc-200'}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block text-[11px] font-semibold">{tab.label}</span><span className="mt-0.5 hidden text-[9px] text-zinc-600 md:block">{tab.detail}</span></span></button>;
              })}
            </nav>
          </aside>

          <div className="min-h-0 overflow-y-auto p-5 md:p-7">
            {error && <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-4 text-xs leading-5 text-rose-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

            {activeTab === 'identity' && <div className="space-y-7">
              <div><div className="eg-kicker">Visual identity</div><h3 className="mt-1 text-lg font-semibold text-white">Nhận diện và tài nguyên chuẩn</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Chỉ tải bản được phép dùng trong production. Agent sẽ coi tên và ghi chú asset là dữ kiện bắt buộc.</p></div>
              <section className="eg-card p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h4 className="text-sm font-semibold text-white">Thư viện thương hiệu</h4><p className="mt-1 text-[10px] text-zinc-600">Logo, packshot, nhân vật và hình tham chiếu · tối đa 5 MB/tệp</p></div><div className="flex flex-wrap gap-2"><label className="text-[10px] font-semibold text-zinc-500"><span className="sr-only">Loại tài nguyên</span><select value={assetType} onChange={(event) => setAssetType(event.target.value as BrandAssetType)} className="eg-input min-h-11 px-3 text-xs normal-case tracking-normal">{(Object.keys(ASSET_LABELS) as BrandAssetType[]).map((type) => <option key={type} value={type}>{ASSET_LABELS[type]}</option>)}</select></label><label className={`eg-button-primary inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-xs font-bold ${isUploading ? 'pointer-events-none opacity-50' : ''}`}><UploadCloud className="h-4 w-4" />{isUploading ? 'Đang tải…' : 'Tải hình'}<input type="file" accept="image/*" multiple className="sr-only" onChange={(event) => void handleUpload(event)} /></label></div></div>
                {draft.assets.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{draft.assets.map((asset) => <article key={asset.id} className="overflow-hidden rounded-2xl border border-white/[.08] bg-black/20"><div className="aspect-[16/10] bg-white/[.025]"><img src={asset.url} alt={asset.name} className="h-full w-full object-contain" /></div><div className="p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className="text-[9px] uppercase tracking-wider text-cyan-100/60">{ASSET_LABELS[asset.type]}</span><input value={asset.name} onChange={(event) => patch({ assets: draft.assets.map((item) => item.id === asset.id ? { ...item, name: event.target.value } : item) })} aria-label={`Tên tài nguyên ${asset.name}`} className="mt-1 block w-full bg-transparent text-xs font-semibold text-white outline-none" /></div><button type="button" onClick={() => patch({ assets: draft.assets.filter((item) => item.id !== asset.id) })} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center text-zinc-600 hover:text-rose-200" aria-label={`Xóa ${asset.name}`}><Trash2 className="h-4 w-4" /></button></div><label className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">Ghi chú bắt buộc<textarea value={asset.notes || ''} onChange={(event) => patch({ assets: draft.assets.map((item) => item.id === asset.id ? { ...item, notes: event.target.value } : item) })} rows={2} className="eg-input mt-2 min-h-16 resize-y px-3 py-2 text-xs font-normal normal-case leading-5 tracking-normal" placeholder="Góc chụp, chi tiết không được thay đổi…" /></label></div></article>)}</div> : <div className="mt-5 flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.09] text-center"><ImagePlus className="h-7 w-7 text-zinc-700" /><p className="mt-3 text-xs font-semibold text-zinc-400">Chưa có tài nguyên chuẩn</p><p className="mt-1 text-[10px] text-zinc-600">Bắt đầu bằng logo và hình sản phẩm.</p></div>}
              </section>
              <div className="grid gap-5 xl:grid-cols-2">
                <section className="eg-card p-5"><div className="flex items-center justify-between"><div><h4 className="text-sm font-semibold text-white">Bảng màu</h4><p className="mt-1 text-[10px] text-zinc-600">Mã HEX và vai trò sử dụng</p></div><button type="button" onClick={() => patch({ colors: [...draft.colors, { id: createId('brand_color'), name: `Màu ${draft.colors.length + 1}`, hex: '#18D8E8' }] })} className="eg-button-secondary inline-flex min-h-11 items-center gap-2 px-3 text-[10px] font-semibold"><Plus className="h-3.5 w-3.5" /> Thêm màu</button></div><div className="mt-4 space-y-3">{draft.colors.map((color) => <div key={color.id} className="grid grid-cols-[44px_1fr_110px_44px] items-center gap-2"><input type="color" value={color.hex} onChange={(event) => patch({ colors: draft.colors.map((item) => item.id === color.id ? { ...item, hex: event.target.value.toUpperCase() } : item) })} aria-label={`Chọn ${color.name}`} className="h-11 w-11 cursor-pointer rounded-lg border border-white/[.1] bg-transparent p-1" /><input value={color.name} onChange={(event) => patch({ colors: draft.colors.map((item) => item.id === color.id ? { ...item, name: event.target.value } : item) })} aria-label="Tên màu" className="eg-input min-h-11 px-3 text-xs normal-case tracking-normal" /><input value={color.hex} onChange={(event) => patch({ colors: draft.colors.map((item) => item.id === color.id ? { ...item, hex: event.target.value } : item) })} aria-label="Mã màu HEX" className="eg-input min-h-11 px-3 font-mono text-xs normal-case tracking-normal" /><button type="button" onClick={() => patch({ colors: draft.colors.filter((item) => item.id !== color.id) })} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={`Xóa màu ${color.name}`}><Trash2 className="h-4 w-4" /></button></div>)}{!draft.colors.length && <p className="rounded-xl border border-dashed border-white/[.08] p-5 text-center text-xs text-zinc-600">Chưa có màu thương hiệu.</p>}</div></section>
                <section className="eg-card p-5"><div className="flex items-center gap-2"><Type className="h-4 w-4 text-cyan-100/60" /><h4 className="text-sm font-semibold text-white">Font thương hiệu</h4></div><label htmlFor="brand-fonts" className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Mỗi font một dòng<textarea id="brand-fonts" value={textLines(draft.fonts)} onChange={(event) => patch({ fonts: lines(event.target.value) })} rows={8} className="eg-input mt-2 min-h-52 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Be Vietnam Pro — body\nManrope — headline'} /></label></section>
              </div>
            </div>}

            {activeTab === 'voice' && <div className="space-y-7">
              <div><div className="eg-kicker">Brand language</div><h3 className="mt-1 text-lg font-semibold text-white">Giọng thương hiệu và giọng đọc</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Brand Guard dùng dữ liệu này để cảnh báo từ cấm, thiếu CTA và lệch cách xưng hô trước khi duyệt.</p></div>
              <section className="eg-card p-5"><label htmlFor="brand-tone" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tone of voice<textarea id="brand-tone" value={draft.toneOfVoice} onChange={(event) => patch({ toneOfVoice: event.target.value })} rows={5} className="eg-input mt-2 min-h-32 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder="Ví dụ: tự tin nhưng không khoa trương, gần gũi, câu ngắn, dùng 'bạn'…" /></label></section>
              <div className="grid gap-5 xl:grid-cols-2"><section className="eg-card p-5"><h4 className="text-sm font-semibold text-white">Từ bắt buộc</h4><p className="mt-1 text-[10px] text-zinc-600">Tên sản phẩm, claim hoặc cách gọi phải xuất hiện</p><textarea value={textLines(draft.mandatoryTerms)} onChange={(event) => patch({ mandatoryTerms: lines(event.target.value) })} aria-label="Từ bắt buộc, mỗi dòng một mục" rows={7} className="eg-input mt-4 min-h-44 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Tên sản phẩm chính thức\nCụm claim đã được pháp lý duyệt'} /></section><section className="eg-card p-5"><h4 className="text-sm font-semibold text-white">Từ cấm</h4><p className="mt-1 text-[10px] text-zinc-600">Claim rủi ro, cách xưng hô hoặc cụm từ không được dùng</p><textarea value={textLines(draft.forbiddenTerms)} onChange={(event) => patch({ forbiddenTerms: lines(event.target.value) })} aria-label="Từ cấm, mỗi dòng một mục" rows={7} className="eg-input mt-4 min-h-44 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Cam kết 100%\nTốt nhất thị trường'} /></section></div>
              <section className="eg-card p-5"><h4 className="text-sm font-semibold text-white">CTA thường dùng</h4><p className="mt-1 text-[10px] text-zinc-600">Mỗi CTA một dòng; agent ưu tiên đúng CTA đã được duyệt.</p><textarea value={textLines(draft.ctas)} onChange={(event) => patch({ ctas: lines(event.target.value) })} aria-label="CTA đã duyệt" rows={5} className="eg-input mt-4 min-h-32 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Khám phá ngay tại website\nĐăng ký tư vấn hôm nay'} /></section>
              <section className="eg-card p-5"><div className="flex items-center gap-2"><Mic2 className="h-4 w-4 text-cyan-100/60" /><h4 className="text-sm font-semibold text-white">Voice profile mặc định</h4></div><div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Tên profile<input value={draft.voiceProfile?.name || ''} onChange={(event) => patch({ voiceProfile: { ...draft.voiceProfile, name: event.target.value } })} className="eg-input mt-2 min-h-11 px-4 text-sm font-normal normal-case tracking-normal" placeholder="Nữ trẻ trung · Miền Nam" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ngôn ngữ / chất giọng<input value={draft.voiceProfile?.language || ''} onChange={(event) => patch({ voiceProfile: { name: draft.voiceProfile?.name || '', ...draft.voiceProfile, language: event.target.value } })} className="eg-input mt-2 min-h-11 px-4 text-sm font-normal normal-case tracking-normal" placeholder="Tiếng Việt · tự nhiên · ấm" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Provider<input value={draft.voiceProfile?.providerId || ''} onChange={(event) => patch({ voiceProfile: { name: draft.voiceProfile?.name || '', ...draft.voiceProfile, providerId: event.target.value } })} className="eg-input mt-2 min-h-11 px-4 text-sm font-normal normal-case tracking-normal" placeholder="elevenlabs" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Voice ID<input value={draft.voiceProfile?.voiceId || ''} onChange={(event) => patch({ voiceProfile: { name: draft.voiceProfile?.name || '', ...draft.voiceProfile, voiceId: event.target.value } })} className="eg-input mt-2 min-h-11 px-4 font-mono text-xs font-normal normal-case tracking-normal" placeholder="ID voice đã duyệt" /></label><label className="md:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Mô tả cách đọc<textarea value={draft.voiceProfile?.description || ''} onChange={(event) => patch({ voiceProfile: { name: draft.voiceProfile?.name || '', ...draft.voiceProfile, description: event.target.value } })} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder="Tốc độ, nhịp nghỉ, cảm xúc và cách phát âm tên thương hiệu…" /></label></div></section>
            </div>}

            {activeTab === 'platforms' && <div className="space-y-7">
              <div><div className="eg-kicker">Platform rules</div><h3 className="mt-1 text-lg font-semibold text-white">Safe zone và quy chuẩn nền tảng</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Chỉ điền các kênh thương hiệu thực sự sử dụng. Supervisor sẽ dựa vào đây để kiểm tra bố cục và caption.</p></div>
              <div className="grid gap-4 xl:grid-cols-2">{(Object.keys(PLATFORM_LABELS) as CampaignPlatform[]).map((platform) => {
                const rule = draft.platformRules.find((item) => item.platform === platform);
                return <section key={platform} className="eg-card p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[.08] bg-white/[.03] text-cyan-100"><Smartphone className="h-4 w-4" /></span><div><h4 className="text-sm font-semibold text-white">{PLATFORM_LABELS[platform]}</h4><p className="mt-0.5 text-[9px] text-zinc-600">Quy chuẩn riêng theo kênh</p></div></div><div className="mt-4 space-y-4"><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Safe zone<textarea value={rule?.safeZone || ''} onChange={(event) => patchPlatformRule(platform, { safeZone: event.target.value })} rows={2} className="eg-input mt-2 min-h-16 resize-y px-3 py-2 text-xs font-normal normal-case leading-5 tracking-normal" placeholder="Vị trí logo, vùng tránh UI, khoảng cách mép…" /></label><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Caption<textarea value={rule?.captionStyle || ''} onChange={(event) => patchPlatformRule(platform, { captionStyle: event.target.value })} rows={2} className="eg-input mt-2 min-h-16 resize-y px-3 py-2 text-xs font-normal normal-case leading-5 tracking-normal" placeholder="Font, kích thước, số dòng, cách highlight…" /></label><label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Lưu ý khác<textarea value={rule?.guidelines || ''} onChange={(event) => patchPlatformRule(platform, { guidelines: event.target.value })} rows={3} className="eg-input mt-2 min-h-20 resize-y px-3 py-2 text-xs font-normal normal-case leading-5 tracking-normal" placeholder="Nhịp dựng, độ dài hook, CTA, thumbnail…" /></label></div></section>;
              })}</div>
            </div>}

            {activeTab === 'approved' && <div className="space-y-7">
              <div><div className="eg-kicker">Approved memory</div><h3 className="mt-1 text-lg font-semibold text-white">Nội dung đã được duyệt</h3><p className="mt-2 max-w-2xl text-xs leading-5 text-zinc-500">Dán caption, hook, đoạn thoại hoặc mô tả visual đã được khách duyệt. Mỗi mẫu cách nhau bằng một dòng mới.</p></div>
              <section className="eg-card p-5"><label htmlFor="approved-examples" className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Ví dụ chuẩn<textarea id="approved-examples" value={textLines(draft.approvedExamples)} onChange={(event) => patch({ approvedExamples: lines(event.target.value) })} rows={16} className="eg-input mt-2 min-h-96 resize-y px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal" placeholder={'Hook: Da khỏe bắt đầu từ một bước thật dịu.\nCTA: Khám phá bộ sản phẩm tại website chính thức.'} /></label></section>
              {readiness.missing.length > 0 && <section className="rounded-2xl border border-amber-200/15 bg-amber-200/[.045] p-5"><div className="flex items-center gap-2 text-xs font-semibold text-amber-100"><AlertTriangle className="h-4 w-4" /> Dữ liệu nên bổ sung</div><div className="mt-4 flex flex-wrap gap-2">{readiness.missing.map((item) => <span key={item} className="eg-chip border-amber-200/15 bg-amber-200/[.05] text-amber-100/80">{item}</span>)}</div></section>}
            </div>}
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t eg-divider bg-black/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
          <p className="text-[10px] leading-4 text-zinc-600"><ShieldCheck className="mr-1.5 inline h-3.5 w-3.5 text-cyan-100/60" />Brand Guard sẽ tự nạp dữ liệu này vào campaign, script và prompt hình ảnh.</p>
          <div className="flex gap-3"><button type="button" onClick={onClose} className="eg-button-secondary min-h-11 px-5 text-xs font-semibold">Đóng</button><button type="button" onClick={() => void save()} disabled={isSaving || isUploading} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"><Save className="h-4 w-4" />{isSaving ? 'Đang lưu…' : 'Lưu Brand Kit'}</button></div>
        </footer>
      </section>
    </div>
  );
};

export default BrandKitEditor;
