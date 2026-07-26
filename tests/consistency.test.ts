import { describe, expect, it } from 'vitest';
import {
  MAX_REFERENCES_PER_CALL,
  addReference,
  approveReference,
  assessCharacterReadiness,
  buildDependencyGraph,
  classifyRegenerationScope,
  collectReferences,
  findAffectedShots,
  getShotUpstreamSignature,
  lockGenerationParams,
  pickReferences,
  resolveLockedModel,
  unlockGenerationParams,
} from '../services/consistencyService';
import { getShotFullSignature, runLocalSupervisorAudit } from '../services/aiSupervisorService';
import { Character, ProjectState, Shot } from '../types';

const character = (over: Partial<Character> = {}): Character => ({
  id: 'char_1',
  name: 'Hạnh',
  gender: 'nữ',
  age: '32',
  personality: 'điềm đạm',
  visualPrompt: 'A Vietnamese woman, 32, short hair',
  variations: [],
  ...over,
});

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 'shot_1',
  sceneId: 'scene_1',
  actionSummary: 'Hạnh mở quầy',
  cameraMovement: 'static',
  characters: ['char_1'],
  keyframes: [],
  ...over,
});

const project = (over: Partial<ProjectState> = {}): ProjectState =>
  ({
    id: 'p1',
    title: 'Dự án',
    shots: [shot()],
    scriptData: {
      title: 'x', genre: 'y', logline: 'z',
      characters: [character()],
      scenes: [{ id: 'scene_1', location: 'Quầy giao dịch', time: 'sáng', atmosphere: 'yên tĩnh', visualPrompt: 'A bank counter' }],
      storyParagraphs: [],
    },
    ...over,
  }) as ProjectState;

describe('bộ ảnh tham chiếu', () => {
  it('ảnh cũ referenceImage vẫn được dùng, coi như chính diện đã duyệt', () => {
    const refs = collectReferences(character({ referenceImage: 'data:base' }));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ angle: 'front', approved: true });
  });

  it('không nhân đôi khi ảnh cũ đã nằm trong bộ', () => {
    const c = character({
      referenceImage: 'data:base',
      referencePack: [{ id: 'r1', imageUrl: 'data:base', angle: 'front', approved: false, addedAt: 1 }],
    });
    expect(collectReferences(c)).toHaveLength(1);
  });

  it('thêm ảnh mới và khử trùng lặp theo URL', () => {
    let c = character();
    c = addReference(c, { imageUrl: 'a', angle: 'profile', approved: false, addedAt: 1 });
    c = addReference(c, { imageUrl: 'a', angle: 'front', approved: false, addedAt: 2 });
    expect(c.referencePack).toHaveLength(1);
  });

  it('đánh dấu ảnh đã duyệt sau khi shot dùng nó được thông qua', () => {
    let c = addReference(character(), { id: 'r1', imageUrl: 'a', angle: 'front', approved: false, addedAt: 1 });
    c = approveReference(c, 'r1');
    expect(c.referencePack![0].approved).toBe(true);
  });
});

describe('chọn ảnh cho từng cỡ cảnh', () => {
  const withRefs = () =>
    character({
      referencePack: [
        { id: 'front', imageUrl: 'f', angle: 'front', approved: false, addedAt: 1 },
        { id: 'tq', imageUrl: 't', angle: 'three-quarter', approved: false, addedAt: 2 },
        { id: 'back', imageUrl: 'b', angle: 'back', approved: false, addedAt: 3 },
        { id: 'profile', imageUrl: 'p', angle: 'profile', approved: false, addedAt: 4 },
      ],
    });

  it('cảnh cận ưu tiên góc chính diện', () => {
    const picked = pickReferences(withRefs(), { shotSize: 'close-up' } as Shot);
    expect(picked[0].angle).toBe('front');
  });

  it('cảnh toàn ưu tiên góc ba phần tư', () => {
    const picked = pickReferences(withRefs(), { shotSize: 'toàn cảnh' } as Shot);
    expect(picked[0].angle).toBe('three-quarter');
  });

  it('ảnh đã duyệt luôn đứng trước, bất kể góc', () => {
    const c = character({
      referencePack: [
        { id: 'tq', imageUrl: 't', angle: 'three-quarter', approved: false, addedAt: 9 },
        { id: 'back', imageUrl: 'b', angle: 'back', approved: true, addedAt: 1 },
      ],
    });
    expect(pickReferences(c, { shotSize: 'medium' } as Shot)[0].id).toBe('back');
  });

  it('giới hạn số ảnh gửi kèm, vì nhiều hơn không tốt hơn', () => {
    const many = character({
      referencePack: Array.from({ length: 10 }, (_, i) => ({
        id: `r${i}`, imageUrl: `u${i}`, angle: 'front' as const, approved: false, addedAt: i,
      })),
    });
    expect(pickReferences(many)).toHaveLength(MAX_REFERENCES_PER_CALL);
  });

  it('chưa có ảnh nào thì trả rỗng, không bịa', () => {
    expect(pickReferences(character())).toEqual([]);
  });
});

describe('khoá tham số sinh', () => {
  it('khoá rồi thì mọi shot dùng đúng model đó', () => {
    const c = lockGenerationParams(character(), { modelId: 'kie-veo3', seed: 42, lockedAt: 1 });
    const resolved = resolveLockedModel([c], 'model-khac');
    expect(resolved.modelId).toBe('kie-veo3');
    expect(resolved.lockedBy).toBe('Hạnh');
  });

  it('chưa khoá thì tôn trọng lựa chọn của người dùng', () => {
    expect(resolveLockedModel([character()], 'model-nguoi-dung').modelId).toBe('model-nguoi-dung');
  });

  it('mở khoá thì trả lại quyền chọn', () => {
    const c = unlockGenerationParams(lockGenerationParams(character(), { modelId: 'x' }));
    expect(c.lock).toBeUndefined();
    expect(resolveLockedModel([c], 'tu-chon').modelId).toBe('tu-chon');
  });
});

describe('đồ thị phụ thuộc', () => {
  const p = project({
    shots: [
      shot({ id: 's1', characters: ['char_1'], sceneId: 'scene_1' }),
      shot({ id: 's2', characters: ['char_1', 'char_2'], sceneId: 'scene_2' }),
      shot({ id: 's3', characters: ['char_2'], sceneId: 'scene_1' }),
    ],
  });

  it('biết nhân vật xuất hiện ở những shot nào', () => {
    const graph = buildDependencyGraph(p);
    expect(graph.byCharacter.get('char_1')).toEqual(['s1', 's2']);
    expect(graph.byScene.get('scene_1')).toEqual(['s1', 's3']);
  });

  it('sửa nhân vật thì biết chính xác shot nào phải xem lại', () => {
    expect(findAffectedShots(p, { characterIds: ['char_2'] })).toEqual(['s2', 's3']);
  });

  it('sửa bối cảnh cũng truy ra được', () => {
    expect(findAffectedShots(p, { sceneIds: ['scene_2'] })).toEqual(['s2']);
  });

  it('gộp và khử trùng khi sửa cả hai', () => {
    expect(findAffectedShots(p, { characterIds: ['char_1'], sceneIds: ['scene_1'] }))
      .toEqual(['s1', 's2', 's3']);
  });

  it('id không tồn tại thì không ảnh hưởng shot nào', () => {
    expect(findAffectedShots(p, { characterIds: ['khong-co'] })).toEqual([]);
  });
});

describe('chữ ký nguồn — lỗ hổng chính Epic 4 bịt', () => {
  it('đổi ảnh định trang nhân vật thì chữ ký nguồn đổi theo', () => {
    const p1 = project();
    const truoc = getShotUpstreamSignature(p1, p1.shots[0]);

    const p2 = project();
    p2.scriptData!.characters[0].referenceImage = 'data:anh-moi';
    const sau = getShotUpstreamSignature(p2, p2.shots[0]);

    expect(sau).not.toBe(truoc);
  });

  it('đổi prompt nhân vật cũng làm chữ ký đổi', () => {
    const p1 = project();
    const truoc = getShotUpstreamSignature(p1, p1.shots[0]);
    const p2 = project();
    p2.scriptData!.characters[0].visualPrompt = 'Mô tả hoàn toàn khác';
    expect(getShotUpstreamSignature(p2, p2.shots[0])).not.toBe(truoc);
  });

  it('đổi bối cảnh cũng làm chữ ký đổi', () => {
    const p1 = project();
    const truoc = getShotUpstreamSignature(p1, p1.shots[0]);
    const p2 = project();
    p2.scriptData!.scenes[0].visualPrompt = 'Bối cảnh khác hẳn';
    expect(getShotUpstreamSignature(p2, p2.shots[0])).not.toBe(truoc);
  });

  it('khoá model đổi thì chữ ký cũng đổi — vì model khác cho ra người khác', () => {
    const p1 = project();
    const truoc = getShotUpstreamSignature(p1, p1.shots[0]);
    const p2 = project();
    p2.scriptData!.characters[0] = lockGenerationParams(p2.scriptData!.characters[0], { modelId: 'm2' });
    expect(getShotUpstreamSignature(p2, p2.shots[0])).not.toBe(truoc);
  });

  it('không đổi gì thì chữ ký giữ nguyên', () => {
    expect(getShotUpstreamSignature(project(), project().shots[0]))
      .toBe(getShotUpstreamSignature(project(), project().shots[0]));
  });

  it('nhân vật biến mất khỏi kịch bản vẫn ra chữ ký, không ném lỗi', () => {
    const p = project();
    p.scriptData!.characters = [];
    expect(() => getShotUpstreamSignature(p, p.shots[0])).not.toThrow();
    expect(getShotUpstreamSignature(p, p.shots[0])).toContain('missing');
  });
});

describe('Supervisor nay bắt được thay đổi ở nguồn', () => {
  const withMedia = (): ProjectState => {
    const p = project();
    p.shots[0].keyframes = [
      { id: 'kf1', type: 'start', visualPrompt: 'x', imageUrl: 'data:kf', status: 'completed' },
    ];
    return p;
  };

  it('chữ ký lưu lại gồm cả phần nguồn', () => {
    const audited = runLocalSupervisorAudit(withMedia());
    expect(audited.aiSupervisor!.reports[0].mediaSignature).toContain('##');
  });

  it('đổi ảnh định trang thì chữ ký shot đổi, dù media của shot y nguyên', () => {
    const p1 = withMedia();
    const truoc = getShotFullSignature(p1, p1.shots[0]);

    const p2 = withMedia();
    p2.scriptData!.characters[0].referenceImage = 'data:anh-hoan-toan-khac';
    const sau = getShotFullSignature(p2, p2.shots[0]);

    // Trước Epic 4, hai chữ ký này bằng nhau và shot không bị đánh dấu lỗi thời.
    expect(sau).not.toBe(truoc);
  });
});

describe('phạm vi cần sinh lại', () => {
  const withMedia = (): Shot => shot({
    keyframes: [{ id: 'kf1', type: 'start', visualPrompt: 'x', imageUrl: 'u', status: 'completed' }],
    interval: { id: 'iv1', startKeyframeId: 'kf1', endKeyframeId: 'kf1', duration: 8, motionStrength: 1, videoUrl: 'v', status: 'completed' },
  });

  it('nguồn đổi thì phải làm lại keyframe rồi mới tới video', () => {
    expect(classifyRegenerationScope(withMedia(), 'cu', 'moi')).toBe('keyframes-and-video');
  });

  it('nguồn không đổi thì không phải làm gì', () => {
    expect(classifyRegenerationScope(withMedia(), 'giong', 'giong')).toBe('none');
  });

  it('chưa sinh gì thì không có gì để làm lại', () => {
    expect(classifyRegenerationScope(shot(), 'cu', 'moi')).toBe('none');
  });

  it('chưa có chữ ký cũ thì không kết luận vội', () => {
    expect(classifyRegenerationScope(withMedia(), undefined, 'moi')).toBe('none');
  });
});

describe('đánh giá độ sẵn sàng của nhân vật', () => {
  it('chưa có ảnh nào thì nêu rõ', () => {
    const r = assessCharacterReadiness(character());
    expect(r.referenceCount).toBe(0);
    expect(r.gaps.some((g) => g.includes('Chưa có ảnh'))).toBe(true);
  });

  it('chỉ một ảnh thì cảnh báo khó giữ mặt ở cảnh nghiêng', () => {
    const r = assessCharacterReadiness(character({ referenceImage: 'a' }));
    expect(r.gaps.some((g) => g.includes('một ảnh tham chiếu'))).toBe(true);
  });

  it('thiếu góc ba phần tư thì nhắc', () => {
    const r = assessCharacterReadiness(character({ referenceImage: 'a' }));
    expect(r.gaps.some((g) => g.includes('ba phần tư'))).toBe(true);
  });

  it('chưa khoá model thì nhắc', () => {
    expect(assessCharacterReadiness(character()).gaps.some((g) => g.includes('khoá model'))).toBe(true);
  });

  it('đủ ảnh nhiều góc và đã khoá thì không còn thiếu gì', () => {
    const c = lockGenerationParams(
      character({
        referencePack: [
          { id: 'a', imageUrl: 'a', angle: 'front', approved: true, addedAt: 1 },
          { id: 'b', imageUrl: 'b', angle: 'three-quarter', approved: true, addedAt: 2 },
        ],
      }),
      { modelId: 'kie-veo3' },
    );
    const r = assessCharacterReadiness(c);
    expect(r.gaps).toEqual([]);
    expect(r.locked).toBe(true);
    expect(r.approvedCount).toBe(2);
  });
});
