import { AspectRatio, AutoEditorReframeFocus, AutoEditorTimelineClip, AutoEditorTransition, Shot, VoiceTake } from '../types';

/**
 * Trí tuệ dựng phim.
 *
 * Auto Editor hiện cắt máy móc: một kiểu chuyển cảnh cho toàn bộ timeline, độ
 * dài mỗi clip bằng đúng độ dài video sinh ra. Đó là ghép, không phải dựng.
 *
 * Lớp này là **logic thuần**, không gọi model nào. Nhịp cắt và sync nhạc là
 * việc xác định — gọi AI ở đây chỉ tốn tiền để nhận về một đề xuất kém ổn định
 * hơn quy tắc dựng đã có từ trăm năm nay.
 */

/* ─────────────────────────────  Nhịp cắt  ───────────────────────────── */

/**
 * Tốc độ nói tiếng Việt, ký tự mỗi giây.
 *
 * Khoảng 140–160 từ mỗi phút cho lời thoại tự nhiên; từ tiếng Việt trung bình
 * khoảng 5 ký tự kể cả khoảng trắng. Lấy 12 để chừa biên an toàn — thà giữ
 * khung hơi lâu còn hơn cắt mất cuối câu.
 */
export const VIETNAMESE_CHARS_PER_SECOND = 12;

/** Khoảng thở trước và sau mỗi câu thoại. */
export const BREATHING_ROOM_SECONDS = 0.6;

/** Không bao giờ để một clip ngắn hơn ngần này — mắt không kịp đọc khung hình. */
export const MIN_CLIP_SECONDS = 1.2;

export interface PacingRecommendation {
  clipId: string;
  shotId: string;
  currentDuration: number;
  recommendedDuration: number;
  transition: AutoEditorTransition;
  reason: string;
  /** Chênh lệch đáng kể mới đáng sửa. */
  significant: boolean;
}

/** Thời lượng tối thiểu để đọc hết lời thoại. */
export const speechDuration = (dialogue?: string): number => {
  const text = (dialogue ?? '').trim();
  if (!text) return 0;
  return text.length / VIETNAMESE_CHARS_PER_SECOND + BREATHING_ROOM_SECONDS * 2;
};

const shotSizeClass = (shotSize?: string): 'close' | 'wide' | 'medium' => {
  const value = (shotSize ?? '').toLowerCase();
  if (/close|cận/.test(value)) return 'close';
  if (/wide|toàn|viễn|establish/.test(value)) return 'wide';
  return 'medium';
};

const hasCameraMove = (cameraMovement?: string): boolean =>
  /pan|tilt|zoom|dolly|track|crane|lia|quét|đẩy|kéo/i.test(cameraMovement ?? '');

/**
 * Độ dài nên có của một khung hình.
 *
 * Ba quy tắc dựng cơ bản, theo thứ tự ưu tiên:
 *
 * 1. **Thoại quyết định sàn.** Cắt trước khi nói hết câu là lỗi nặng nhất.
 * 2. **Cảnh toàn cần lâu hơn cảnh cận.** Mắt phải quét hết khung mới hiểu;
 *    cảnh cận thì thông tin đã nằm giữa khung.
 * 3. **Máy đang chuyển động thì để nó hoàn thành.** Cắt giữa cú lia làm khán
 *    giả hụt hẫng.
 */
export const recommendClipDuration = (shot: Shot | undefined, dialogue?: string): { seconds: number; reason: string } => {
  const speech = speechDuration(dialogue);
  const size = shotSizeClass(shot?.shotSize);
  const moving = hasCameraMove(shot?.cameraMovement);

  if (speech > 0) {
    const withMove = moving ? speech + 0.5 : speech;
    return {
      seconds: Math.max(MIN_CLIP_SECONDS, Math.round(withMove * 10) / 10),
      reason: moving
        ? 'Đủ cho lời thoại, cộng thêm nửa giây để cú máy hoàn thành.'
        : 'Đủ cho lời thoại kèm khoảng thở hai đầu.',
    };
  }

  const base = size === 'wide' ? 3.5 : size === 'close' ? 2 : 2.6;
  const seconds = moving ? base + 0.8 : base;

  return {
    seconds: Math.max(MIN_CLIP_SECONDS, Math.round(seconds * 10) / 10),
    reason:
      size === 'wide'
        ? 'Cảnh toàn cần lâu hơn để mắt quét hết khung.'
        : size === 'close'
          ? 'Cảnh cận đọc nhanh, giữ lâu sẽ ì.'
          : 'Nhịp trung bình cho cảnh không thoại.',
  };
};

/**
 * Chuyển cảnh nên dùng giữa hai clip.
 *
 * Cắt thẳng là mặc định — nó vô hình và giữ được nhịp. Mờ chồng chỉ dùng khi
 * đổi bối cảnh, vì lúc đó khán giả cần một tín hiệu rằng không gian đã đổi.
 */
export const recommendTransition = (
  current: Shot | undefined,
  previous: Shot | undefined,
): { transition: AutoEditorTransition; reason: string } => {
  if (!previous) return { transition: 'cut', reason: 'Clip đầu tiên.' };
  if (current?.sceneId && previous.sceneId && current.sceneId !== previous.sceneId) {
    return { transition: 'crossfade', reason: 'Đổi bối cảnh, cần tín hiệu chuyển không gian.' };
  }
  return { transition: 'cut', reason: 'Cùng bối cảnh, cắt thẳng giữ được nhịp.' };
};

/** Chênh dưới ngần này thì không đáng sửa. */
export const SIGNIFICANT_DELTA_SECONDS = 0.5;

export const analyzePacing = (
  clips: AutoEditorTimelineClip[],
  shots: Shot[],
): PacingRecommendation[] => {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));

  return clips.map((clip, index) => {
    const shot = byId.get(clip.shotId);
    const previous = index > 0 ? byId.get(clips[index - 1].shotId) : undefined;
    const duration = recommendClipDuration(shot, clip.dialogue);
    const transition = recommendTransition(shot, previous);

    return {
      clipId: clip.id,
      shotId: clip.shotId,
      currentDuration: clip.duration,
      recommendedDuration: duration.seconds,
      transition: transition.transition,
      reason: `${duration.reason} ${transition.reason}`.trim(),
      significant: Math.abs(clip.duration - duration.seconds) >= SIGNIFICANT_DELTA_SECONDS,
    };
  });
};

/**
 * Clip nào đang cắt mất lời thoại.
 *
 * Đây là lỗi nặng nhất trong dựng, và phát hiện được bằng phép tính đơn giản
 * nên không có lý do gì để nó lọt tới bản dựng cuối.
 */
export const findTruncatedDialogue = (
  clips: AutoEditorTimelineClip[],
): { clipId: string; shortBy: number }[] =>
  clips
    .map((clip) => ({ clipId: clip.id, shortBy: Math.round((speechDuration(clip.dialogue) - clip.duration) * 10) / 10 }))
    .filter((item) => item.shortBy > 0.2);

/* ────────────────────────────  Cắt theo nhạc  ───────────────────────── */

/**
 * Dịch điểm cắt về phách nhạc gần nhất.
 *
 * Chỉ dịch khi khoảng dịch nhỏ hơn nửa phách. Dịch xa hơn thì đã phá nhịp kể
 * chuyện để chiều nhịp nhạc — đánh đổi sai, vì khán giả cảm nhận câu chuyện
 * trước khi cảm nhận nhạc nền.
 */
export const snapToBeats = (
  clips: AutoEditorTimelineClip[],
  bpm: number,
  startOffsetSeconds = 0,
): AutoEditorTimelineClip[] => {
  if (!bpm || bpm <= 0) return clips;

  const beat = 60 / bpm;
  const half = beat / 2;
  let cursor = startOffsetSeconds;

  return clips.map((clip) => {
    const rawEnd = cursor + clip.duration;
    const nearestBeat = Math.round((rawEnd - startOffsetSeconds) / beat) * beat + startOffsetSeconds;
    const shift = nearestBeat - rawEnd;

    const end = Math.abs(shift) < half && nearestBeat > cursor + MIN_CLIP_SECONDS ? nearestBeat : rawEnd;
    const duration = Math.round((end - cursor) * 100) / 100;
    const next = { ...clip, offset: Math.round(cursor * 100) / 100, duration };
    cursor = end;
    return next;
  });
};

/* ──────────────────────────  Chọn take giọng  ──────────────────────── */

export interface TakeChoice {
  take: VoiceTake;
  reason: string;
  /** Take bị loại kèm lý do, để người dựng hiểu vì sao. */
  rejected: { takeId: string; reason: string }[];
}

/**
 * Chọn take hợp nhất với độ dài khung hình.
 *
 * Ưu tiên bản thu người thật: giọng người luôn thắng giọng máy khi cả hai cùng
 * vừa. Sau đó tới take vừa khung, lấy bản dài nhất trong số vừa — nói chậm rãi
 * nghe tự nhiên hơn nói vội.
 */
export const pickBestTake = (takes: VoiceTake[], targetDuration: number): TakeChoice | null => {
  const usable = takes.filter((take) => take.status === 'ready' && take.audioUrl);
  if (!usable.length) return null;

  const rejected: TakeChoice['rejected'] = [];
  const fits = usable.filter((take) => {
    if (take.duration === undefined) return true;
    if (take.duration <= targetDuration + 0.1) return true;
    rejected.push({
      takeId: take.id,
      reason: `Dài ${Math.round((take.duration - targetDuration) * 10) / 10}s so với khung hình`,
    });
    return false;
  });

  const pool = fits.length ? fits : usable;

  const human = pool.filter((take) => take.source === 'human');
  const candidates = human.length ? human : pool;

  const best = [...candidates].sort((left, right) => (right.duration ?? 0) - (left.duration ?? 0))[0];

  return {
    take: best,
    reason: !fits.length
      ? 'Không take nào vừa khung hình; chọn bản gần nhất, nên cân nhắc kéo dài shot.'
      : best.source === 'human'
        ? 'Bản thu người thật, vừa khung hình.'
        : 'Vừa khung hình, chọn bản thong thả nhất.',
    rejected,
  };
};

/* ───────────────────────────  Đổi tỷ lệ khung  ──────────────────────── */

export type ReframeFocus = AutoEditorReframeFocus;

/**
 * Nên cắt khung theo hướng nào khi đổi tỷ lệ.
 *
 * Crop hai bên thì giữ giữa và cảnh báo nếu có nhiều nhân vật; crop trên/dưới
 * thì ưu tiên phần trên để giữ mặt và đường chân trời.
 */
export const suggestReframe = (
  shot: Shot | undefined,
  from: AspectRatio,
  to: AspectRatio,
): { focus: ReframeFocus; reason: string; warning?: string } => {
  if (from === to) return { focus: 'center', reason: 'Không đổi tỷ lệ.' };

  const ratioValue = (ratio: AspectRatio): number => ratio === '16:9' ? 16 / 9 : ratio === '9:16' ? 9 / 16 : 1;
  const horizontalCrop = ratioValue(to) < ratioValue(from);
  const verticalCrop = ratioValue(to) > ratioValue(from);

  const characterCount = shot?.characters?.length ?? 0;
  if (horizontalCrop && characterCount >= 2) {
    return {
      focus: 'center',
      reason: 'Giữ giữa khung.',
      warning: `Shot có ${characterCount} nhân vật; crop hai bên có thể làm mất chủ thể. Cân nhắc dựng riêng cho tỷ lệ ${to}.`,
    };
  }

  if (verticalCrop) {
    return {
      focus: 'top',
      reason: 'Khung bị cắt trên/dưới: ưu tiên phần trên để giữ mặt và đường chân trời.',
    };
  }

  return {
    focus: 'center',
    reason: shotSizeClass(shot?.shotSize) === 'wide'
      ? 'Crop hai bên cảnh toàn: giữ trục giữa và kiểm tra preview trước khi xuất.'
      : 'Crop hai bên: giữ chủ thể ở giữa khung.',
  };
};

/* ────────────────────────────  Chèn b-roll  ─────────────────────────── */

/** Clip dài hơn ngần này mà chỉ một khung hình thì bắt đầu ì. */
export const BROLL_THRESHOLD_SECONDS = 6;

export interface BRollSuggestion {
  afterClipId: string;
  shotId: string;
  atSecond: number;
  reason: string;
}

/**
 * Chỗ nên chèn cảnh phụ.
 *
 * Một khung hình giữ quá lâu làm khán giả rời mắt, kể cả khi lời thoại vẫn
 * đang hay. Chèn cảnh phụ giữa đoạn thoại dài là cách cũ và hiệu quả nhất.
 */
export const suggestBRollPoints = (
  clips: AutoEditorTimelineClip[],
  shots: Shot[],
): BRollSuggestion[] => {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));

  return clips
    .filter((clip) => clip.duration > BROLL_THRESHOLD_SECONDS)
    .map((clip) => {
      const shot = byId.get(clip.shotId);
      const moving = hasCameraMove(shot?.cameraMovement);
      return {
        afterClipId: clip.id,
        shotId: clip.shotId,
        atSecond: Math.round((clip.duration / 2) * 10) / 10,
        reason: moving
          ? `Clip dài ${clip.duration}s. Máy có chuyển động nên đỡ ì, nhưng vẫn nên cân nhắc một cảnh phụ.`
          : `Clip dài ${clip.duration}s với khung tĩnh. Chèn cảnh phụ ở giữa để giữ mắt người xem.`,
      };
    });
};

/* ─────────────────────────────  Tổng hợp  ──────────────────────────── */

export interface EditingReport {
  pacing: PacingRecommendation[];
  truncatedDialogue: { clipId: string; shortBy: number }[];
  bRoll: BRollSuggestion[];
  /** Số điểm đáng sửa, để hiện một con số duy nhất trong giao diện. */
  actionableCount: number;
}

export const analyzeTimeline = (
  clips: AutoEditorTimelineClip[],
  shots: Shot[],
): EditingReport => {
  const pacing = analyzePacing(clips, shots);
  const truncatedDialogue = findTruncatedDialogue(clips);
  const bRoll = suggestBRollPoints(clips, shots);

  return {
    pacing,
    truncatedDialogue,
    bRoll,
    actionableCount:
      pacing.filter((item) => item.significant).length + truncatedDialogue.length + bRoll.length,
  };
};

/** Một dòng tóm tắt cho giao diện. */
export const describeEditingReport = (report: EditingReport): string => {
  if (!report.actionableCount) return 'Nhịp dựng ổn, không có gì đáng sửa.';

  const parts: string[] = [];
  if (report.truncatedDialogue.length) parts.push(`${report.truncatedDialogue.length} clip cắt mất thoại`);
  const significant = report.pacing.filter((item) => item.significant).length;
  if (significant) parts.push(`${significant} clip lệch nhịp`);
  if (report.bRoll.length) parts.push(`${report.bRoll.length} chỗ nên chèn cảnh phụ`);

  return parts.join(', ') + '.';
};
