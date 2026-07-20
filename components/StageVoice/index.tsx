import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FileAudio,
  Headphones,
  Loader2,
  Mic2,
  Radio,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  WandSparkles,
} from 'lucide-react';
import {
  Character,
  ProjectState,
  Shot,
  VoiceProfile,
  VoiceProviderId,
  VoiceStudioState,
  VoiceTake,
} from '../../types';
import { createDefaultVoiceStudioState } from '../../services/storageService';
import {
  VOICE_PROVIDERS,
  getVoiceProvider,
  isVoiceProviderConfigured,
} from '../../services/voiceRegistry';
import { audioFileToDataUrl, generateVoice } from '../../services/voiceService';
import { useAlert } from '../GlobalAlert';
import VoicePlayer from './VoicePlayer';
import VoiceSettingsModal from './VoiceSettingsModal';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
}

type LineFilter = 'all' | 'pending' | 'ready' | 'human';

const REGION_LABELS = {
  north: 'Miền Bắc',
  central: 'Miền Trung',
  south: 'Miền Nam',
  international: 'Quốc tế',
};

const getDefaultProfile = (
  characterId: string,
  providerId: VoiceProviderId = 'fpt',
): VoiceProfile => {
  const provider = getVoiceProvider(providerId);
  const voice = provider.voices[0];
  return {
    id: `voice_profile_${characterId}`,
    characterId,
    providerId,
    voiceId: voice?.id || '',
    voiceName: voice?.name || 'Chưa chọn giọng',
    region: voice?.region || 'international',
    speed: 1,
    style: 'Tự nhiên',
  };
};

const formatDuration = (seconds?: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
};

const StageVoice: React.FC<Props> = ({ project, updateProject }) => {
  const { showAlert } = useAlert();
  const studio = project.voiceStudio || createDefaultVoiceStudioState();
  const characters = useMemo<Character[]>(() => {
    if (project.scriptData?.characters?.length) return project.scriptData.characters;
    return [{
      id: 'narrator',
      name: 'Người dẫn chuyện',
      gender: 'Không xác định',
      age: 'Trưởng thành',
      personality: 'Điềm tĩnh',
      variations: [],
    }];
  }, [project.scriptData?.characters]);
  const dialogueShots = useMemo(
    () => project.shots.filter((shot) => Boolean(shot.dialogue?.trim())),
    [project.shots],
  );

  const [selectedCharacterId, setSelectedCharacterId] = useState(characters[0]?.id || 'narrator');
  const [lineFilter, setLineFilter] = useState<LineFilter>('all');
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProvider, setSettingsProvider] = useState<VoiceProviderId>(studio.defaultProviderId || 'fpt');
  const [batchRendering, setBatchRendering] = useState(false);

  const updateStudio = (mutator: (current: VoiceStudioState) => VoiceStudioState) => {
    updateProject((previous) => ({
      ...previous,
      voiceStudio: mutator(previous.voiceStudio || createDefaultVoiceStudioState()),
    }));
  };

  const getCharacter = (id?: string) => characters.find((character) => character.id === id) || characters[0];
  const getSpeakerId = (shot: Shot) => shot.characters.find((id) => characters.some((character) => character.id === id)) || characters[0]?.id || 'narrator';
  const getProfile = (characterId: string) =>
    studio.profiles.find((profile) => profile.characterId === characterId) ||
    getDefaultProfile(characterId, studio.defaultProviderId || 'fpt');

  const saveProfile = (profile: VoiceProfile) => {
    updateStudio((current) => {
      const exists = current.profiles.some((item) => item.characterId === profile.characterId);
      return {
        ...current,
        profiles: exists
          ? current.profiles.map((item) => item.characterId === profile.characterId ? profile : item)
          : [...current.profiles, profile],
      };
    });
  };

  const getTakes = (shotId: string) => studio.takes.filter((take) => take.shotId === shotId).sort((a, b) => b.createdAt - a.createdAt);
  const getSelectedTake = (shotId: string) => {
    const takes = getTakes(shotId);
    const selectedId = studio.selectedTakeByShot[shotId];
    return takes.find((take) => take.id === selectedId) || takes.find((take) => take.status === 'ready') || takes[0];
  };

  const patchTake = (takeId: string, updates: Partial<VoiceTake>) => {
    updateStudio((current) => ({
      ...current,
      takes: current.takes.map((take) => take.id === takeId ? { ...take, ...updates } : take),
      selectedTakeByShot: updates.status === 'ready'
        ? { ...current.selectedTakeByShot, [current.takes.find((take) => take.id === takeId)?.shotId || '']: takeId }
        : current.selectedTakeByShot,
    }));
  };

  const openSettings = (providerId: VoiceProviderId) => {
    setSettingsProvider(providerId);
    setSettingsOpen(true);
  };

  const handleGenerate = async (shot: Shot) => {
    const characterId = getSpeakerId(shot);
    const profile = getProfile(characterId);
    const provider = getVoiceProvider(profile.providerId);

    if (!provider.supportsGeneration) {
      if (profile.providerId === 'human') {
        showAlert('Hồ sơ này dùng diễn viên thật. Hãy tải bản thu lên bằng nút “Nhập bản thu”.', { type: 'info' });
      } else {
        showAlert('Vbee cần máy chủ callback công khai. Hiện hãy tạo âm thanh ở Vbee rồi nhập bản thu vào dự án.', { type: 'warning' });
      }
      return;
    }
    if (!isVoiceProviderConfigured(profile.providerId)) {
      openSettings(profile.providerId);
      return;
    }
    if (!profile.voiceId.trim()) {
      showAlert('Hãy chọn giọng hoặc nhập Voice ID cho nhân vật trước khi tạo.', { type: 'warning' });
      setSelectedCharacterId(characterId);
      return;
    }

    const takeId = `voice_take_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const take: VoiceTake = {
      id: takeId,
      shotId: shot.id,
      characterId,
      text: shot.dialogue!.trim(),
      source: 'synthetic',
      providerId: profile.providerId,
      voiceId: profile.voiceId,
      voiceName: profile.voiceName,
      status: 'generating',
      createdAt: Date.now(),
    };
    updateStudio((current) => ({ ...current, takes: [take, ...current.takes] }));

    try {
      const result = await generateVoice({
        providerId: profile.providerId,
        text: take.text,
        voiceId: profile.voiceId,
        speed: profile.speed,
        outputFormat: studio.outputFormat,
      });
      patchTake(takeId, {
        status: 'ready',
        audioUrl: result.audioUrl,
        duration: result.duration,
        fileName: result.fileName,
        error: undefined,
      });
    } catch (error) {
      patchTake(takeId, { status: 'error', error: error instanceof Error ? error.message : 'Không thể tạo bản thoại' });
    }
  };

  const handleUpload = async (shot: Shot, file?: File) => {
    if (!file) return;
    try {
      const result = await audioFileToDataUrl(file);
      const characterId = getSpeakerId(shot);
      const take: VoiceTake = {
        id: `voice_take_human_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        shotId: shot.id,
        characterId,
        text: shot.dialogue!.trim(),
        source: 'human',
        providerId: 'human',
        voiceName: getCharacter(characterId)?.name || 'Diễn viên',
        status: 'ready',
        audioUrl: result.audioUrl,
        duration: result.duration,
        fileName: file.name,
        createdAt: Date.now(),
      };
      updateStudio((current) => ({
        ...current,
        takes: [take, ...current.takes],
        selectedTakeByShot: { ...current.selectedTakeByShot, [shot.id]: take.id },
      }));
    } catch (error) {
      showAlert(error instanceof Error ? error.message : 'Không thể nhập bản thu', { type: 'error' });
    }
  };

  const deleteTake = (take: VoiceTake) => {
    updateStudio((current) => {
      const remaining = current.takes.filter((item) => item.id !== take.id);
      const selected = { ...current.selectedTakeByShot };
      if (selected[take.shotId] === take.id) {
        const fallback = remaining.find((item) => item.shotId === take.shotId && item.status === 'ready');
        if (fallback) selected[take.shotId] = fallback.id;
        else delete selected[take.shotId];
      }
      return { ...current, takes: remaining, selectedTakeByShot: selected };
    });
  };

  const selectTake = (take: VoiceTake) => {
    if (take.status !== 'ready') return;
    updateStudio((current) => ({
      ...current,
      selectedTakeByShot: { ...current.selectedTakeByShot, [take.shotId]: take.id },
    }));
  };

  const changeSpeaker = (shotId: string, characterId: string) => {
    updateProject((previous) => ({
      ...previous,
      shots: previous.shots.map((shot) => shot.id === shotId
        ? { ...shot, characters: [characterId, ...shot.characters.filter((id) => id !== characterId)] }
        : shot),
    }));
  };

  const renderAll = () => {
    const pending = dialogueShots.filter((shot) => !getSelectedTake(shot.id)?.audioUrl);
    if (!pending.length) {
      showAlert('Tất cả câu thoại đã có bản được chọn.', { type: 'success' });
      return;
    }
    showAlert(`Tạo ${pending.length} câu thoại còn thiếu? Mỗi câu sẽ sử dụng hạn mức của nhà cung cấp tương ứng.`, {
      type: 'warning',
      showCancel: true,
      onConfirm: async () => {
        setBatchRendering(true);
        for (const shot of pending) await handleGenerate(shot);
        setBatchRendering(false);
      },
    });
  };

  const selectedCharacter = getCharacter(selectedCharacterId) || characters[0];
  const selectedProfile = getProfile(selectedCharacter?.id || 'narrator');
  const selectedProvider = getVoiceProvider(selectedProfile.providerId);
  const totalReady = dialogueShots.filter((shot) => getSelectedTake(shot.id)?.status === 'ready').length;
  const humanReady = dialogueShots.filter((shot) => getSelectedTake(shot.id)?.source === 'human').length;
  const totalDuration = dialogueShots.reduce((sum, shot) => sum + (getSelectedTake(shot.id)?.duration || 0), 0);

  const filteredShots = dialogueShots.filter((shot) => {
    const take = getSelectedTake(shot.id);
    if (lineFilter === 'pending' && take?.status === 'ready') return false;
    if (lineFilter === 'ready' && take?.status !== 'ready') return false;
    if (lineFilter === 'human' && take?.source !== 'human') return false;
    if (query.trim()) {
      const speaker = getCharacter(getSpeakerId(shot))?.name || '';
      const haystack = `${speaker} ${shot.dialogue} ${shot.actionSummary}`.toLowerCase();
      if (!haystack.includes(query.trim().toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--eg-canvas)] text-[var(--eg-text)]">
      <header className="flex flex-col gap-4 border-b eg-divider bg-[rgba(7,9,12,.88)] px-6 py-5 backdrop-blur-xl xl:flex-row xl:items-center xl:justify-between xl:px-8">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/20 bg-cyan-200/10 text-cyan-100">
            <Headphones className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="eg-kicker">Giai đoạn 03 · Voice Studio</div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-white md:text-2xl">Casting và dựng giọng thoại</h1>
            <p className="mt-1 text-xs text-zinc-500">Tạo bản nháp bằng AI hoặc duyệt bản thu thật theo từng câu thoại.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => openSettings(studio.defaultProviderId)} className="eg-button-secondary inline-flex items-center justify-center gap-2 px-4 text-xs font-semibold">
            <Settings2 className="h-4 w-4" /> Kết nối giọng nói
          </button>
          <button type="button" onClick={renderAll} disabled={batchRendering || !dialogueShots.length} className="eg-button-primary inline-flex items-center justify-center gap-2 px-5 text-xs font-bold">
            {batchRendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
            {batchRendering ? 'Đang tạo hàng loạt…' : 'Tạo các câu còn thiếu'}
          </button>
        </div>
      </header>

      <div className="eg-safe-scroll flex-1 overflow-y-auto p-4 md:p-6 xl:p-8">
        <div className="mx-auto max-w-[1580px] space-y-6">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Câu thoại', value: dialogueShots.length, icon: FileAudio, tone: 'text-cyan-200' },
              { label: 'Đã duyệt', value: `${totalReady}/${dialogueShots.length}`, icon: CheckCircle2, tone: 'text-emerald-200' },
              { label: 'Bản người thật', value: humanReady, icon: UsersRound, tone: 'text-amber-200' },
              { label: 'Thời lượng thoại', value: formatDuration(totalDuration), icon: Radio, tone: 'text-violet-200' },
            ].map((stat) => (
              <div key={stat.label} className="eg-card flex min-h-24 items-center gap-3 p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.08] bg-black/20 ${stat.tone}`}>
                  <stat.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-mono text-xl font-semibold tabular-nums text-white">{stat.value}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">{stat.label}</div>
                </div>
              </div>
            ))}
          </section>

          <div className="grid min-w-0 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <section className="eg-panel overflow-hidden">
                <div className="border-b eg-divider px-5 py-4">
                  <div className="eg-kicker">Casting</div>
                  <h2 className="mt-1 text-base font-semibold text-white">Hồ sơ giọng nhân vật</h2>
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto p-2">
                  {characters.map((character) => {
                    const profile = getProfile(character.id);
                    const active = selectedCharacter?.id === character.id;
                    const provider = getVoiceProvider(profile.providerId);
                    return (
                      <button key={character.id} type="button" onClick={() => setSelectedCharacterId(character.id)} className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors ${active ? 'border-cyan-200/25 bg-cyan-200/[.08]' : 'border-transparent hover:border-white/[.08] hover:bg-white/[.035]'}`}>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/30">
                          {character.referenceImage ? <img src={character.referenceImage} alt="" className="h-full w-full object-cover" /> : <UserRound className="h-4 w-4 text-zinc-500" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-white">{character.name}</div>
                          <div className="mt-1 truncate text-[10px] text-zinc-600">{provider.shortName} · {profile.voiceName}</div>
                        </div>
                        <ChevronRight className={`h-4 w-4 ${active ? 'text-cyan-200' : 'text-zinc-700'}`} />
                      </button>
                    );
                  })}
                </div>

                {selectedCharacter && (
                  <div className="space-y-4 border-t eg-divider bg-black/10 p-5">
                    <div>
                      <label htmlFor="voice-provider" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Nguồn giọng</label>
                      <select
                        id="voice-provider"
                        value={selectedProfile.providerId}
                        onChange={(event) => {
                          const providerId = event.target.value as VoiceProviderId;
                          const provider = getVoiceProvider(providerId);
                          const voice = provider.voices[0];
                          const next = {
                            ...selectedProfile,
                            providerId,
                            voiceId: voice?.id || '',
                            voiceName: voice?.name || (providerId === 'human' ? 'Diễn viên thật' : 'Nhập Voice ID'),
                            region: voice?.region || 'international',
                          };
                          saveProfile(next);
                          updateStudio((current) => ({ ...current, defaultProviderId: providerId }));
                        }}
                        className="eg-input px-3 text-xs"
                      >
                        {VOICE_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                      </select>
                    </div>

                    {selectedProvider.voices.length > 0 ? (
                      <div>
                        <label htmlFor="voice-option" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Chất giọng</label>
                        <select
                          id="voice-option"
                          value={selectedProfile.voiceId}
                          onChange={(event) => {
                            const voice = selectedProvider.voices.find((item) => item.id === event.target.value)!;
                            saveProfile({ ...selectedProfile, voiceId: voice.id, voiceName: voice.name, region: voice.region });
                          }}
                          className="eg-input px-3 text-xs"
                        >
                          {selectedProvider.voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {REGION_LABELS[voice.region]}</option>)}
                        </select>
                        <p className="mt-2 text-[10px] leading-4 text-zinc-600">{selectedProvider.voices.find((voice) => voice.id === selectedProfile.voiceId)?.description}</p>
                      </div>
                    ) : selectedProfile.providerId !== 'human' ? (
                      <div>
                        <label htmlFor="voice-id" className="mb-2 block text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Voice ID</label>
                        <input id="voice-id" value={selectedProfile.voiceId} onChange={(event) => saveProfile({ ...selectedProfile, voiceId: event.target.value, voiceName: event.target.value || 'Nhập Voice ID' })} className="eg-input px-3 font-mono text-xs" placeholder="Dán mã giọng từ nhà cung cấp" />
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-200/15 bg-amber-200/[.05] p-3 text-[11px] leading-5 text-amber-100/70">
                        Chế độ người thật không tổng hợp giọng. Nhập từng take ở danh sách câu thoại và chọn bản tốt nhất.
                      </div>
                    )}

                    {selectedProfile.providerId !== 'human' && (
                      <div>
                        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                          <label htmlFor="voice-speed">Tốc độ đọc</label><span className="font-mono text-zinc-300">{selectedProfile.speed.toFixed(2)}×</span>
                        </div>
                        <input id="voice-speed" type="range" min="0.8" max="1.2" step="0.05" value={selectedProfile.speed} onChange={(event) => saveProfile({ ...selectedProfile, speed: Number(event.target.value) })} className="w-full accent-cyan-200" />
                      </div>
                    )}

                    {selectedProfile.providerId !== 'human' && !isVoiceProviderConfigured(selectedProfile.providerId) && (
                      <button type="button" onClick={() => openSettings(selectedProfile.providerId)} className="eg-button-secondary flex w-full items-center justify-center gap-2 px-3 text-xs font-semibold text-amber-100">
                        <AlertCircle className="h-4 w-4" /> Cấu hình {selectedProvider.shortName}
                      </button>
                    )}
                  </div>
                )}
              </section>
            </aside>

            <main className="min-w-0 space-y-4">
              <section className="eg-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative min-w-0 flex-1 lg:max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-zinc-600" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} className="eg-input pl-10 pr-4 text-xs" placeholder="Tìm lời thoại hoặc nhân vật…" aria-label="Tìm câu thoại" />
                </div>
                <div className="flex flex-wrap gap-2" aria-label="Lọc câu thoại">
                  {([
                    ['all', 'Tất cả'],
                    ['pending', 'Chưa có giọng'],
                    ['ready', 'Đã duyệt'],
                    ['human', 'Người thật'],
                  ] as [LineFilter, string][]).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setLineFilter(id)} className={`min-h-11 rounded-xl border px-3 text-[11px] font-semibold transition-colors ${lineFilter === id ? 'border-cyan-200/30 bg-cyan-200/10 text-cyan-100' : 'border-white/[.08] bg-white/[.025] text-zinc-500 hover:text-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              {!dialogueShots.length ? (
                <section className="eg-panel flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[.08] bg-white/[.035] text-zinc-500"><Mic2 className="h-6 w-6" /></div>
                  <h2 className="mt-5 text-lg font-semibold text-white">Chưa có câu thoại để dựng</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">Hoàn tất phân tích kịch bản và thêm lời thoại cho các cảnh quay. Voice Studio sẽ tự động gom chúng thành danh sách casting.</p>
                </section>
              ) : filteredShots.length === 0 ? (
                <section className="eg-panel flex min-h-60 flex-col items-center justify-center p-8 text-center">
                  <CircleDashed className="h-6 w-6 text-zinc-600" />
                  <p className="mt-3 text-sm text-zinc-500">Không có câu thoại phù hợp với bộ lọc.</p>
                </section>
              ) : (
                filteredShots.map((shot, index) => {
                  const speakerId = getSpeakerId(shot);
                  const speaker = getCharacter(speakerId);
                  const profile = getProfile(speakerId);
                  const provider = getVoiceProvider(profile.providerId);
                  const takes = getTakes(shot.id);
                  const selectedTake = getSelectedTake(shot.id);
                  const scene = project.scriptData?.scenes.find((item) => item.id === shot.sceneId);
                  const isGenerating = takes.some((take) => take.status === 'generating');
                  return (
                    <article key={shot.id} className="eg-panel overflow-hidden">
                      <div className="flex flex-col gap-4 border-b eg-divider px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="font-mono text-[10px] text-zinc-600">{String(index + 1).padStart(2, '0')}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={speakerId} onChange={(event) => changeSpeaker(shot.id, event.target.value)} className="h-9 rounded-lg border border-white/[.08] bg-white/[.035] px-2 text-xs font-semibold text-white outline-none focus:border-cyan-200/40" aria-label="Chọn nhân vật nói">
                                {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
                              </select>
                              <span className="eg-chip">{provider.shortName} · {profile.voiceName}</span>
                              {selectedTake?.source === 'human' && <span className="eg-chip border-amber-200/20 bg-amber-200/[.07] text-amber-100"><UsersRound className="h-3 w-3" /> Người thật</span>}
                              {selectedTake?.status === 'ready' && <span className="eg-chip border-emerald-200/20 bg-emerald-200/[.07] text-emerald-100"><Check className="h-3 w-3" /> Đã chọn</span>}
                            </div>
                            <p className="mt-1 truncate text-[10px] text-zinc-600">{scene?.location || shot.actionSummary || 'Cảnh chưa đặt tên'}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <label className="eg-button-secondary inline-flex cursor-pointer items-center justify-center gap-2 px-3 text-xs font-semibold">
                            <Upload className="h-4 w-4" /> Nhập bản thu
                            <input type="file" accept="audio/*" className="sr-only" onChange={(event) => { void handleUpload(shot, event.target.files?.[0]); event.currentTarget.value = ''; }} />
                          </label>
                          <button type="button" onClick={() => void handleGenerate(shot)} disabled={isGenerating || batchRendering} className="eg-button-primary inline-flex items-center justify-center gap-2 px-4 text-xs font-bold">
                            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                            {isGenerating ? 'Đang tạo…' : 'Tạo bản AI'}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.82fr)]">
                        <div className="min-w-0">
                          <div className="eg-kicker mb-2">Lời thoại</div>
                          <blockquote className="text-[15px] font-medium leading-7 text-zinc-100">“{shot.dialogue}”</blockquote>
                          {shot.actionSummary && <p className="mt-3 text-[11px] leading-5 text-zinc-600">Chỉ dẫn diễn xuất: {shot.actionSummary}</p>}
                        </div>

                        <div className="min-w-0">
                          {selectedTake?.status === 'ready' && selectedTake.audioUrl ? (
                            <VoicePlayer src={selectedTake.audioUrl} fileName={selectedTake.fileName} duration={selectedTake.duration} />
                          ) : selectedTake?.status === 'error' ? (
                            <div className="rounded-xl border border-rose-300/15 bg-rose-300/[.05] p-4 text-xs leading-5 text-rose-200">
                              <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{selectedTake.error || 'Không thể tạo bản thoại. Hãy kiểm tra khóa và hạn mức.'}</span></div>
                            </div>
                          ) : isGenerating ? (
                            <div className="flex min-h-20 items-center justify-center gap-3 rounded-xl border border-dashed border-cyan-200/15 bg-cyan-200/[.035] text-xs text-cyan-100/70"><Loader2 className="h-4 w-4 animate-spin" /> Đang dựng âm sắc và ngữ điệu…</div>
                          ) : (
                            <div className="flex min-h-20 items-center justify-center gap-2 rounded-xl border border-dashed border-white/[.08] bg-black/15 text-xs text-zinc-600"><FileAudio className="h-4 w-4" /> Chưa có bản thoại</div>
                          )}

                          {takes.length > 0 && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="mr-1 text-[10px] uppercase tracking-widest text-zinc-700">Các take</span>
                              {takes.slice(0, 5).map((take, takeIndex) => {
                                const active = selectedTake?.id === take.id;
                                return (
                                  <div key={take.id} className="flex items-center">
                                    <button type="button" onClick={() => selectTake(take)} disabled={take.status !== 'ready'} className={`min-h-9 rounded-l-lg border px-2.5 font-mono text-[10px] ${active ? 'border-cyan-200/30 bg-cyan-200/10 text-cyan-100' : take.status === 'error' ? 'border-rose-300/15 bg-rose-300/[.04] text-rose-300' : 'border-white/[.08] bg-white/[.025] text-zinc-500 hover:text-white disabled:cursor-not-allowed'}`} title={take.source === 'human' ? 'Bản người thật' : take.voiceName}>
                                      {take.source === 'human' ? 'H' : 'AI'} · {takes.length - takeIndex}
                                    </button>
                                    <button type="button" onClick={() => deleteTake(take)} className="flex min-h-9 w-9 items-center justify-center rounded-r-lg border border-l-0 border-white/[.08] bg-white/[.025] text-zinc-700 hover:text-rose-300" aria-label="Xóa take"><Trash2 className="h-3 w-3" /></button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </main>
          </div>
        </div>
      </div>

      <VoiceSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} initialProviderId={settingsProvider} />
    </div>
  );
};

export default StageVoice;
