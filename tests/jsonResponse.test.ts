import { describe, expect, it } from 'vitest';
import { parseModelJson } from '../services/jsonResponse';

describe('parseModelJson', () => {
  it('bỏ hàng rào Markdown và lời dẫn quanh JSON', () => {
    expect(parseModelJson<{ ok: boolean }>('Kết quả:\n```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('sửa chuỗi bị ngắt giữa phản hồi để phần đã nhận vẫn dùng được', () => {
    expect(parseModelJson<{ startFrame: string }>('{"startFrame":"Khung hình điện ảnh chưa kết thúc'))
      .toEqual({ startFrame: 'Khung hình điện ảnh chưa kết thúc' });
  });

  it('sửa ký tự xuống dòng thô và dấu phẩy cuối', () => {
    expect(parseModelJson<{ prompt: string }>('{"prompt":"dòng một\ndòng hai",}'))
      .toEqual({ prompt: 'dòng một\ndòng hai' });
  });
});

