import {
  AspectRatio,
  Character,
  CharacterReference,
  ConsistencyReference,
  GenerationLock,
  ProjectState,
  ReferenceAngle,
  Shot,
  ShotReferencePack,
} from '../types';

/**
 * Bộ máy nhất quán nhân vật và sản phẩm.
 *
 * Nhân vật lệch nhận diện giữa các shot là nguyên nhân hàng đầu phải sinh lại,
 * và sinh lại là tiền thật. Lớp này tấn công ba nguyên nhân gốc:
 *
 * 1. **Một ảnh tham chiếu không đủ.** Ảnh chính diện không giúp model giữ được
 *    khuôn mặt ở cảnh nghiêng hay cảnh lưng.
 * 2. **Đổi model hoặc seed giữa chừng.** Cùng prompt, khác model, ra khác người.
 * 3. **Sửa nhân vật mà không biết shot nào bị ảnh hưởng.** Hiện
 *    `getShotMediaSignature` chỉ tính keyframe và video, không tính ảnh tham
 *    chiếu, nên đổi ảnh định trang thì shot không bị đánh dấu lỗi thời.
 */

/* ─────────────────────────  Bộ ảnh tham chiếu  ───────────────────────── */

/**
 * Số ảnh tham chiếu tối đa gửi kèm một lần sinh.
 *
 * Nhiều hơn không tốt hơn: model bắt đầu trộn đặc điểm giữa các ảnh và cho ra
 * một người thứ ba không giống ảnh nào.
 */
export const MAX_REFERENCES_PER_CALL = 3;

/** Góc ưu tiên theo cỡ cảnh. Cảnh càng cận thì càng cần góc thấy rõ mặt. */
const ANGLE_PRIORITY: Record<string, ReferenceAngle[]> = {
  'close-up': ['front', 'three-quarter', 'profile', 'unknown', 'back'],
  'medium': ['three-quarter', 'front', 'profile', 'unknown', 'back'],
  'wide': ['three-quarter', 'front', 'unknown', 'profile', 'back'],
};

const normalizeShotSize = (shotSize?: string): keyof typeof ANGLE_PRIORITY => {
  const value = (shotSize ?? '').toLowerCase();
  if (/close|cận/.test(value)) return 'close-up';
  if (/wide|toàn|viễn/.test(value)) return 'wide';
  return 'medium';
};

/**
 * Gộp ảnh tham chiếu cũ và mới thành một bộ.
 *
 * `referenceImage` sẵn có luôn được giữ và coi là ảnh chính diện đã duyệt —
 * dự án cũ không có `referencePack` vẫn phải dùng được ngay.
 */
export const collectReferences = (character: Character): CharacterReference[] => {
  const pack = character.referencePack ?? [];
  if (!character.referenceImage) return pack;
  if (pack.some((item) => item.imageUrl === character.referenceImage)) return pack;

  return [
    {
      id: `${character.id}-base`,
      imageUrl: character.referenceImage,
      angle: 'front',
      approved: true,
      addedAt: 0,
    },
    ...pack,
  ];
};

/**
 * Chọn ảnh tham chiếu hợp nhất cho một shot.
 *
 * Ưu tiên ảnh đã đi qua shot được duyệt, rồi tới góc hợp với cỡ cảnh. Ảnh đã
 * duyệt đáng tin hơn hẳn ảnh mới sinh vì nó đã qua mắt người.
 */
export const pickReferences = (
  character: Character,
  shot?: Pick<Shot, 'shotSize'>,
  limit = MAX_REFERENCES_PER_CALL,
): CharacterReference[] => {
  const all = collectReferences(character);
  if (!all.length) return [];

  const order = ANGLE_PRIORITY[normalizeShotSize(shot?.shotSize)];

  return [...all]
    .sort((left, right) => {
      if (left.approved !== right.approved) return left.approved ? -1 : 1;
      const a = order.indexOf(left.angle);
      const b = order.indexOf(right.angle);
      if (a !== b) return a - b;
      // Ảnh mới hơn thường phản ánh phiên bản nhân vật hiện tại.
      return right.addedAt - left.addedAt;
    })
    .slice(0, Math.max(1, limit));
};

/** Thêm ảnh vào bộ, khử trùng lặp theo URL. */
export const addReference = (
  character: Character,
  reference: Omit<CharacterReference, 'id'> & { id?: string },
): Character => {
  const pack = character.referencePack ?? [];
  if (pack.some((item) => item.imageUrl === reference.imageUrl)) return character;

  return {
    ...character,
    referencePack: [
      ...pack,
      {
        ...reference,
        id: reference.id ?? `${character.id}-ref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      },
    ],
  };
};

/** Đánh dấu một ảnh là đã duyệt sau khi shot dùng nó được thông qua. */
export const approveReference = (character: Character, referenceId: string): Character => ({
  ...character,
  referencePack: (character.referencePack ?? []).map((item) =>
    item.id === referenceId ? { ...item, approved: true } : item,
  ),
});

/** Xoá một ảnh phụ khỏi bộ tham chiếu. Ảnh gốc `referenceImage` không nằm trong mảng này. */
export const removeReference = (character: Character, referenceId: string): Character => ({
  ...character,
  referencePack: (character.referencePack ?? []).filter((item) => item.id !== referenceId),
});

/**
 * Dựng danh sách ảnh thực sự gửi vào lượt sinh keyframe.
 *
 * Bối cảnh đứng đầu như contract cũ. Với mỗi nhân vật, biến thể trang phục
 * đứng trước bộ ảnh nhiều góc; `pickReferences` tự chọn góc hợp với cỡ cảnh.
 * Danh sách cuối vẫn bị chặn ở `MAX_REFERENCES_PER_CALL` để tránh trộn mặt.
 */
export const buildShotReferenceImages = (
  shot: Shot,
  scriptData: ProjectState['scriptData'],
  additionalImages: string[] = [],
  limit = MAX_REFERENCES_PER_CALL,
): string[] => {
  if (!scriptData) return Array.from(new Set(additionalImages.filter(Boolean))).slice(0, limit);

  const urls: string[] = [];
  const push = (url?: string) => {
    if (url && !urls.includes(url)) urls.push(url);
  };

  const scene = scriptData.scenes.find((item) => String(item.id) === String(shot.sceneId));
  push(scene?.referenceImage);

  for (const characterId of shot.characters ?? []) {
    const character = scriptData.characters.find((item) => String(item.id) === String(characterId));
    if (!character) continue;

    const variationId = shot.characterVariations?.[characterId];
    const variation = variationId
      ? character.variations.find((item) => String(item.id) === String(variationId))
      : undefined;
    push(variation?.referenceImage);
    pickReferences(character, shot).forEach((reference) => push(reference.imageUrl));
  }

  additionalImages.forEach(push);
  return urls.slice(0, Math.max(1, limit));
};

const roleForBrandAsset = (type: 'logo' | 'product' | 'character' | 'reference'): ConsistencyReference['role'] => {
  if (type === 'reference') return 'brand';
  return type;
};

const referencePriority = (role: ConsistencyReference['role']): number => ({
  wardrobe: 120,
  character: 110,
  continuity: 105,
  product: 100,
  scene: 90,
  logo: 80,
  brand: 70,
})[role];

/**
 * Dựng Reference Pack có vai trò rõ ràng cho một shot.
 *
 * Khác contract URL[] cũ, hàm này biết ảnh nào là nhân vật, trang phục, sản
 * phẩm và bối cảnh. Khi provider chỉ nhận ít ảnh, bộ chọn luôn giữ neo nhận
 * dạng nhân vật trước, sau đó giữ sản phẩm đã khoá rồi mới dùng phần còn lại.
 * Mọi thực thể thiếu ảnh vẫn được đưa vào `promptContext`, nên text-to-image
 * và text-to-video không còn phụ thuộc bắt buộc vào ảnh reference.
 */
export const buildShotReferencePack = (
  project: ProjectState,
  shot: Shot,
  additionalImages: string[] = [],
  limit = MAX_REFERENCES_PER_CALL,
): ShotReferencePack => {
  const candidates: ConsistencyReference[] = [];
  const promptContext: string[] = [];
  const warnings: string[] = [];
  const scriptData = project.scriptData;
  const add = (item: ConsistencyReference) => {
    if (!item.imageUrl || candidates.some((candidate) => candidate.imageUrl === item.imageUrl)) return;
    candidates.push(item);
  };

  const shotCharacters = (shot.characters ?? [])
    .map((characterId) => scriptData?.characters.find((item) => String(item.id) === String(characterId)))
    .filter((character): character is Character => Boolean(character));

  for (const character of shotCharacters) {
    const variationId = shot.characterVariations?.[character.id];
    const variation = character.variations.find((item) => String(item.id) === String(variationId));
    const description = character.coreFeatures || character.visualPrompt || character.personality;
    promptContext.push(`Nhân vật ${character.name}: ${description || 'giữ nguyên nhận dạng và tạo hình đã mô tả trong kịch bản'}.`);

    if (variation) {
      promptContext.push(`Trang phục của ${character.name}: ${variation.visualPrompt || variation.name}.`);
      if (variation.referenceImage) {
        add({
          id: `wardrobe:${character.id}:${variation.id}`,
          imageUrl: variation.referenceImage,
          role: 'wardrobe',
          label: `${character.name} · ${variation.name}`,
          priority: referencePriority('wardrobe'),
          source: 'project',
          entityId: character.id,
          approved: true,
        });
      }
    }

    const selected = pickReferences(character, shot, 2);
    selected.forEach((reference, index) => add({
      id: `character:${character.id}:${reference.id}`,
      imageUrl: reference.imageUrl,
      role: 'character',
      label: `${character.name}${index ? ` · góc ${reference.angle}` : ''}`,
      priority: referencePriority('character') - index,
      source: 'project',
      entityId: character.id,
      approved: reference.approved,
    }));
    if (!selected.length) warnings.push(`${character.name} chưa có ảnh; hệ thống sẽ giữ nhân vật bằng mô tả prompt.`);
  }

  const scene = scriptData?.scenes.find((item) => String(item.id) === String(shot.sceneId));
  if (scene) {
    promptContext.push(`Bối cảnh ${scene.location}, ${scene.time}, không khí ${scene.atmosphere}${scene.visualPrompt ? `. Mô tả hình ảnh: ${scene.visualPrompt}` : ''}.`);
    if (scene.referenceImage) {
      add({
        id: `scene:${scene.id}`,
        imageUrl: scene.referenceImage,
        role: 'scene',
        label: scene.location,
        priority: referencePriority('scene'),
        source: 'project',
        entityId: scene.id,
        approved: true,
      });
    } else {
      warnings.push(`Bối cảnh ${scene.location} chưa có ảnh; hệ thống sẽ dựng từ mô tả bối cảnh.`);
    }
  }

  const brandAssets = project.brandKitSnapshot?.assets ?? [];
  const configuredLocks = project.consistency?.lockedBrandAssetIds;
  const effectiveBrandAssets = configuredLocks === undefined
    ? brandAssets.filter((asset) => ['product', 'logo', 'character', 'reference'].includes(asset.type))
    : brandAssets.filter((asset) => configuredLocks.includes(asset.id));

  effectiveBrandAssets.forEach((asset) => {
    const role = roleForBrandAsset(asset.type);
    promptContext.push(`${role === 'product' ? 'Sản phẩm bắt buộc' : 'Tài sản thương hiệu'} ${asset.name}${asset.notes ? `: ${asset.notes}` : ''}.`);
    add({
      id: `brand:${asset.id}`,
      imageUrl: asset.url,
      role,
      label: asset.name,
      priority: referencePriority(role),
      source: 'brand-kit',
      entityId: asset.id,
      approved: true,
      notes: asset.notes,
    });
  });

  const shotIndex = project.shots.findIndex((item) => String(item.id) === String(shot.id));
  const previousEndFrame = shotIndex > 0
    ? project.shots[shotIndex - 1].keyframes.find((frame) => frame.type === 'end' && frame.imageUrl)
    : undefined;
  if (previousEndFrame?.imageUrl) {
    promptContext.push('Khớp vị trí, ánh sáng và trạng thái hành động với khung cuối của shot liền trước.');
    add({
      id: `continuity:${project.shots[shotIndex - 1].id}`,
      imageUrl: previousEndFrame.imageUrl,
      role: 'continuity',
      label: 'Khung nối shot trước',
      priority: referencePriority('continuity'),
      source: 'project',
      entityId: project.shots[shotIndex - 1].id,
      approved: true,
    });
  }

  additionalImages.forEach((imageUrl, index) => add({
    id: `additional:${index}`,
    imageUrl,
    role: 'continuity',
    label: `Khung nối bổ sung ${index + 1}`,
    priority: referencePriority('continuity') - index,
    source: 'additional',
  }));

  const productCandidates = candidates.filter((item) => item.role === 'product');
  const selected: ConsistencyReference[] = [];
  const take = (item?: ConsistencyReference) => {
    if (item && selected.length < Math.max(1, limit) && !selected.some((candidate) => candidate.imageUrl === item.imageUrl)) selected.push(item);
  };
  // Một neo cho từng nhân vật; nếu có ảnh trang phục thì ảnh đó đã chứa cả mặt và quần áo.
  shotCharacters.forEach((character) => take(
    candidates.find((item) => item.entityId === character.id && item.role === 'wardrobe')
      || candidates.find((item) => item.entityId === character.id && item.role === 'character'),
  ));
  take(productCandidates[0]);
  take(candidates.find((item) => item.role === 'continuity' || item.source === 'additional'));
  take(candidates.find((item) => item.role === 'scene'));
  candidates.sort((left, right) => right.priority - left.priority).forEach(take);

  if (brandAssets.some((asset) => asset.type === 'product') && !effectiveBrandAssets.some((asset) => asset.type === 'product')) {
    warnings.push('Chưa khoá sản phẩm Brand Kit cho shot này.');
  }
  if (candidates.length > selected.length) {
    warnings.push(`${candidates.length - selected.length} ảnh phụ không gửi do giới hạn ${Math.max(1, limit)} ảnh của model; mô tả prompt vẫn được giữ.`);
  }

  return {
    items: selected,
    images: selected.map((item) => item.imageUrl),
    promptContext,
    warnings,
    coverage: {
      characters: shotCharacters.length,
      charactersWithImage: shotCharacters.filter((character) => selected.some((item) => item.entityId === character.id && (item.role === 'character' || item.role === 'wardrobe'))).length,
      scene: selected.some((item) => item.role === 'scene'),
      product: selected.some((item) => item.role === 'product'),
      brand: selected.some((item) => item.source === 'brand-kit'),
    },
  };
};

/** Ràng buộc prompt dùng chung cho cả sinh keyframe và sinh video trực tiếp. */
export const buildShotConsistencyPrompt = (project: ProjectState, shot: Shot): string => {
  const pack = buildShotReferencePack(project, shot);
  const lines = [
    '[RÀNG BUỘC LIÊN TỤC HÌNH ẢNH — BẮT BUỘC]',
    ...pack.promptContext,
    pack.items.length
      ? 'Khớp đúng nhận dạng, bao bì, logo, màu sắc và bối cảnh theo từng ảnh tham chiếu; không trộn đặc điểm giữa các ảnh.'
      : 'Không có ảnh tham chiếu: dựng đúng các mô tả trên và giữ nguyên các đặc điểm đó ở mọi khung hình.',
    'Không tự đổi khuôn mặt, kiểu tóc, trang phục, hình dáng sản phẩm, chữ trên bao bì, bảng màu hoặc thời điểm bối cảnh.',
  ];
  return lines.filter(Boolean).join('\n');
};

export const withShotConsistencyPrompt = (basePrompt: string, project: ProjectState, shot: Shot): string => {
  const marker = '[RÀNG BUỘC LIÊN TỤC HÌNH ẢNH — BẮT BUỘC]';
  const clean = basePrompt.includes(marker) ? basePrompt.slice(0, basePrompt.indexOf(marker)).trim() : basePrompt.trim();
  return `${clean}\n\n${buildShotConsistencyPrompt(project, shot)}`.trim();
};

/* ─────────────────────────  Khoá tham số sinh  ───────────────────────── */

/**
 * Khoá tham số của một lần sinh đã được duyệt.
 *
 * Từ đó về sau mọi shot có nhân vật này đều dùng đúng model và seed đó, trừ
 * khi người dùng chủ động mở khoá.
 */
export const lockGenerationParams = (
  character: Character,
  lock: Omit<GenerationLock, 'lockedAt'> & { lockedAt?: number },
): Character => ({
  ...character,
  lock: { ...lock, lockedAt: lock.lockedAt ?? Date.now() },
});

export const unlockGenerationParams = (character: Character): Character => {
  const { lock: _removed, ...rest } = character;
  return rest;
};

/**
 * Model nên dùng cho shot này.
 *
 * Trả về model đã khoá nếu có; nếu không thì model người dùng đang chọn. Khoá
 * chỉ áp cho nhân vật đã có ảnh được duyệt, nên không cản trở lúc đang thử.
 */
export const resolveLockedModel = (
  characters: Character[],
  requestedModelId: string,
): { modelId: string; lockedBy?: string } => {
  const resolved = resolveGenerationParams(characters, requestedModelId);
  return { modelId: resolved.modelId, lockedBy: resolved.lockedBy };
};

/** Khoá model và tỷ lệ ở đúng entry point sinh ảnh; seed được giữ để dùng khi adapter hỗ trợ. */
export const resolveGenerationParams = (
  characters: Character[],
  requestedModelId: string,
  requestedAspectRatio?: AspectRatio,
  additionalEntities: Array<{ name: string; lock?: GenerationLock }> = [],
): { modelId: string; aspectRatio?: AspectRatio; seed?: number; lockedBy?: string } => {
  const lockedEntities = [
    ...characters.map((character) => ({ name: character.name, lock: character.lock })),
    ...additionalEntities,
  ].filter((entity) => entity.lock?.modelId);
  const signatures = new Set(lockedEntities.map((entity) => [
    entity.lock!.modelId,
    entity.lock!.aspectRatio ?? '',
    entity.lock!.seed ?? '',
  ].join('|')));
  if (signatures.size > 1) {
    throw new Error(`${lockedEntities.map((entity) => entity.name).join(', ')} đang khóa tham số khác nhau. Hãy dùng cùng model/tỷ lệ hoặc mở khóa trước khi sinh.`);
  }

  const locked = lockedEntities[0];
  if (!locked?.lock) return { modelId: requestedModelId, aspectRatio: requestedAspectRatio };
  return {
    modelId: locked.lock.modelId,
    aspectRatio: locked.lock.aspectRatio ?? requestedAspectRatio,
    seed: locked.lock.seed,
    lockedBy: locked.name,
  };
};

/* ─────────────────────────  Đồ thị phụ thuộc  ───────────────────────── */

export interface DependencyGraph {
  /** Nhân vật nào xuất hiện ở những shot nào. */
  byCharacter: Map<string, string[]>;
  /** Bối cảnh nào được dùng ở những shot nào. */
  byScene: Map<string, string[]>;
}

export const buildDependencyGraph = (project: ProjectState): DependencyGraph => {
  const byCharacter = new Map<string, string[]>();
  const byScene = new Map<string, string[]>();

  for (const shot of project.shots) {
    for (const characterId of shot.characters ?? []) {
      const list = byCharacter.get(characterId);
      if (list) list.push(shot.id);
      else byCharacter.set(characterId, [shot.id]);
    }

    if (shot.sceneId) {
      const list = byScene.get(shot.sceneId);
      if (list) list.push(shot.id);
      else byScene.set(shot.sceneId, [shot.id]);
    }
  }

  return { byCharacter, byScene };
};

/** Sửa nhân vật hoặc bối cảnh này thì những shot nào phải xem lại. */
export const findAffectedShots = (
  project: ProjectState,
  changed: { characterIds?: string[]; sceneIds?: string[] },
): string[] => {
  const graph = buildDependencyGraph(project);
  const affected = new Set<string>();

  for (const id of changed.characterIds ?? []) {
    for (const shotId of graph.byCharacter.get(id) ?? []) affected.add(shotId);
  }
  for (const id of changed.sceneIds ?? []) {
    for (const shotId of graph.byScene.get(id) ?? []) affected.add(shotId);
  }

  // Giữ đúng thứ tự shot trong dự án để danh sách đọc được.
  return project.shots.filter((shot) => affected.has(shot.id)).map((shot) => shot.id);
};

/* ─────────────────────  Chữ ký nguồn và lớp cần sinh lại  ───────────── */

const fingerprint = (value?: string): string => {
  if (!value) return 'none';
  const sample = `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
  let hash = 5381;
  for (let i = 0; i < sample.length; i += 1) hash = ((hash << 5) + hash) ^ sample.charCodeAt(i);
  return (hash >>> 0).toString(36);
};

/**
 * Chữ ký của mọi thứ **nằm phía trên** shot này.
 *
 * `getShotMediaSignature` chỉ tính keyframe và video của chính shot, nên đổi
 * ảnh định trang nhân vật thì shot không hề bị đánh dấu lỗi thời. Chữ ký này
 * bịt đúng lỗ đó.
 */
export const getShotUpstreamSignature = (project: ProjectState, shot: Shot): string => {
  const characters = project.scriptData?.characters ?? [];
  const scenes = project.scriptData?.scenes ?? [];

  const characterPart = (shot.characters ?? [])
    .map((characterId) => {
      const character = characters.find((item) => item.id === characterId);
      if (!character) return `${characterId}:missing`;

      const variationId = shot.characterVariations?.[characterId];
      const variation = character.variations.find((item) => item.id === variationId);
      const refs = collectReferences(character).map((item) => fingerprint(item.imageUrl)).join(',');

      return [
        characterId,
        fingerprint(character.visualPrompt),
        refs || 'no-ref',
        variation ? `${variation.id}:${fingerprint(variation.referenceImage)}` : 'no-var',
        character.lock?.modelId ?? 'no-lock',
      ].join(':');
    })
    .sort()
    .join('|');

  const scene = scenes.find((item) => item.id === shot.sceneId);
  const scenePart = scene
    ? `${scene.id}:${fingerprint(scene.visualPrompt)}:${fingerprint(scene.referenceImage)}:${scene.lock?.modelId ?? 'no-lock'}`
    : `${shot.sceneId ?? 'no-scene'}:missing`;

  const lockedBrandIds = project.consistency?.lockedBrandAssetIds;
  const brandPart = (project.brandKitSnapshot?.assets ?? [])
    .filter((asset) => lockedBrandIds === undefined
      ? ['product', 'logo', 'character', 'reference'].includes(asset.type)
      : lockedBrandIds.includes(asset.id))
    .map((asset) => `${asset.id}:${asset.type}:${fingerprint(asset.url)}:${fingerprint(asset.notes)}`)
    .sort()
    .join('|') || 'no-brand-ref';

  return `${characterPart}#${scenePart}#${brandPart}`;
};

export type RegenerationScope = 'none' | 'video-only' | 'keyframes-and-video';

/**
 * Nguồn đổi thì phải sinh lại tới đâu.
 *
 * Ảnh tham chiếu hay prompt nhân vật đổi thì keyframe sai từ gốc, nên phải làm
 * lại keyframe rồi mới tới video. Chỉ prompt video đổi thì giữ nguyên keyframe
 * — đó là chỗ tiết kiệm lớn nhất, vì keyframe thường đắt hơn nhiều so với việc
 * nối lại một đoạn video từ hai khung đã có.
 */
export const classifyRegenerationScope = (
  shot: Shot,
  previousUpstreamSignature: string | undefined,
  currentUpstreamSignature: string,
): RegenerationScope => {
  const hasKeyframes = shot.keyframes.some((frame) => frame.status === 'completed');
  const hasVideo = shot.interval?.status === 'completed';
  if (!hasKeyframes && !hasVideo) return 'none';

  if (previousUpstreamSignature && previousUpstreamSignature !== currentUpstreamSignature) {
    return 'keyframes-and-video';
  }

  return 'none';
};

export interface ConsistencyReadiness {
  characterId: string;
  name: string;
  referenceCount: number;
  approvedCount: number;
  angles: ReferenceAngle[];
  locked: boolean;
  /** Thiếu gì để giữ được nhận diện qua nhiều shot. */
  gaps: string[];
}

/**
 * Nhân vật này đã đủ điều kiện giữ nhất quán chưa.
 *
 * Dùng để cảnh báo **trước khi** sinh hàng loạt, thay vì phát hiện lệch mặt
 * sau khi đã dựng xong hai mươi shot.
 */
export const assessCharacterReadiness = (character: Character): ConsistencyReadiness => {
  const refs = collectReferences(character);
  const angles = Array.from(new Set(refs.map((item) => item.angle)));
  const approvedCount = refs.filter((item) => item.approved).length;
  const gaps: string[] = [];

  if (!refs.length) gaps.push('Chưa có ảnh tham chiếu nào.');
  else if (refs.length === 1) gaps.push('Chỉ có một ảnh tham chiếu, khó giữ mặt ở cảnh nghiêng.');

  if (refs.length > 0 && !angles.includes('three-quarter')) {
    gaps.push('Thiếu ảnh góc ba phần tư, góc hay dùng nhất khi quay.');
  }
  if (!character.lock) {
    gaps.push('Chưa khoá model, mỗi shot có thể dùng model khác nhau.');
  }

  return {
    characterId: character.id,
    name: character.name,
    referenceCount: refs.length,
    approvedCount,
    angles,
    locked: Boolean(character.lock),
    gaps,
  };
};
