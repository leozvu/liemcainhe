import {
  Character,
  CharacterReference,
  GenerationLock,
  ProjectState,
  ReferenceAngle,
  Shot,
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
      { ...reference, id: reference.id ?? `${character.id}-ref-${pack.length + 1}` },
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
  const locked = characters.find((character) => character.lock?.modelId);
  if (!locked?.lock) return { modelId: requestedModelId };
  return { modelId: locked.lock.modelId, lockedBy: locked.name };
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
    ? `${scene.id}:${fingerprint(scene.visualPrompt)}:${fingerprint(scene.referenceImage)}`
    : `${shot.sceneId ?? 'no-scene'}:missing`;

  return `${characterPart}#${scenePart}`;
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
