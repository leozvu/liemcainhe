import { describe, expect, it } from 'vitest';
import { createProjectCheckpoint, restoreProjectCheckpoint } from '../services/workflowService';
import { createDefaultBrief } from '../services/content/contentAxes';
import { ContentStudioState } from '../types/content';
import { ProjectState } from '../types';

const studio: ContentStudioState = {
  sourceId: 'cafef',
  brief: { ...createDefaultBrief('Giá vàng lập đỉnh'), voice: 'chuyen_gia' },
  keywordText: 'giá vàng, lãi suất',
  draft: {
    title: 'Vì sao giá vàng lập đỉnh',
    sapo: 'Ba lý do.',
    sections: [{ heading: 'A', body: 'Nội dung A.' }],
    hashtags: ['gia_vang'],
    seoTitle: 'Giá vàng',
    metaDescription: 'Ba lý do.',
    readingMinutes: 2,
  },
  bridge: null,
  durationSeconds: 45,
  updatedAt: 1_700_000_000_000,
};

// Nhân bản sâu ở mỗi lần gọi. Dùng chung một tham chiếu thì bài kiểm tra nào
// sửa dữ liệu sẽ rò sang bài sau.
const baseProject = (): ProjectState =>
  ({
    id: 'p1',
    title: 'Dự án thử',
    createdAt: 0,
    lastModified: 0,
    stage: 'content',
    rawScript: '',
    targetDuration: '60 giây',
    language: 'Tiếng Việt',
    visualStyle: 'điện ảnh',
    shotGenerationModel: '',
    scriptData: null,
    shots: [],
    isParsingScript: false,
    renderLogs: [],
    contentStudio: structuredClone(studio),
  }) as ProjectState;

describe('trạng thái Xưởng Nội dung sống cùng dự án', () => {
  it('checkpoint giữ lại toàn bộ trạng thái, không xoá bài viết', () => {
    const withCheckpoint = createProjectCheckpoint(baseProject(), 'trước khi sửa');
    const snapshot = withCheckpoint.workflow?.checkpoints[0].snapshot;

    expect(snapshot?.contentStudio).toBeDefined();
    expect(snapshot?.contentStudio?.draft?.title).toBe('Vì sao giá vàng lập đỉnh');
    expect(snapshot?.contentStudio?.brief.topic).toBe('Giá vàng lập đỉnh');
    expect(snapshot?.contentStudio?.durationSeconds).toBe(45);
  });

  it('ảnh chụp là bản sao, sửa dự án sau đó không làm hỏng checkpoint', () => {
    const withCheckpoint = createProjectCheckpoint(baseProject(), 'mốc');
    const snapshot = withCheckpoint.workflow!.checkpoints[0].snapshot;

    // Giả lập người dùng sửa tiếp sau khi đã tạo mốc.
    withCheckpoint.contentStudio!.brief.topic = 'Chủ đề đã đổi';

    expect(snapshot.contentStudio?.brief.topic).toBe('Giá vàng lập đỉnh');
  });

  it('khôi phục checkpoint trả lại đúng bài viết đã lưu', () => {
    const withCheckpoint = createProjectCheckpoint(baseProject(), 'mốc');
    const checkpointId = withCheckpoint.workflow!.checkpoints[0].id;

    const daSua: ProjectState = {
      ...withCheckpoint,
      contentStudio: { ...studio, draft: null, brief: createDefaultBrief('Chủ đề khác') },
    };

    const daKhoiPhuc = restoreProjectCheckpoint(daSua, checkpointId);
    expect(daKhoiPhuc.contentStudio?.draft?.title).toBe('Vì sao giá vàng lập đỉnh');
    expect(daKhoiPhuc.contentStudio?.brief.topic).toBe('Giá vàng lập đỉnh');
  });
});

/**
 * Mô phỏng cách React gộp nhiều lần cập nhật: mọi hàm cập nhật đều nhận `prev`
 * mới nhất, còn biến trong closure của component vẫn là giá trị lần render cũ.
 */
describe('cập nhật liên tiếp không mất dữ liệu', () => {
  const patchStudio = (
    prev: ProjectState,
    patch: Partial<ContentStudioState> | ((current: ContentStudioState) => Partial<ContentStudioState>),
  ): ProjectState => {
    const current = prev.contentStudio!;
    const delta = typeof patch === 'function' ? patch(current) : patch;
    return { ...prev, contentStudio: { ...current, ...delta, updatedAt: 1 } };
  };

  it('gõ nhiều ký tự liên tiếp trong một lượt render vẫn giữ đủ', () => {
    let state = baseProject();
    // Ba lần gõ liên tiếp, mỗi lần chỉ biết ký tự mình vừa thêm.
    for (const ky of ['A', 'AB', 'ABC']) {
      state = patchStudio(state, (current) => ({ brief: { ...current.brief, topic: ky } }));
    }
    expect(state.contentStudio?.brief.topic).toBe('ABC');
  });

  it('sửa hai trường khác nhau liên tiếp không ghi đè lẫn nhau', () => {
    let state = baseProject();
    state = patchStudio(state, (current) => ({ brief: { ...current.brief, voice: 'hai_huoc' } }));
    state = patchStudio(state, { keywordText: 'từ khoá mới' });

    expect(state.contentStudio?.brief.voice).toBe('hai_huoc');
    expect(state.contentStudio?.keywordText).toBe('từ khoá mới');
    // Bài viết cũ không bị mất khi chỉ sửa brief.
    expect(state.contentStudio?.draft?.title).toBe('Vì sao giá vàng lập đỉnh');
  });
});
