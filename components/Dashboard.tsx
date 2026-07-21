import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronRight,
  Clapperboard,
  Clock3,
  Cloud,
  CloudDownload,
  Cpu,
  ExternalLink,
  Film,
  FolderKanban,
  FolderOpen,
  Gauge,
  HelpCircle,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { AssetLibraryItem, Character, ProjectState, Scene } from '../types';
import {
  createNewProjectState,
  deleteAssetFromLibrary,
  deleteProjectFromDB,
  getAllAssetLibraryItems,
  getAllProjectsMetadata,
  loadProjectFromDB,
  saveProjectToDB,
} from '../services/storageService';
import { applyLibraryItemToProject } from '../services/assetLibraryService';
import { useAlert } from './GlobalAlert';
import { CloudProjectMetadata, deleteCloudProject, listCloudProjects, loadCloudProject } from '../services/cloudSyncService';
import CampaignHub from './CampaignHub';

interface Props {
  onOpenProject: (project: ProjectState) => void;
  onOpenProjectWithDirector?: (project: ProjectState, initialPrompt: string) => void;
  onOpenProjectWithProductionControl?: (project: ProjectState) => void;
  onOpenProjectWithClientReview?: (project: ProjectState) => void;
  onShowOnboarding?: () => void;
  onShowModelConfig?: () => void;
  onShowOperations?: () => void;
}

const STAGE_META: Record<ProjectState['stage'], { label: string; step: number }> = {
  script: { label: 'Kịch bản', step: 1 },
  assets: { label: 'Tài nguyên', step: 2 },
  voice: { label: 'Giọng thoại', step: 3 },
  director: { label: 'Xưởng dựng', step: 4 },
  export: { label: 'Xuất bản', step: 5 },
  prompts: { label: 'Kho sáng tạo', step: 4 },
};

const formatDate = (timestamp: number) => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit', month: 'short', year: 'numeric',
}).format(timestamp);

const getProjectPreview = (project: ProjectState) => {
  const character = project.scriptData?.characters.find((item) => item.referenceImage)?.referenceImage;
  const scene = project.scriptData?.scenes.find((item) => item.referenceImage)?.referenceImage;
  const keyframe = project.shots.flatMap((shot) => shot.keyframes).find((item) => item.imageUrl)?.imageUrl;
  return keyframe || scene || character;
};

const Dashboard: React.FC<Props> = ({ onOpenProject, onOpenProjectWithDirector, onOpenProjectWithProductionControl, onOpenProjectWithClientReview, onShowOnboarding, onShowModelConfig, onShowOperations }) => {
  const { showAlert } = useAlert();
  const [projects, setProjects] = useState<ProjectState[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene'>('all');
  const [assetToUse, setAssetToUse] = useState<AssetLibraryItem | null>(null);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectMetadata[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [restoringCloudId, setRestoringCloudId] = useState<string | null>(null);
  const [dashboardView, setDashboardView] = useState<'campaigns' | 'projects'>('campaigns');

  const loadProjects = async () => {
    setIsLoading(true);
    try {
      setProjects(await getAllProjectsMetadata());
    } catch (error) {
      console.error('Không thể tải danh sách dự án', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { void loadProjects(); }, []);

  useEffect(() => {
    if (!showLibrary) return;
    setLibraryLoading(true);
    getAllAssetLibraryItems()
      .then(setLibraryItems)
      .catch((error) => console.error('Không thể tải thư viện tài nguyên', error))
      .finally(() => setLibraryLoading(false));
  }, [showLibrary]);

  const handleCreate = () => onOpenProject(createNewProjectState());

  const openCloudProjects = async () => {
    setShowCloud(true);
    setCloudLoading(true);
    try {
      setCloudProjects(await listCloudProjects());
    } catch (error) {
      setCloudProjects([]);
      showAlert(
        typeof window !== 'undefined' && !window.location.hostname.endsWith('.chatgpt.site')
          ? 'Dự án cloud chỉ hoạt động trên bản đã deploy và đăng nhập ChatGPT.'
          : error instanceof Error ? error.message : 'Không thể tải dự án cloud',
        { type: 'warning' },
      );
    } finally {
      setCloudLoading(false);
    }
  };

  const restoreCloudProject = async (projectId: string) => {
    setRestoringCloudId(projectId);
    try {
      const cloudProject = await loadCloudProject(projectId);
      await saveProjectToDB(cloudProject);
      await loadProjects();
      setShowCloud(false);
      onOpenProject(cloudProject);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể khôi phục dự án cloud', { type: 'error' });
    } finally {
      setRestoringCloudId(null);
    }
  };

  const removeCloudProject = (projectId: string, title: string) => {
    showAlert(`Xóa bản sao cloud “${title}”? Dữ liệu trên thiết bị không bị ảnh hưởng.`, {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteCloudProject(projectId);
          setCloudProjects((current) => current.filter((project) => project.id !== projectId));
        } catch (error) {
          showAlert(error instanceof Error ? error.message : 'Không thể xóa bản sao cloud', { type: 'error' });
        }
      },
    });
  };

  const confirmDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    try {
      await deleteProjectFromDB(id);
      await loadProjects();
    } catch (error) {
      showAlert(`Không thể xóa dự án: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`, { type: 'error' });
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleUseAsset = async (projectId: string) => {
    if (!assetToUse) return;
    try {
      const project = await loadProjectFromDB(projectId);
      const updated = applyLibraryItemToProject(project, assetToUse);
      await saveProjectToDB(updated);
      setAssetToUse(null);
      setShowLibrary(false);
      onOpenProject(updated);
    } catch (error) {
      showAlert(`Nhập tài nguyên thất bại: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`, { type: 'error' });
    }
  };

  const deleteLibraryItem = (id: string) => {
    showAlert('Xóa tài nguyên này khỏi thư viện Egoric?', {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        try {
          await deleteAssetFromLibrary(id);
          setLibraryItems((current) => current.filter((item) => item.id !== id));
        } catch (error) {
          showAlert(error instanceof Error ? error.message : 'Không thể xóa tài nguyên', { type: 'error' });
        }
      },
    });
  };

  const filteredLibrary = useMemo(() => libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    return !libraryQuery.trim() || item.name.toLowerCase().includes(libraryQuery.trim().toLowerCase());
  }), [libraryItems, libraryFilter, libraryQuery]);

  const completedProjects = projects.filter((project) => project.stage === 'export').length;
  const generatedShots = projects.reduce((sum, project) => sum + project.shots.length, 0);
  const readyVoiceLines = projects.reduce((sum, project) => sum + (project.voiceStudio?.takes.filter((take) => take.status === 'ready').length || 0), 0);

  return (
    <div className="eg-app-shell min-h-[100dvh] text-[var(--eg-text)]">
      <header className="sticky top-0 z-40 border-b eg-divider bg-[rgba(7,9,12,.82)] backdrop-blur-2xl">
        <div className="mx-auto flex min-h-[76px] max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-2 md:flex-nowrap md:gap-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.035]">
              <img src="/egoric-agency-icon.png" alt="Egoric Agency" className="h-8 w-8 object-contain" />
            </div>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-semibold text-white">Egoric Film Studio</div>
            <div className="mt-0.5 hidden font-mono text-[9px] uppercase tracking-[.2em] text-zinc-600 sm:block">Không gian sản xuất · Việt Nam</div>
            </div>
          </div>
          <div className="order-3 flex w-full items-center rounded-xl border border-white/[.08] bg-black/20 p-1 md:order-none md:w-auto" aria-label="Không gian điều hành">
            <button type="button" onClick={() => setDashboardView('campaigns')} aria-pressed={dashboardView === 'campaigns'} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-semibold transition-colors md:flex-none ${dashboardView === 'campaigns' ? 'bg-cyan-200/[.11] text-cyan-50' : 'text-zinc-600 hover:text-zinc-300'}`}><FolderKanban className="h-3.5 w-3.5" /><span>Chiến dịch</span></button>
            <button type="button" onClick={() => setDashboardView('projects')} aria-pressed={dashboardView === 'projects'} className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[10px] font-semibold transition-colors md:flex-none ${dashboardView === 'projects' ? 'bg-cyan-200/[.11] text-cyan-50' : 'text-zinc-600 hover:text-zinc-300'}`}><FolderOpen className="h-3.5 w-3.5" /><span>Dự án</span></button>
          </div>
          <nav className="flex items-center gap-2" aria-label="Công cụ ứng dụng">
            {onShowOperations && (
              <button type="button" onClick={onShowOperations} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Trung tâm vận hành" title="Trung tâm vận hành"><Gauge className="h-4 w-4" /></button>
            )}
            {onShowOnboarding && (
              <button type="button" onClick={onShowOnboarding} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Hướng dẫn sử dụng" title="Hướng dẫn"><HelpCircle className="h-4 w-4" /></button>
            )}
            {onShowModelConfig && (
              <button type="button" onClick={onShowModelConfig} className="eg-button-secondary hidden items-center justify-center gap-2 px-4 text-xs font-semibold sm:inline-flex"><Cpu className="h-4 w-4" /> Mô hình và API</button>
            )}
            <button type="button" onClick={() => void openCloudProjects()} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Dự án cloud" title="Dự án cloud"><Cloud className="h-4 w-4" /></button>
            <button type="button" onClick={handleCreate} className="eg-button-primary inline-flex items-center justify-center gap-2 px-4 text-xs font-bold"><Plus className="h-4 w-4" /> <span className="hidden sm:inline">Dự án mới</span></button>
          </nav>
        </div>
      </header>

      {dashboardView === 'campaigns' ? (
        <CampaignHub projects={projects} onOpenProject={onOpenProject} onOpenProjectWithDirector={onOpenProjectWithDirector} onOpenProjectWithProductionControl={onOpenProjectWithProductionControl} onOpenProjectWithClientReview={onOpenProjectWithClientReview} />
      ) : <main className="mx-auto max-w-[1600px] px-4 py-8 md:px-8 md:py-10">
        <section className="relative overflow-hidden rounded-[28px] border border-white/[.08] bg-[linear-gradient(120deg,rgba(18,24,33,.98),rgba(9,13,18,.94))] p-6 shadow-2xl shadow-black/20 md:p-9">
          <div className="pointer-events-none absolute -right-16 -top-28 h-72 w-72 rounded-full bg-cyan-200/[.08] blur-3xl" />
          <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,.9fr)] xl:items-end">
            <div>
              <div className="eg-kicker">Phòng sản xuất Egoric</div>
              <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-.035em] text-white md:text-[42px] md:leading-[1.12]">
                Mọi ý tưởng, nhân vật và cảnh quay trong một nhịp sản xuất.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400">
                Bắt đầu từ kịch bản, khóa hình ảnh nhất quán, dựng giọng Việt và hoàn thiện bản phim mà không rời khỏi không gian sản xuất.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button type="button" onClick={handleCreate} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><Sparkles className="h-4 w-4" /> Bắt đầu tác phẩm mới</button>
                <button type="button" onClick={() => setShowLibrary(true)} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-5 text-xs font-semibold"><Archive className="h-4 w-4" /> Mở thư viện tài nguyên</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2">
              {[
                { label: 'Dự án', value: projects.length, icon: FolderOpen },
                { label: 'Đã xuất bản', value: completedProjects, icon: Film },
                { label: 'Cảnh quay', value: generatedShots, icon: Clapperboard },
                { label: 'Bản thoại', value: readyVoiceLines, icon: Check },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/[.08] bg-black/20 p-4">
                  <div className="flex items-center justify-between"><stat.icon className="h-4 w-4 text-cyan-200/70" /><span className="font-mono text-[9px] uppercase tracking-widest text-zinc-700">Trực tiếp</span></div>
                  <div className="mt-4 font-mono text-2xl font-semibold tabular-nums text-white">{stat.value}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-10">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="eg-kicker">Gần đây</div>
              <h2 className="mt-1 text-xl font-semibold text-white">Các dự án đang sản xuất</h2>
            </div>
            <p className="text-xs text-zinc-600">Sắp xếp theo lần chỉnh sửa gần nhất</p>
          </div>

          {isLoading ? (
            <div className="eg-panel flex min-h-72 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /><span className="ml-3 text-xs text-zinc-500">Đang mở phòng dự án…</span></div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <button type="button" onClick={handleCreate} className="group flex min-h-[310px] flex-col items-center justify-center rounded-3xl border border-dashed border-white/[.12] bg-white/[.018] p-6 text-center transition-colors hover:border-cyan-200/35 hover:bg-cyan-200/[.035]">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/[.07] text-cyan-100 transition-transform group-hover:scale-105"><Plus className="h-5 w-5" /></span>
                <span className="mt-5 text-sm font-semibold text-white">Tạo dự án mới</span>
                <span className="mt-2 max-w-[220px] text-xs leading-5 text-zinc-600">Mở không gian trống với quy trình sản xuất năm giai đoạn.</span>
              </button>

              {projects.map((project) => {
                const stage = STAGE_META[project.stage] || STAGE_META.script;
                const preview = getProjectPreview(project);
                const voiceReady = project.voiceStudio?.takes.filter((take) => take.status === 'ready').length || 0;
                return (
                  <article key={project.id} className="eg-card eg-card-interactive group relative min-h-[310px] cursor-pointer overflow-hidden" onClick={() => onOpenProject(project)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpenProject(project); }} role="button" tabIndex={0} aria-label={`Mở dự án ${project.title}`}>
                    {deleteConfirmId === project.id && (
                      <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[rgba(7,9,12,.96)] p-6 text-center backdrop-blur-xl" onClick={(event) => event.stopPropagation()}>
                        <Trash2 className="h-5 w-5 text-rose-300" />
                        <h3 className="mt-4 text-sm font-semibold text-white">Xóa “{project.title}”?</h3>
                        <p className="mt-2 text-xs leading-5 text-zinc-500">Ảnh, video, bản thoại và lịch sử kết xuất trong dự án sẽ bị xóa khỏi thiết bị.</p>
                        <div className="mt-5 flex w-full gap-2">
                          <button type="button" onClick={(event) => { event.stopPropagation(); setDeleteConfirmId(null); }} className="eg-button-secondary flex-1 px-3 text-xs font-semibold">Giữ lại</button>
                          <button type="button" onClick={(event) => void confirmDelete(event, project.id)} className="min-h-11 flex-1 rounded-xl border border-rose-300/20 bg-rose-300/10 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-300/15">Xóa dự án</button>
                        </div>
                      </div>
                    )}

                    <div className="relative h-32 overflow-hidden border-b eg-divider bg-[var(--eg-surface-2)]">
                      {preview ? <img src={preview} alt="" className="h-full w-full object-cover opacity-70 transition duration-300 group-hover:scale-[1.025] group-hover:opacity-85" /> : (
                        <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(121,230,223,.08),transparent_55%)]"><Clapperboard className="h-8 w-8 text-cyan-100/20" /></div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#10161e] via-transparent to-transparent" />
                      <span className="absolute bottom-3 left-3 eg-chip border-cyan-200/20 bg-black/55 text-cyan-100 backdrop-blur-lg">{stage.label} · {stage.step}/5</span>
                      <button type="button" onClick={(event) => { event.stopPropagation(); setDeleteConfirmId(project.id); }} className="eg-icon-button absolute right-3 top-3 flex h-11 w-11 items-center justify-center bg-black/55 opacity-0 backdrop-blur-lg transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={`Xóa dự án ${project.title}`}><Trash2 className="h-4 w-4" /></button>
                    </div>

                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-1 text-sm font-semibold text-white">{project.title}</h3>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-700 transition-colors group-hover:text-cyan-200" />
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-10 text-[11px] leading-5 text-zinc-600">{project.scriptData?.logline || 'Một tác phẩm đang chờ được phát triển trong Egoric Film Studio.'}</p>
                      <div className="mt-4 grid grid-cols-3 gap-2 border-t eg-divider pt-4 text-center">
                        <div><div className="font-mono text-xs text-zinc-300">{project.scriptData?.characters.length || 0}</div><div className="mt-1 text-[9px] text-zinc-700">Nhân vật</div></div>
                        <div><div className="font-mono text-xs text-zinc-300">{project.shots.length}</div><div className="mt-1 text-[9px] text-zinc-700">Cảnh quay</div></div>
                        <div><div className="font-mono text-xs text-zinc-300">{voiceReady}</div><div className="mt-1 text-[9px] text-zinc-700">Bản thoại</div></div>
                      </div>
                    </div>
                    <footer className="flex items-center justify-between border-t eg-divider bg-black/10 px-5 py-3 font-mono text-[9px] text-zinc-700"><span className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" />{formatDate(project.lastModified)}</span><ChevronRight className="h-3.5 w-3.5" /></footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {onShowOperations && <button type="button" onClick={onShowOperations} className="eg-card eg-card-interactive flex min-h-28 items-center gap-4 p-5 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-cyan-200"><Gauge className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Trung tâm vận hành</span><span className="mt-1 block text-xs text-zinc-600">API, Voice, kiểm thử và hạn mức workspace.</span></span><ChevronRight className="h-4 w-4 text-zinc-700" /></button>}
          <button type="button" onClick={() => setShowLibrary(true)} className="eg-card eg-card-interactive flex min-h-28 items-center gap-4 p-5 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-cyan-200"><Archive className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Thư viện tài nguyên</span><span className="mt-1 block text-xs text-zinc-600">Tái sử dụng nhân vật và bối cảnh giữa dự án.</span></span><ChevronRight className="h-4 w-4 text-zinc-700" /></button>
          <button type="button" onClick={() => void openCloudProjects()} className="eg-card eg-card-interactive flex min-h-28 items-center gap-4 p-5 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-sky-200"><CloudDownload className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Dự án cloud</span><span className="mt-1 block text-xs text-zinc-600">Khôi phục dự án trên thiết bị khác.</span></span><ChevronRight className="h-4 w-4 text-zinc-700" /></button>
          {onShowModelConfig && <button type="button" onClick={onShowModelConfig} className="eg-card eg-card-interactive flex min-h-28 items-center gap-4 p-5 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-amber-200"><Cpu className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Mô hình và API</span><span className="mt-1 block text-xs text-zinc-600">Kết nối model hội thoại, hình ảnh và video.</span></span><ChevronRight className="h-4 w-4 text-zinc-700" /></button>}
          <a href="https://github.com/leozvu/liemcainhe/issues" target="_blank" rel="noreferrer" className="eg-card eg-card-interactive flex min-h-28 items-center gap-4 p-5 text-left"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-violet-200"><HelpCircle className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-white">Hỗ trợ sản phẩm</span><span className="mt-1 block text-xs text-zinc-600">Gửi lỗi hoặc đề xuất cho đội ngũ Egoric.</span></span><ExternalLink className="h-4 w-4 text-zinc-700" /></a>
        </section>
      </main>}

      {showCloud && (
        <div className="fixed inset-0 z-[185] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xl" onClick={() => setShowCloud(false)}>
          <div className="eg-panel flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:p-7">
              <div><div className="eg-kicker">Đám mây Egoric</div><h2 className="mt-1 text-xl font-semibold text-white">Dự án đã sao lưu</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Dữ liệu tách theo tài khoản ChatGPT đang đăng nhập. Khôi phục sẽ tạo hoặc cập nhật bản trên thiết bị.</p></div>
              <button type="button" onClick={() => setShowCloud(false)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label="Đóng dự án cloud"><X className="h-4 w-4" /></button>
            </header>
            <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
              {cloudLoading ? (
                <div className="flex min-h-56 items-center justify-center gap-3 text-xs text-zinc-500"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /> Đang tải bản sao cloud…</div>
              ) : cloudProjects.length === 0 ? (
                <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] p-6 text-center"><Cloud className="h-7 w-7 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-zinc-300">Chưa có dự án cloud</h3><p className="mt-2 max-w-md text-xs leading-5 text-zinc-600">Mở một dự án, vào Trung tâm sản xuất rồi chọn “Sao lưu cloud”.</p></div>
              ) : (
                <div className="space-y-3">{cloudProjects.map((cloudProject) => (
                  <article key={cloudProject.id} className="eg-card flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-200/15 bg-sky-200/[.06] text-sky-100"><Cloud className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-white">{cloudProject.title}</h3><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">Cập nhật {formatDate(cloudProject.updatedAt)}</p></div>
                    <div className="flex gap-2"><button type="button" onClick={() => void restoreCloudProject(cloudProject.id)} disabled={restoringCloudId !== null} className="eg-button-primary inline-flex flex-1 items-center justify-center gap-2 px-4 text-xs font-bold sm:flex-none">{restoringCloudId === cloudProject.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />} Khôi phục</button><button type="button" onClick={() => removeCloudProject(cloudProject.id, cloudProject.title)} className="eg-icon-button flex h-11 w-11 items-center justify-center text-zinc-600 hover:text-rose-200" aria-label={`Xóa bản sao cloud ${cloudProject.title}`}><Trash2 className="h-4 w-4" /></button></div>
                  </article>
                ))}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showLibrary && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl" onClick={() => setShowLibrary(false)}>
          <div className="eg-panel flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider px-5 py-5 md:px-7">
              <div><div className="eg-kicker">Tài nguyên Egoric</div><h2 className="mt-1 text-xl font-semibold text-white">Thư viện tài nguyên</h2><p className="mt-1 text-xs text-zinc-500">Nhân vật và bối cảnh đã khóa hình ảnh, sẵn sàng dùng lại.</p></div>
              <button type="button" onClick={() => setShowLibrary(false)} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Đóng thư viện"><X className="h-4 w-4" /></button>
            </header>
            <div className="flex flex-col gap-3 border-b eg-divider p-4 md:flex-row md:items-center md:justify-between md:px-7">
              <div className="relative min-w-0 flex-1 md:max-w-md"><Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-zinc-600" /><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} className="eg-input pl-10 pr-4 text-xs" placeholder="Tìm tên tài nguyên…" /></div>
              <div className="flex gap-2">{(['all', 'character', 'scene'] as const).map((filter) => <button key={filter} type="button" onClick={() => setLibraryFilter(filter)} className={`min-h-11 rounded-xl border px-3 text-[11px] font-semibold ${libraryFilter === filter ? 'border-cyan-200/30 bg-cyan-200/10 text-cyan-100' : 'border-white/[.08] text-zinc-500 hover:text-white'}`}>{filter === 'all' ? 'Tất cả' : filter === 'character' ? 'Nhân vật' : 'Bối cảnh'}</button>)}</div>
            </div>
            <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
              {libraryLoading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-cyan-200" /></div> : filteredLibrary.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] text-center"><ImageIcon className="h-6 w-6 text-zinc-700" /><p className="mt-3 text-sm text-zinc-500">Chưa có tài nguyên phù hợp</p><p className="mt-1 text-xs text-zinc-700">Lưu nhân vật hoặc bối cảnh từ một dự án để tái sử dụng.</p></div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filteredLibrary.map((item) => {
                  const preview = item.type === 'character' ? (item.data as Character).referenceImage : (item.data as Scene).referenceImage;
                  return <article key={item.id} className="eg-card overflow-hidden"><div className="aspect-video bg-black/30">{preview ? <img src={preview} alt={item.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-zinc-700">{item.type === 'character' ? <UsersRound className="h-6 w-6" /> : <MapPin className="h-6 w-6" />}</div>}</div><div className="p-4"><div className="eg-kicker">{item.type === 'character' ? 'Nhân vật' : 'Bối cảnh'}</div><h3 className="mt-1 truncate text-sm font-semibold text-white">{item.name}</h3><div className="mt-4 flex gap-2"><button type="button" onClick={() => setAssetToUse(item)} className="eg-button-primary flex-1 px-3 text-[11px] font-bold">Dùng trong dự án</button><button type="button" onClick={() => deleteLibraryItem(item.id)} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={`Xóa ${item.name}`}><Trash2 className="h-4 w-4" /></button></div></div></article>;
                })}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {assetToUse && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/75 p-4 backdrop-blur-xl" onClick={() => setAssetToUse(null)}>
          <div className="eg-panel w-full max-w-2xl p-6 md:p-7" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4"><div><div className="eg-kicker">Chèn tài nguyên</div><h2 className="mt-1 text-lg font-semibold text-white">Chọn dự án đích</h2><p className="mt-1 text-xs text-zinc-500">Đưa “{assetToUse.name}” vào một không gian làm việc đang có.</p></div><button type="button" onClick={() => setAssetToUse(null)} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label="Đóng"><X className="h-4 w-4" /></button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">{projects.length ? projects.map((project) => <button key={project.id} type="button" onClick={() => void handleUseAsset(project.id)} className="eg-card eg-card-interactive min-h-24 p-4 text-left"><span className="block truncate text-sm font-semibold text-white">{project.title}</span><span className="mt-2 flex items-center gap-2 text-[10px] text-zinc-600"><Clock3 className="h-3 w-3" />{formatDate(project.lastModified)}</span></button>) : <p className="col-span-full py-8 text-center text-sm text-zinc-600">Chưa có dự án để nhận tài nguyên.</p>}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
