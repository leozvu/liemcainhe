import React, { useEffect, useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Compass,
  ClipboardList,
  Clock3,
  ExternalLink,
  Film,
  FolderKanban,
  LayoutGrid,
  ListChecks,
  Loader2,
  Mail,
  MessageSquareText,
  PauseCircle,
  Palette,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import {
  AgencyCampaign,
  AgencyClient,
  CampaignDeliverable,
  CampaignObjective,
  CampaignPlatform,
  CampaignPriority,
  CampaignStatus,
  DeliverableStatus,
  ProjectState,
} from '../types';
import {
  createAgencyCampaign,
  createAgencyClient,
  buildCampaignPreProductionPrompt,
  createCampaignDeliverable,
  createProjectForCampaignDeliverable,
  getCampaignBriefReadiness,
  getCampaignDeliverableCount,
  getCampaignProgress,
  updateCampaignDeliverable,
  updateCampaignStatus,
} from '../services/campaignService';
import {
  deleteAgencyCampaign,
  deleteAgencyClient,
  getAllAgencyCampaigns,
  getAllAgencyClients,
  loadProjectFromDB,
  createNewProjectState,
  saveAgencyCampaign,
  saveAgencyClient,
  saveProjectToDB,
} from '../services/storageService';
import { useAlert } from './GlobalAlert';
import CampaignPreProduction from './CampaignPreProduction';
import CampaignZeroPanel from './CampaignZeroPanel';
import BrandKitEditor from './BrandKitEditor';
import { getBrandKitReadiness, normalizeBrandKit } from '../services/brandKitService';
import {
  WORKSPACE_SYNC_APPLIED_EVENT,
  WorkspaceSyncAppliedDetail,
} from '../services/workspaceSyncCoordinatorService';
import { useLocale } from '../contexts/LocaleContext';
import { TranslationKey } from '../services/i18n';

interface CampaignHubProps {
  projects: ProjectState[];
  onOpenProject: (project: ProjectState) => void;
  onOpenProjectWithDirector?: (project: ProjectState, initialPrompt: string) => void;
  onOpenProjectWithProductionControl?: (project: ProjectState) => void;
  onOpenProjectWithClientReview?: (project: ProjectState) => void;
}

const STATUS_COLUMN_DEFS: Array<{ id: CampaignStatus; labelKey: TranslationKey; detailKey: TranslationKey }> = [
  { id: 'brief', labelKey: 'campaign.status.brief', detailKey: 'campaign.status.briefDetail' },
  { id: 'planning', labelKey: 'campaign.status.planning', detailKey: 'campaign.status.planningDetail' },
  { id: 'production', labelKey: 'campaign.status.production', detailKey: 'campaign.status.productionDetail' },
  { id: 'review', labelKey: 'campaign.status.review', detailKey: 'campaign.status.reviewDetail' },
  { id: 'delivered', labelKey: 'campaign.status.delivered', detailKey: 'campaign.status.deliveredDetail' },
  { id: 'paused', labelKey: 'campaign.status.paused', detailKey: 'campaign.status.pausedDetail' },
];

const OBJECTIVE_LABEL_KEYS: Record<CampaignObjective, TranslationKey> = {
  awareness: 'campaign.objective.awareness',
  engagement: 'campaign.objective.engagement',
  leads: 'campaign.objective.leads',
  conversion: 'campaign.objective.conversion',
  retention: 'campaign.objective.retention',
  launch: 'campaign.objective.launch',
};

const STATIC_PLATFORM_LABELS: Record<Exclude<CampaignPlatform, 'other'>, string> = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  website: 'Website',
};

const DELIVERABLE_STATUS_LABEL_KEYS: Record<DeliverableStatus, TranslationKey> = {
  planned: 'campaign.deliverable.planned',
  'in-progress': 'campaign.deliverable.inProgress',
  review: 'campaign.deliverable.review',
  approved: 'campaign.deliverable.approved',
  delivered: 'campaign.deliverable.delivered',
};

const PRIORITY_LABEL_KEYS: Record<CampaignPriority, TranslationKey> = {
  low: 'campaign.priority.low',
  normal: 'campaign.priority.normal',
  high: 'campaign.priority.high',
  urgent: 'campaign.priority.urgent',
};

const formatDate = (timestamp: number | undefined, localeTag: string, notSet: string): string => timestamp
  ? new Intl.DateTimeFormat(localeTag, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(timestamp)
  : notSet;

const formatBudget = (value: number, currency: AgencyCampaign['currency'], localeTag: string): string => new Intl.NumberFormat(localeTag, {
  style: 'currency',
  currency,
  maximumFractionDigits: currency === 'VND' ? 0 : 2,
}).format(value || 0);

const toDateInput = (timestamp?: number): string => timestamp
  ? new Date(timestamp).toISOString().slice(0, 10)
  : '';

const parseDateInput = (value: string): number | undefined => value
  ? new Date(`${value}T12:00:00`).getTime()
  : undefined;

interface CampaignDraft {
  clientId: string;
  name: string;
  objective: CampaignObjective;
  brief: string;
  product: string;
  targetAudience: string;
  offer: string;
  contentPillars: string;
  owner: string;
  budget: string;
  currency: AgencyCampaign['currency'];
  deadline: string;
  priority: CampaignPriority;
  deliverables: CampaignDeliverable[];
}

const emptyCampaignDraft = (clientId = ''): CampaignDraft => ({
  clientId,
  name: '',
  objective: 'conversion',
  brief: '',
  product: '',
  targetAudience: '',
  offer: '',
  contentPillars: '',
  owner: 'Egoric Team',
  budget: '10000000',
  currency: 'VND',
  deadline: '',
  priority: 'normal',
  deliverables: [createCampaignDeliverable()],
});

const CampaignHub: React.FC<CampaignHubProps> = ({ projects, onOpenProject, onOpenProjectWithDirector, onOpenProjectWithProductionControl, onOpenProjectWithClientReview }) => {
  const { showAlert } = useAlert();
  const { t, localeTag } = useLocale();
  const statusColumns = useMemo(() => STATUS_COLUMN_DEFS.map((column) => ({
    id: column.id,
    label: t(column.labelKey),
    detail: t(column.detailKey),
  })), [t]);
  const objectiveLabels = useMemo<Record<CampaignObjective, string>>(() => Object.fromEntries(
    (Object.keys(OBJECTIVE_LABEL_KEYS) as CampaignObjective[]).map((key) => [key, t(OBJECTIVE_LABEL_KEYS[key])]),
  ) as Record<CampaignObjective, string>, [t]);
  const platformLabels = useMemo<Record<CampaignPlatform, string>>(() => ({
    ...STATIC_PLATFORM_LABELS,
    other: t('campaign.platform.other'),
  }), [t]);
  const deliverableStatusLabels = useMemo<Record<DeliverableStatus, string>>(() => Object.fromEntries(
    (Object.keys(DELIVERABLE_STATUS_LABEL_KEYS) as DeliverableStatus[]).map((key) => [key, t(DELIVERABLE_STATUS_LABEL_KEYS[key])]),
  ) as Record<DeliverableStatus, string>, [t]);
  const priorityLabels = useMemo<Record<CampaignPriority, string>>(() => Object.fromEntries(
    (Object.keys(PRIORITY_LABEL_KEYS) as CampaignPriority[]).map((key) => [key, t(PRIORITY_LABEL_KEYS[key])]),
  ) as Record<CampaignPriority, string>, [t]);
  const [clients, setClients] = useState<AgencyClient[]>([]);
  const [campaigns, setCampaigns] = useState<AgencyCampaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [showClientForm, setShowClientForm] = useState(false);
  const [showClientDirectory, setShowClientDirectory] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(() => emptyCampaignDraft());
  const [clientDraft, setClientDraft] = useState({ name: '', brandName: '', industry: '', contactName: '', contactEmail: '', contactPhone: '', website: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [openingDeliverableId, setOpeningDeliverableId] = useState<string | null>(null);
  const [openingCreativeStrategy, setOpeningCreativeStrategy] = useState(false);
  const [showPreProduction, setShowPreProduction] = useState(false);
  const [brandKitClientId, setBrandKitClientId] = useState<string | null>(null);

  const reloadWorkspace = async (background = false) => {
    if (!background) setIsLoading(true);
    try {
      const [nextClients, nextCampaigns] = await Promise.all([getAllAgencyClients(), getAllAgencyCampaigns()]);
      setClients(nextClients);
      setCampaigns(nextCampaigns);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : t('campaign.loadError'), { type: 'error' });
    } finally {
      if (!background) setIsLoading(false);
    }
  };

  useEffect(() => { void reloadWorkspace(); }, []);

  useEffect(() => {
    const refreshAfterCloudMerge = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceSyncAppliedDetail>).detail;
      if (detail?.collections.some((collection) => collection === 'agencyClients' || collection === 'agencyCampaigns')) {
        void reloadWorkspace(true);
      }
    };
    window.addEventListener(WORKSPACE_SYNC_APPLIED_EVENT, refreshAfterCloudMerge);
    return () => window.removeEventListener(WORKSPACE_SYNC_APPLIED_EVENT, refreshAfterCloudMerge);
  }, []);

  const clientsById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const selectedClient = selectedCampaign ? clientsById.get(selectedCampaign.clientId) : undefined;
  const selectedCampaignReadiness = selectedCampaign && selectedClient
    ? getCampaignBriefReadiness(selectedCampaign, selectedClient)
    : undefined;
  const filteredCampaigns = useMemo(() => campaigns.filter((campaign) => {
    if (clientFilter !== 'all' && campaign.clientId !== clientFilter) return false;
    if (!query.trim()) return true;
    const client = clientsById.get(campaign.clientId);
    const haystack = `${campaign.name} ${campaign.owner} ${campaign.brief} ${client?.name || ''} ${client?.brandName || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [campaigns, clientFilter, clientsById, query]);

  const activeCampaigns = campaigns.filter((campaign) => !['delivered', 'paused'].includes(campaign.status));
  const dueSoon = activeCampaigns.filter((campaign) => campaign.deadline && campaign.deadline <= Date.now() + 7 * 86400000).length;
  const totalDeliverables = activeCampaigns.reduce((sum, campaign) => sum + getCampaignDeliverableCount(campaign), 0);
  const activeBudgetVnd = activeCampaigns.reduce((sum, campaign) => sum + (campaign.currency === 'VND' ? campaign.budget : 0), 0);

  const openNewCampaign = (clientId = '') => {
    setEditingCampaignId(null);
    setCampaignDraft(emptyCampaignDraft(clientId || clients[0]?.id || ''));
    setFormError('');
    setShowCampaignForm(true);
  };

  const openClientForm = () => {
    setClientDraft({ name: '', brandName: '', industry: '', contactName: '', contactEmail: '', contactPhone: '', website: '', notes: '' });
    setFormError('');
    setShowClientForm(true);
  };

  const openEditCampaign = (campaign: AgencyCampaign) => {
    setEditingCampaignId(campaign.id);
    setCampaignDraft({
      clientId: campaign.clientId,
      name: campaign.name,
      objective: campaign.objective,
      brief: campaign.brief,
      product: campaign.product || '',
      targetAudience: campaign.targetAudience,
      offer: campaign.offer || '',
      contentPillars: campaign.contentPillars.join('\n'),
      owner: campaign.owner,
      budget: String(campaign.budget),
      currency: campaign.currency,
      deadline: toDateInput(campaign.deadline),
      priority: campaign.priority,
      deliverables: campaign.deliverables.map((deliverable) => ({ ...deliverable })),
    });
    setSelectedCampaignId(null);
    setFormError('');
    setShowCampaignForm(true);
  };

  const saveClient = async () => {
    setFormError('');
    if (!clientDraft.name.trim()) {
      setFormError(t('campaign.clientRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const client = createAgencyClient(clientDraft);
      await saveAgencyClient(client);
      setClients((current) => [client, ...current]);
      setCampaignDraft((current) => ({ ...current, clientId: client.id }));
      setClientDraft({ name: '', brandName: '', industry: '', contactName: '', contactEmail: '', contactPhone: '', website: '', notes: '' });
      setShowClientForm(false);
      if (!showCampaignForm) {
        setShowClientDirectory(false);
        openNewCampaign(client.id);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('campaign.saveClientError'));
    } finally {
      setIsSaving(false);
    }
  };

  const saveCampaign = async () => {
    setFormError('');
    if (!campaignDraft.clientId) {
      setFormError(t('campaign.clientSelectionRequired'));
      return;
    }
    if (!campaignDraft.name.trim()) {
      setFormError(t('campaign.nameRequired'));
      return;
    }
    if (!campaignDraft.owner.trim()) {
      setFormError(t('campaign.ownerRequired'));
      return;
    }
    setIsSaving(true);
    try {
      const validated = createAgencyCampaign({
        clientId: campaignDraft.clientId,
        name: campaignDraft.name,
        objective: campaignDraft.objective,
        brief: campaignDraft.brief,
        product: campaignDraft.product,
        targetAudience: campaignDraft.targetAudience,
        offer: campaignDraft.offer,
        contentPillars: campaignDraft.contentPillars.split('\n').map((item) => item.trim()).filter(Boolean),
        owner: campaignDraft.owner,
        budget: Number(campaignDraft.budget),
        currency: campaignDraft.currency,
        deadline: parseDateInput(campaignDraft.deadline),
        priority: campaignDraft.priority,
        deliverables: campaignDraft.deliverables,
      });
      const previous = editingCampaignId ? campaigns.find((campaign) => campaign.id === editingCampaignId) : undefined;
      const campaign: AgencyCampaign = previous ? {
        ...previous,
        clientId: validated.clientId,
        name: validated.name,
        objective: validated.objective,
        brief: validated.brief,
        product: validated.product,
        targetAudience: validated.targetAudience,
        offer: validated.offer,
        contentPillars: validated.contentPillars,
        owner: validated.owner,
        budget: validated.budget,
        currency: validated.currency,
        deadline: validated.deadline,
        priority: validated.priority,
        deliverables: validated.deliverables,
        updatedAt: Date.now(),
      } : validated;
      await saveAgencyCampaign(campaign);
      setCampaigns((current) => previous
        ? current.map((item) => item.id === campaign.id ? campaign : item)
        : [campaign, ...current]);
      setShowCampaignForm(false);
      setEditingCampaignId(null);
      setSelectedCampaignId(campaign.id);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('campaign.saveCampaignError'));
    } finally {
      setIsSaving(false);
    }
  };

  const changeCampaignStatus = async (campaign: AgencyCampaign, status: CampaignStatus) => {
    const next = updateCampaignStatus(campaign, status);
    await saveAgencyCampaign(next);
    setCampaigns((current) => current.map((item) => item.id === next.id ? next : item));
  };

  const changeDeliverableStatus = async (campaign: AgencyCampaign, deliverableId: string, status: DeliverableStatus) => {
    const next = updateCampaignDeliverable(campaign, deliverableId, { status });
    await saveAgencyCampaign(next);
    setCampaigns((current) => current.map((item) => item.id === next.id ? next : item));
  };

  /**
   * Khôi phục liên kết campaign → project khi dữ liệu campaign đã được đồng bộ
   * từ cloud nhưng project tương ứng không còn trên thiết bị hiện tại.
   */
  const createAndPersistDeliverableProject = async (
    campaign: AgencyCampaign,
    client: AgencyClient,
    deliverable: CampaignDeliverable,
  ): Promise<ProjectState> => {
    const created = createProjectForCampaignDeliverable(campaign, client, deliverable.id);
    await Promise.all([saveAgencyCampaign(created.campaign), saveProjectToDB(created.project)]);
    setCampaigns((current) => current.map((item) => item.id === created.campaign.id ? created.campaign : item));
    return created.project;
  };

  const resolveDeliverableProject = async (
    campaign: AgencyCampaign,
    client: AgencyClient,
    deliverable: CampaignDeliverable,
  ): Promise<ProjectState> => {
    if (!deliverable.projectId) {
      return createAndPersistDeliverableProject(campaign, client, deliverable);
    }

    let target = projectsById.get(deliverable.projectId);
    if (!target) {
      try {
        target = await loadProjectFromDB(deliverable.projectId);
      } catch (error) {
        // Campaign/Brand Kit được đồng bộ cấp workspace, còn project có thể chỉ
        // nằm trên trình duyệt cũ. Tự tạo lại project thay vì chặn người dùng.
        if (error instanceof Error && error.message === 'Không tìm thấy dự án') {
          return createAndPersistDeliverableProject(campaign, client, deliverable);
        }
        throw error;
      }
    }

    const refreshed = { ...target, brandKitSnapshot: normalizeBrandKit(client.brandKit) };
    await saveProjectToDB(refreshed);
    return refreshed;
  };

  const openDeliverableProject = async (
    campaign: AgencyCampaign,
    deliverable: CampaignDeliverable,
    destination: 'workspace' | 'content' | 'production' | 'review' = 'workspace',
  ) => {
    setOpeningDeliverableId(deliverable.id);
    try {
      const client = clientsById.get(campaign.clientId);
      if (!client) throw new Error(t('campaign.missingClient'));
      const openTarget = async (target: ProjectState) => {
        const destinationTarget = destination === 'content'
          ? { ...target, stage: 'content' as const, lastModified: Date.now() }
          : target;
        if (destination === 'content') await saveProjectToDB(destinationTarget);
        if (destination === 'review' && onOpenProjectWithClientReview) onOpenProjectWithClientReview(destinationTarget);
        else if (destination === 'production' && onOpenProjectWithProductionControl) onOpenProjectWithProductionControl(destinationTarget);
        else onOpenProject(destinationTarget);
      };
      const target = await resolveDeliverableProject(campaign, client, deliverable);
      await openTarget(target);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : t('campaign.openWorkspaceError'), { type: 'error' });
    } finally {
      setOpeningDeliverableId(null);
    }
  };

  /**
   * Lối tắt từ Campaign Hub vào đúng tính năng mới.
   *
   * Ưu tiên đầu ra của chiến dịch đang chạy để Brand Kit và brief đi theo.
   * Workspace chưa có campaign thì dùng dự án gần nhất; trống hoàn toàn mới
   * tạo một dự án nội dung độc lập.
   */
  const openCreativeStrategy = async () => {
    setOpeningCreativeStrategy(true);
    try {
      const campaign = activeCampaigns[0] ?? campaigns[0];
      const deliverable = campaign?.deliverables[0];
      if (campaign && deliverable) {
        await openDeliverableProject(campaign, deliverable, 'content');
        return;
      }

      const recentProject = [...projects].sort((a, b) => b.lastModified - a.lastModified)[0];
      if (recentProject) {
        const target = { ...recentProject, stage: 'content' as const, lastModified: Date.now() };
        await saveProjectToDB(target);
        onOpenProject(target);
        return;
      }

      const created = { ...createNewProjectState(), stage: 'content' as const, title: t('campaign.newContentProject') };
      await saveProjectToDB(created);
      onOpenProject(created);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : t('campaign.openContentError'), { type: 'error' });
    } finally {
      setOpeningCreativeStrategy(false);
    }
  };

  const launchPreProduction = async (campaign: AgencyCampaign, client: AgencyClient, deliverable: CampaignDeliverable) => {
    setOpeningDeliverableId(deliverable.id);
    try {
      const targetProject = await resolveDeliverableProject(campaign, client, deliverable);
      const prompt = buildCampaignPreProductionPrompt(campaign, client, deliverable);
      setShowPreProduction(false);
      if (onOpenProjectWithDirector) onOpenProjectWithDirector(targetProject, prompt);
      else onOpenProject(targetProject);
    } catch (error) {
      showAlert(error instanceof Error ? error.message : t('campaign.preProductionError'), { type: 'error' });
    } finally {
      setOpeningDeliverableId(null);
    }
  };

  const removeCampaign = (campaign: AgencyCampaign) => {
    showAlert(t('campaign.deleteQuestion', { name: campaign.name }), {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        await deleteAgencyCampaign(campaign.id);
        setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
        setSelectedCampaignId(null);
      },
    });
  };

  const removeClient = (client: AgencyClient) => {
    if (campaigns.some((campaign) => campaign.clientId === client.id)) {
      showAlert(t('campaign.clientHasCampaigns'), { type: 'warning' });
      return;
    }
    showAlert(t('campaign.deleteClientQuestion', { name: client.name }), {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        await deleteAgencyClient(client.id);
        setClients((current) => current.filter((item) => item.id !== client.id));
      },
    });
  };

  const patchDeliverableDraft = (id: string, updates: Partial<CampaignDeliverable>) => {
    setCampaignDraft((current) => ({
      ...current,
      deliverables: current.deliverables.map((deliverable) => deliverable.id === id ? { ...deliverable, ...updates } : deliverable),
    }));
  };

  const saveClientBrandKit = async (client: AgencyClient) => {
    await saveAgencyClient(client);
    setClients((current) => current.map((item) => item.id === client.id ? client : item));
    showAlert(t('campaign.brandKitUpdated', { brand: client.brandName }), { type: 'success' });
  };

  const brandKitClient = brandKitClientId ? clientsById.get(brandKitClientId) : undefined;

  return (
    <main className="mx-auto max-w-[1800px] px-4 py-7 md:px-8 md:py-9">
      <section className="relative overflow-hidden rounded-[28px] border border-white/[.08] bg-[linear-gradient(125deg,rgba(18,25,34,.98),rgba(8,12,17,.96))] p-6 shadow-2xl shadow-black/20 md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-200/[.075] blur-3xl" />
        <div className="relative flex flex-col gap-7 2xl:flex-row 2xl:items-end 2xl:justify-between">
          <div className="max-w-3xl">
            <div className="eg-kicker">{t('campaign.commandCenter')}</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-.035em] text-white md:text-[40px]">{t('campaign.title')}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{t('campaign.description')}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => openNewCampaign()} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><Plus className="h-4 w-4" /> {t('campaign.new')}</button>
              <button type="button" onClick={() => setShowClientDirectory(true)} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-5 text-xs font-semibold"><UsersRound className="h-4 w-4" /> {t('campaign.clients')}</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:min-w-[720px]">
            {[
              { label: t('campaign.active'), value: activeCampaigns.length, icon: FolderKanban, detail: t('campaign.activeDetail') },
              { label: t('campaign.deadline7'), value: dueSoon, icon: CalendarClock, detail: t('campaign.deadline7Detail') },
              { label: t('campaign.deliverables'), value: totalDeliverables, icon: Film, detail: t('campaign.deliverablesDetail') },
              { label: t('campaign.activeBudget'), value: activeBudgetVnd ? `${Math.round(activeBudgetVnd / 1_000_000)}tr` : '0', icon: CircleDollarSign, detail: 'VND' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-white/[.08] bg-black/20 p-4">
                <div className="flex items-center justify-between gap-2"><stat.icon className="h-4 w-4 text-cyan-100/70" /><span className="font-mono text-[8px] uppercase tracking-wider text-zinc-700">Live</span></div>
                <div className="mt-4 font-mono text-2xl font-semibold tabular-nums text-white">{stat.value}</div>
                <div className="mt-1 text-[11px] font-medium text-zinc-400">{stat.label}</div>
                <div className="mt-0.5 text-[9px] text-zinc-700">{stat.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative mt-5 overflow-hidden rounded-2xl border border-cyan-200/20 bg-[linear-gradient(105deg,rgba(22,48,57,.76),rgba(10,18,24,.92))] p-5 shadow-xl shadow-black/15 md:p-6" aria-labelledby="creative-strategy-launch-title">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-cyan-200/[.1] blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/[.09] text-cyan-50">
              <Compass className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eg-kicker">{t('campaign.newInRelease')}</span>
                <span className="eg-chip border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100">0 credit</span>
              </div>
              <h2 id="creative-strategy-launch-title" className="mt-2 text-lg font-semibold text-white md:text-xl">
                {t('campaign.strategyRoom')}
              </h2>
              <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-400">
                {t('campaign.strategyDescription')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="eg-chip border-white/[.08] bg-black/15 text-zinc-300">{t('campaign.threeDirections')}</span>
                <span className="eg-chip border-white/[.08] bg-black/15 text-zinc-300">{t('campaign.maxLenses')}</span>
                <span className="eg-chip border-white/[.08] bg-black/15 text-zinc-300">{t('campaign.brandKitAttached')}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void openCreativeStrategy()}
            disabled={openingCreativeStrategy || openingDeliverableId !== null}
            className="eg-button-primary inline-flex min-h-12 shrink-0 items-center justify-center gap-2 px-6 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {openingCreativeStrategy || openingDeliverableId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Compass className="h-4 w-4" />}
            {t('campaign.openContentStudio')}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="mt-7 rounded-2xl border border-white/[.07] bg-white/[.02] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1 lg:max-w-xl"><Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-zinc-600" /><label htmlFor="campaign-search" className="sr-only">{t('campaign.searchLabel')}</label><input id="campaign-search" value={query} onChange={(event) => setQuery(event.target.value)} className="eg-input pl-10 pr-4 text-xs" placeholder={t('campaign.searchPlaceholder')} /></div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="campaign-client-filter" className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.clients')}</label>
            <select id="campaign-client-filter" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="eg-input min-w-52 px-3 text-xs"><option value="all">{t('campaign.allClients')}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.brandName}</option>)}</select>
          </div>
        </div>
      </section>

      {isLoading ? (
        <div className="mt-6 flex min-h-72 items-center justify-center rounded-2xl border border-white/[.07] bg-white/[.02] text-xs text-zinc-500"><Loader2 className="mr-3 h-5 w-5 animate-spin text-cyan-200" /> {t('campaign.loadingBoard')}</div>
      ) : campaigns.length === 0 ? (
        <section className="mt-6 flex min-h-[420px] flex-col items-center justify-center rounded-[28px] border border-dashed border-white/[.1] bg-white/[.015] p-8 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-200/[.055] text-cyan-100"><LayoutGrid className="h-7 w-7" /></span>
          <h2 className="mt-5 text-lg font-semibold text-white">{t('campaign.firstTitle')}</h2>
          <p className="mt-2 max-w-lg text-xs leading-6 text-zinc-500">{t('campaign.firstDescription')}</p>
          <button type="button" onClick={() => clients.length ? openNewCampaign() : openClientForm()} className="eg-button-primary mt-6 inline-flex items-center justify-center gap-2 px-5 text-xs font-bold"><Plus className="h-4 w-4" /> {clients.length ? t('campaign.create') : t('campaign.addFirstClient')}</button>
        </section>
      ) : (
        <section className="mt-6 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" aria-label={t('campaign.boardLabel')}>
          {statusColumns.map((column) => {
            const columnCampaigns = filteredCampaigns.filter((campaign) => campaign.status === column.id);
            return (
              <section key={column.id} className="min-w-0 rounded-2xl border border-white/[.07] bg-white/[.018] p-3" aria-labelledby={`campaign-column-${column.id}`}>
                <header className="flex min-h-14 items-start justify-between gap-3 px-1 pb-3">
                  <div><h2 id={`campaign-column-${column.id}`} className="text-xs font-semibold text-zinc-200">{column.label}</h2><p className="mt-1 text-[9px] text-zinc-700">{column.detail}</p></div>
                  <span className="flex h-7 min-w-7 items-center justify-center rounded-lg border border-white/[.08] bg-black/20 px-2 font-mono text-[9px] text-zinc-500">{columnCampaigns.length}</span>
                </header>
                <div className="space-y-3">
                  {columnCampaigns.map((campaign) => {
                    const client = clientsById.get(campaign.clientId);
                    const progress = getCampaignProgress(campaign);
                    const overdue = Boolean(campaign.deadline && campaign.deadline < Date.now() && campaign.status !== 'delivered');
                    return (
                      <button key={campaign.id} type="button" onClick={() => setSelectedCampaignId(campaign.id)} className="eg-card eg-card-interactive w-full p-4 text-left">
                        <div className="flex items-start justify-between gap-3"><span className="eg-chip max-w-full truncate border-white/[.08] bg-white/[.035] text-zinc-400">{client?.brandName || t('campaign.unknownClient')}</span>{campaign.priority !== 'normal' && <span className={`shrink-0 font-mono text-[8px] uppercase tracking-wider ${campaign.priority === 'urgent' ? 'text-rose-200' : campaign.priority === 'high' ? 'text-amber-200' : 'text-zinc-600'}`}>{priorityLabels[campaign.priority]}</span>}</div>
                        <h3 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-white">{campaign.name}</h3>
                        <p className="mt-2 line-clamp-2 min-h-8 text-[10px] leading-4 text-zinc-600">{objectiveLabels[campaign.objective]} · {campaign.brief || t('campaign.noBrief')}</p>
                        <div className="mt-4 flex items-center justify-between text-[9px]"><span className="text-zinc-600">{t('campaign.progress')}</span><span className="font-mono tabular-nums text-zinc-400">{progress}%</span></div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--eg-accent)]" style={{ width: `${progress}%` }} /></div>
                        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3">
                          <span className="flex items-center gap-1.5 text-[9px] text-zinc-600"><Film className="h-3 w-3" /> {t('campaign.outputCount', { count: getCampaignDeliverableCount(campaign) })}</span>
                          <span className={`flex items-center justify-end gap-1.5 text-[9px] ${overdue ? 'text-rose-200' : 'text-zinc-600'}`}><Clock3 className="h-3 w-3" /> {formatDate(campaign.deadline, localeTag, t('common.notSet'))}</span>
                        </div>
                      </button>
                    );
                  })}
                  {columnCampaigns.length === 0 && <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-white/[.06] px-3 text-center text-[9px] leading-4 text-zinc-700">{t('campaign.emptyColumn')}</div>}
                </div>
              </section>
            );
          })}
        </section>
      )}

      {showCampaignForm && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl" onClick={() => setShowCampaignForm(false)}>
          <div className="eg-panel flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="campaign-form-title" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:px-7 md:py-6"><div><div className="eg-kicker">{t('campaign.formKicker')}</div><h2 id="campaign-form-title" className="mt-1 text-xl font-semibold text-white">{editingCampaignId ? t('campaign.formEditTitle') : t('campaign.formNewTitle')}</h2><p className="mt-1 text-xs text-zinc-500">{t('campaign.formDescription')}</p></div><button type="button" onClick={() => setShowCampaignForm(false)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label={t('campaign.closeForm')}><X className="h-4 w-4" /></button></header>
            <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
              {formError && <div role="alert" className="mb-5 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-xs leading-5 text-rose-100">{formError}</div>}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldClient')} *<div className="mt-2 flex gap-2"><select value={campaignDraft.clientId} onChange={(event) => setCampaignDraft((current) => ({ ...current, clientId: event.target.value }))} className="eg-input min-w-0 flex-1 px-3 text-xs normal-case tracking-normal"><option value="">{t('campaign.selectClient')}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.brandName}</option>)}</select><button type="button" onClick={openClientForm} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label={t('campaign.addClient')}><Plus className="h-4 w-4" /></button></div></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldName')} *<input value={campaignDraft.name} onChange={(event) => setCampaignDraft((current) => ({ ...current, name: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.namePlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldObjective')}<select value={campaignDraft.objective} onChange={(event) => setCampaignDraft((current) => ({ ...current, objective: event.target.value as CampaignObjective }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{(Object.keys(objectiveLabels) as CampaignObjective[]).map((objective) => <option key={objective} value={objective}>{objectiveLabels[objective]}</option>)}</select></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldOwner')} *<input value={campaignDraft.owner} onChange={(event) => setCampaignDraft((current) => ({ ...current, owner: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.ownerPlaceholder')} /></label>
                <label className="md:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldBrief')}<textarea value={campaignDraft.brief} onChange={(event) => setCampaignDraft((current) => ({ ...current, brief: event.target.value }))} rows={5} className="eg-input mt-2 min-h-28 resize-y px-4 py-3 text-sm font-normal leading-6 normal-case tracking-normal" placeholder={t('campaign.briefPlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldProduct')}<textarea value={campaignDraft.product} onChange={(event) => setCampaignDraft((current) => ({ ...current, product: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.productPlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldAudience')}<textarea value={campaignDraft.targetAudience} onChange={(event) => setCampaignDraft((current) => ({ ...current, targetAudience: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.audiencePlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldOffer')}<textarea value={campaignDraft.offer} onChange={(event) => setCampaignDraft((current) => ({ ...current, offer: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.offerPlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldPillars')}<textarea value={campaignDraft.contentPillars} onChange={(event) => setCampaignDraft((current) => ({ ...current, contentPillars: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.pillarsPlaceholder')} /></label>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldBudget')}<div className="mt-2 grid grid-cols-[1fr_92px] gap-2"><input type="number" min="0" value={campaignDraft.budget} onChange={(event) => setCampaignDraft((current) => ({ ...current, budget: event.target.value }))} className="eg-input px-4 font-mono text-sm normal-case tracking-normal" /><select value={campaignDraft.currency} onChange={(event) => setCampaignDraft((current) => ({ ...current, currency: event.target.value as AgencyCampaign['currency'] }))} className="eg-input px-2 text-xs normal-case tracking-normal"><option value="VND">VND</option><option value="USD">USD</option></select></div></label>
                <div className="grid grid-cols-2 gap-3"><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldDeadline')}<input type="date" value={campaignDraft.deadline} onChange={(event) => setCampaignDraft((current) => ({ ...current, deadline: event.target.value }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal" /></label><label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldPriority')}<select value={campaignDraft.priority} onChange={(event) => setCampaignDraft((current) => ({ ...current, priority: event.target.value as CampaignPriority }))} className="eg-input mt-2 px-3 text-xs normal-case tracking-normal">{(Object.keys(priorityLabels) as CampaignPriority[]).map((priority) => <option key={priority} value={priority}>{priorityLabels[priority]}</option>)}</select></label></div>
              </div>

              <section className="mt-7 border-t border-white/[.07] pt-6">
                <div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-white">{t('campaign.deliverableList')}</h3><p className="mt-1 text-[10px] leading-4 text-zinc-600">{t('campaign.deliverableListDescription')}</p></div><button type="button" onClick={() => setCampaignDraft((current) => ({ ...current, deliverables: [...current.deliverables, createCampaignDeliverable({ title: t('campaign.defaultDeliverable', { number: current.deliverables.length + 1 }) })] }))} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-[10px] font-semibold"><Plus className="h-3.5 w-3.5" /> {t('campaign.addDeliverable')}</button></div>
                <div className="mt-4 space-y-3">{campaignDraft.deliverables.map((deliverable, index) => (
                  <article key={deliverable.id} className="rounded-2xl border border-white/[.07] bg-black/15 p-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(130px,.8fr)_100px_100px_90px_44px] md:items-end">
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.fieldDeliverableName')}<input value={deliverable.title} onChange={(event) => patchDeliverableDraft(deliverable.id, { title: event.target.value })} className="eg-input mt-2 px-3 text-xs font-normal normal-case tracking-normal" /></label>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.fieldPlatform')}<select value={deliverable.platform} onChange={(event) => patchDeliverableDraft(deliverable.id, { platform: event.target.value as CampaignPlatform })} className="eg-input mt-2 px-2 text-xs normal-case tracking-normal">{(Object.keys(platformLabels) as CampaignPlatform[]).map((platform) => <option key={platform} value={platform}>{platformLabels[platform]}</option>)}</select></label>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.fieldAspectRatio')}<select value={deliverable.aspectRatio} onChange={(event) => patchDeliverableDraft(deliverable.id, { aspectRatio: event.target.value as CampaignDeliverable['aspectRatio'] })} className="eg-input mt-2 px-2 text-xs normal-case tracking-normal"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select></label>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.fieldSeconds')}<input type="number" min="1" value={deliverable.duration} onChange={(event) => patchDeliverableDraft(deliverable.id, { duration: Number(event.target.value) })} className="eg-input mt-2 px-3 font-mono text-xs normal-case tracking-normal" /></label>
                      <label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">{t('campaign.fieldQuantity')}<input type="number" min="1" value={deliverable.quantity} onChange={(event) => patchDeliverableDraft(deliverable.id, { quantity: Number(event.target.value) })} className="eg-input mt-2 px-3 font-mono text-xs normal-case tracking-normal" /></label>
                      <button type="button" onClick={() => setCampaignDraft((current) => ({ ...current, deliverables: current.deliverables.filter((item) => item.id !== deliverable.id) }))} disabled={campaignDraft.deliverables.length === 1} className="eg-icon-button flex h-11 w-11 items-center justify-center text-zinc-600 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-30" aria-label={t('campaign.removeDeliverable', { number: index + 1 })}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </article>
                ))}</div>
              </section>
            </div>
            <footer className="grid shrink-0 grid-cols-[auto_1fr] gap-3 border-t eg-divider bg-black/15 p-4 md:px-7"><button type="button" onClick={() => setShowCampaignForm(false)} className="eg-button-secondary px-5 text-xs font-semibold">{t('common.cancel')}</button><button type="button" onClick={() => void saveCampaign()} disabled={isSaving} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold disabled:opacity-50">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {editingCampaignId ? t('campaign.saveChanges') : t('campaign.create')}</button></footer>
          </div>
        </div>
      )}

      {showClientForm && (
        <div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/80 p-4 backdrop-blur-xl" onClick={() => setShowClientForm(false)}>
          <div className="eg-panel w-full max-w-2xl overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="client-form-title" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:p-6"><div><div className="eg-kicker">{t('campaign.clientFormKicker')}</div><h2 id="client-form-title" className="mt-1 text-xl font-semibold text-white">{t('campaign.clientFormTitle')}</h2></div><button type="button" onClick={() => setShowClientForm(false)} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={t('campaign.closeClientForm')}><X className="h-4 w-4" /></button></header>
            <div className="p-5 md:p-6">{formError && <div role="alert" className="mb-4 rounded-xl border border-rose-200/20 bg-rose-200/[.06] p-3 text-xs text-rose-100">{formError}</div>}<div className="grid gap-4 sm:grid-cols-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldClientName')} *<input value={clientDraft.name} onChange={(event) => setClientDraft((current) => ({ ...current, name: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.clientNamePlaceholder')} /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldBrandName')}<input value={clientDraft.brandName} onChange={(event) => setClientDraft((current) => ({ ...current, brandName: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldIndustry')}<input value={clientDraft.industry} onChange={(event) => setClientDraft((current) => ({ ...current, industry: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder={t('campaign.industryPlaceholder')} /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldContact')}<input value={clientDraft.contactName} onChange={(event) => setClientDraft((current) => ({ ...current, contactName: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldEmail')}<input type="email" value={clientDraft.contactEmail} onChange={(event) => setClientDraft((current) => ({ ...current, contactEmail: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldPhone')}<input type="tel" value={clientDraft.contactPhone} onChange={(event) => setClientDraft((current) => ({ ...current, contactPhone: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" /></label>
              <label className="sm:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldWebsite')}<input type="url" value={clientDraft.website} onChange={(event) => setClientDraft((current) => ({ ...current, website: event.target.value }))} className="eg-input mt-2 px-4 text-sm font-normal normal-case tracking-normal" placeholder="https://" /></label>
              <label className="sm:col-span-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{t('campaign.fieldNotes')}<textarea value={clientDraft.notes} onChange={(event) => setClientDraft((current) => ({ ...current, notes: event.target.value }))} rows={3} className="eg-input mt-2 min-h-24 resize-y px-4 py-3 text-sm font-normal normal-case tracking-normal" /></label>
            </div></div>
            <footer className="grid grid-cols-[auto_1fr] gap-3 border-t eg-divider bg-black/15 p-4 md:px-6"><button type="button" onClick={() => setShowClientForm(false)} className="eg-button-secondary px-5 text-xs font-semibold">{t('common.cancel')}</button><button type="button" onClick={() => void saveClient()} disabled={isSaving} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold disabled:opacity-50">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('campaign.saveClient')}</button></footer>
          </div>
        </div>
      )}

      {selectedCampaign && (
        <div className="fixed inset-0 z-[225] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl" onClick={() => setSelectedCampaignId(null)}>
          <div className="eg-panel flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="campaign-detail-title" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:p-7"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="eg-chip">{clientsById.get(selectedCampaign.clientId)?.brandName || t('campaign.clients')}</span><span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{priorityLabels[selectedCampaign.priority]}</span></div><h2 id="campaign-detail-title" className="mt-3 text-xl font-semibold text-white md:text-2xl">{selectedCampaign.name}</h2><p className="mt-2 text-xs text-zinc-500">{objectiveLabels[selectedCampaign.objective]}</p></div><button type="button" onClick={() => setSelectedCampaignId(null)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center" aria-label={t('campaign.closeDetail')}><X className="h-4 w-4" /></button></header>
            <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-7">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="eg-card p-4"><UserRound className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.owner')}</span><strong className="mt-1 block text-xs text-white">{selectedCampaign.owner}</strong></div>
                <div className="eg-card p-4"><CalendarClock className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldDeadline')}</span><strong className="mt-1 block text-xs text-white">{formatDate(selectedCampaign.deadline, localeTag, t('common.notSet'))}</strong></div>
                <div className="eg-card p-4"><CircleDollarSign className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldBudget')}</span><strong className="mt-1 block text-xs text-white">{formatBudget(selectedCampaign.budget, selectedCampaign.currency, localeTag)}</strong></div>
                <label className="eg-card block p-4 text-[9px] uppercase tracking-wider text-zinc-600"><PauseCircle className="h-4 w-4 text-cyan-100/60" /><span className="mt-3 block">{t('campaign.status')}</span><select value={selectedCampaign.status} onChange={(event) => void changeCampaignStatus(selectedCampaign, event.target.value as CampaignStatus)} className="mt-1 w-full bg-transparent text-xs font-semibold normal-case tracking-normal text-white outline-none">{statusColumns.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}</select></label>
              </div>
              <div className="mt-5 grid gap-4 xl:grid-cols-3"><section className="eg-card p-5"><div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-cyan-100/60" /><h3 className="text-xs font-semibold text-white">Brief</h3></div><p className="mt-4 whitespace-pre-wrap text-xs leading-6 text-zinc-400">{selectedCampaign.brief || t('campaign.noDetailedBrief')}</p></section><section className="eg-card p-5"><div className="flex items-center gap-2"><Film className="h-4 w-4 text-cyan-100/60" /><h3 className="text-xs font-semibold text-white">{t('campaign.productAndPillars')}</h3></div><div className="mt-4 space-y-4 text-xs leading-5"><div><span className="block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldProduct')}</span><p className="mt-1 whitespace-pre-wrap text-zinc-400">{selectedCampaign.product || t('campaign.notDefined')}</p></div><div><span className="block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldPillars')}</span><div className="mt-2 flex flex-wrap gap-2">{selectedCampaign.contentPillars.length ? selectedCampaign.contentPillars.map((pillar) => <span key={pillar} className="eg-chip">{pillar}</span>) : <span className="text-zinc-500">{t('campaign.notDefined')}</span>}</div></div></div></section><section className="eg-card p-5"><div className="flex items-center gap-2"><Target className="h-4 w-4 text-cyan-100/60" /><h3 className="text-xs font-semibold text-white">{t('campaign.audienceAndCta')}</h3></div><div className="mt-4 space-y-4 text-xs leading-5"><div><span className="block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldAudience')}</span><p className="mt-1 text-zinc-400">{selectedCampaign.targetAudience || t('campaign.notDefined')}</p></div><div><span className="block text-[9px] uppercase tracking-wider text-zinc-600">{t('campaign.fieldOffer')}</span><p className="mt-1 text-zinc-400">{selectedCampaign.offer || t('campaign.notDefined')}</p></div></div></section></div>
              {selectedClient && (
                <CampaignZeroPanel
                  campaign={selectedCampaign}
                  client={selectedClient}
                  projects={projects}
                />
              )}
              {selectedClient && selectedCampaignReadiness && (
                <section className="mt-5 overflow-hidden rounded-2xl border border-cyan-200/[.14] bg-[linear-gradient(115deg,rgba(24,39,50,.78),rgba(8,13,18,.82))] p-5">
                  <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/[.055] text-cyan-100"><Sparkles className="h-5 w-5" /></span>
                      <div className="min-w-0"><div className="eg-kicker">{t('campaign.preProductionKicker')}</div><h3 className="mt-1 text-base font-semibold text-white">{t('campaign.preProductionTitle')}</h3><p className="mt-2 max-w-2xl text-[11px] leading-5 text-zinc-500">{t('campaign.preProductionDescription', { score: selectedCampaignReadiness.score })}</p></div>
                    </div>
                    <button type="button" onClick={() => setShowPreProduction(true)} className="eg-button-primary inline-flex min-h-11 shrink-0 items-center justify-center gap-2 px-5 text-xs font-bold"><Sparkles className="h-4 w-4" /> {t('campaign.openPreProduction')}</button>
                  </div>
                </section>
              )}
              <section className="mt-6"><div className="flex items-end justify-between gap-3"><div><div className="eg-kicker">{t('campaign.productionOutputs')}</div><h3 className="mt-1 text-base font-semibold text-white">{t('campaign.outputTitle')}</h3></div><span className="eg-chip"><Film className="h-3 w-3" /> {t('campaign.videoCount', { count: getCampaignDeliverableCount(selectedCampaign) })}</span></div><div className="mt-4 space-y-3">{selectedCampaign.deliverables.map((deliverable) => (
                <article key={deliverable.id} className="eg-card flex flex-col gap-4 p-4 lg:flex-row lg:items-center">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/[.055] text-cyan-100"><Film className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1"><h4 className="truncate text-sm font-semibold text-white">{deliverable.title}</h4><p className="mt-1 text-[10px] text-zinc-600">{platformLabels[deliverable.platform]} · {deliverable.aspectRatio} · {deliverable.duration}s · {t('campaign.versionCount', { count: deliverable.quantity })}</p></div>
                  <select value={deliverable.status} onChange={(event) => void changeDeliverableStatus(selectedCampaign, deliverable.id, event.target.value as DeliverableStatus)} className="eg-input min-w-40 px-3 text-xs">{(Object.keys(deliverableStatusLabels) as DeliverableStatus[]).map((status) => <option key={status} value={status}>{deliverableStatusLabels[status]}</option>)}</select>
                  <button type="button" onClick={() => void openDeliverableProject(selectedCampaign, deliverable, 'content')} disabled={openingDeliverableId !== null} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><Compass className="h-4 w-4" /> {t('campaign.writeContent')}</button>
                  <button type="button" onClick={() => void openDeliverableProject(selectedCampaign, deliverable, 'review')} disabled={openingDeliverableId !== null} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><MessageSquareText className="h-4 w-4" /> {t('campaign.sendReview')}</button>
                  <button type="button" onClick={() => void openDeliverableProject(selectedCampaign, deliverable, 'production')} disabled={openingDeliverableId !== null} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-semibold disabled:opacity-50"><ListChecks className="h-4 w-4" /> {t('campaign.teamBoard')}</button>
                  <button type="button" onClick={() => void openDeliverableProject(selectedCampaign, deliverable)} disabled={openingDeliverableId !== null} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold disabled:opacity-50">{openingDeliverableId === deliverable.id ? <Loader2 className="h-4 w-4 animate-spin" /> : deliverable.projectId ? <ExternalLink className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {deliverable.projectId ? t('campaign.openProject') : t('campaign.createProject')}</button>
                </article>
              ))}</div></section>
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-3 border-t eg-divider bg-black/15 p-4 md:px-7"><button type="button" onClick={() => removeCampaign(selectedCampaign)} className="inline-flex min-h-11 items-center justify-center gap-2 px-3 text-xs font-semibold text-zinc-600 hover:text-rose-200"><Trash2 className="h-4 w-4" /> {t('campaign.deleteCampaign')}</button><div className="flex flex-wrap gap-2"><button type="button" onClick={() => { setSelectedCampaignId(null); setBrandKitClientId(selectedCampaign.clientId); }} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-semibold"><Palette className="h-4 w-4" /> Brand Kit</button><button type="button" onClick={() => openEditCampaign(selectedCampaign)} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-xs font-semibold"><Pencil className="h-4 w-4" /> {t('campaign.editBrief')}</button></div></footer>
          </div>
        </div>
      )}

      {showPreProduction && selectedCampaign && selectedClient && (
        <CampaignPreProduction
          isOpen={showPreProduction}
          campaign={selectedCampaign}
          client={selectedClient}
          launchingDeliverableId={openingDeliverableId}
          onClose={() => setShowPreProduction(false)}
          onLaunch={(deliverable) => void launchPreProduction(selectedCampaign, selectedClient, deliverable)}
        />
      )}

      {showClientDirectory && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/75 p-3 backdrop-blur-xl" onClick={() => setShowClientDirectory(false)}>
          <div className="eg-panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden" role="dialog" aria-modal="true" aria-labelledby="client-directory-title" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b eg-divider p-5 md:p-6"><div><div className="eg-kicker">{t('campaign.directoryKicker')}</div><h2 id="client-directory-title" className="mt-1 text-xl font-semibold text-white">{t('campaign.directoryTitle')}</h2><p className="mt-1 text-xs text-zinc-500">{t('campaign.directoryCount', { count: clients.length })}</p></div><div className="flex gap-2"><button type="button" onClick={openClientForm} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold"><Plus className="h-4 w-4" /> {t('campaign.addClientShort')}</button><button type="button" onClick={() => setShowClientDirectory(false)} className="eg-icon-button flex h-11 w-11 items-center justify-center" aria-label={t('campaign.closeDirectory')}><X className="h-4 w-4" /></button></div></header>
            <div className="eg-safe-scroll flex-1 overflow-y-auto p-5 md:p-6"><div className="grid gap-4 md:grid-cols-2">{clients.map((client) => {
              const clientCampaigns = campaigns.filter((campaign) => campaign.clientId === client.id);
              const brandReadiness = getBrandKitReadiness(client.brandKit);
              return <article key={client.id} className="eg-card p-5">
                <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 text-cyan-100"><BriefcaseBusiness className="h-4 w-4" /></span><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold text-white">{client.brandName}</h3><p className="mt-1 text-[10px] text-zinc-600">{client.name} · {client.industry}</p></div><button type="button" onClick={() => removeClient(client)} className="eg-icon-button flex h-11 w-11 shrink-0 items-center justify-center text-zinc-700 hover:text-rose-200" aria-label={t('campaign.deleteClient', { name: client.name })}><Trash2 className="h-4 w-4" /></button></div>
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[.06] pt-4"><div><span className="text-[9px] text-zinc-700">{t('campaign.campaignsLabel')}</span><strong className="mt-1 block font-mono text-sm text-zinc-300">{clientCampaigns.length}</strong></div><div><span className="text-[9px] text-zinc-700">{t('campaign.activeShort')}</span><strong className="mt-1 block font-mono text-sm text-zinc-300">{clientCampaigns.filter((campaign) => !['delivered', 'paused'].includes(campaign.status)).length}</strong></div><div><span className="text-[9px] text-zinc-700">Brand Kit</span><strong className={`mt-1 block font-mono text-sm ${brandReadiness.score >= 80 ? 'text-emerald-200' : 'text-amber-200'}`}>{brandReadiness.score}%</strong></div></div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[var(--eg-accent)]" style={{ width: `${brandReadiness.score}%` }} /></div>
                {(client.contactName || client.contactEmail) && <div className="mt-4 space-y-2 text-[10px] text-zinc-500">{client.contactName && <p className="flex items-center gap-2"><UserRound className="h-3 w-3" />{client.contactName}</p>}{client.contactEmail && <p className="flex items-center gap-2"><Mail className="h-3 w-3" />{client.contactEmail}</p>}</div>}
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/[.06] pt-3"><button type="button" onClick={() => { setShowClientDirectory(false); setBrandKitClientId(client.id); }} className="eg-button-secondary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-[10px] font-semibold"><Palette className="h-3.5 w-3.5" /> Brand Kit</button><button type="button" onClick={() => { setShowClientDirectory(false); openNewCampaign(client.id); }} className="eg-button-primary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-[10px] font-bold"><Plus className="h-3.5 w-3.5" /> {t('campaign.campaignsLabel')}</button></div>
              </article>;
            })}{clients.length === 0 && <div className="col-span-full flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08] text-center"><UsersRound className="h-8 w-8 text-zinc-700" /><h3 className="mt-4 text-sm font-semibold text-zinc-300">{t('campaign.noClients')}</h3><button type="button" onClick={openClientForm} className="eg-button-primary mt-5 inline-flex min-h-11 items-center justify-center gap-2 px-4 text-xs font-bold"><Plus className="h-4 w-4" /> {t('campaign.addClient')}</button></div>}</div></div>
          </div>
        </div>
      )}

      {brandKitClient && (
        <BrandKitEditor
          client={brandKitClient}
          onSave={saveClientBrandKit}
          onClose={() => setBrandKitClientId(null)}
        />
      )}
    </main>
  );
};

export default CampaignHub;
