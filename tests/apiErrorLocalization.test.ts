import { describe, expect, it } from 'vitest';
import { localizeApiErrorMessage } from '../services/apiErrorLocalization';

describe('localizeApiErrorMessage', () => {
  it('không dịch HTTP 429 thành hết số dư', () => {
    const message = localizeApiErrorMessage('Too many concurrent tasks', 429);
    expect(message).toContain('không phải lỗi khóa API hay hết tiền');
    expect(message).not.toContain('không đủ credit');
  });

  it('chỉ báo thiếu credit khi nhà cung cấp nói rõ', () => {
    expect(localizeApiErrorMessage('insufficient credit balance', 402)).toContain('không đủ credit');
  });

  it('phân biệt group key không có channel model với hết credit', () => {
    const message = localizeApiErrorMessage('No available channel for model grok-video-3 under group cheap', 500);
    expect(message).toContain('không có quyền sử dụng mô hình');
    expect(message).not.toContain('không đủ credit');
  });
});

/**
 * Nhận diện thông báo vốn đã là tiếng Việt thì giữ nguyên, không thay bằng câu
 * chung chung. Phần này từng dùng `\b` — chỉ hiểu ASCII — nên rất dễ hỏng im
 * lặng khi ai đó thêm một cụm bắt đầu bằng chữ có dấu.
 */
describe('nhận diện chuỗi tiếng Việt', () => {
  // Không truyền status: mọi status đã biết đều rơi vào một nhóm có sẵn câu
  // trả lời và thoát trước khi tới nhánh nhận diện tiếng Việt.
  const passthrough = (raw: string) => localizeApiErrorMessage(raw);

  it('giữ nguyên câu tiếng Việt nhận ra qua nguyên âm có dấu phụ', () => {
    // `ơ` nằm thẳng trong bảng ký tự.
    expect(passthrough('Máy chủ đang quá tải, thử lại sơ bộ sau')).toContain('quá tải');
  });

  it('giữ nguyên câu mà bảng ký tự KHÔNG bắt được, phải nhờ danh sách cụm từ', () => {
    // `ỗ` (U+1ED7) là codepoint riêng, không nằm trong [ăâđêôơư]. Nếu ranh giới
    // từ hỏng thì câu này rơi xuống thông báo chung.
    expect(passthrough('Có lỗi khi gọi dịch vụ')).toBe('Có lỗi khi gọi dịch vụ');
  });

  it('bắt được cụm hai chữ mà không chữ nào nằm trong bảng ký tự', () => {
    expect(passthrough('Sai tài khoản rồi')).toBe('Sai tài khoản rồi');
  });

  it('chuỗi tiếng Anh thuần thì thay bằng thông báo chung', () => {
    expect(passthrough('Something went wrong')).toContain('Yêu cầu tới dịch vụ AI thất bại');
  });

  it('cụm dính liền chữ khác không tính là khớp', () => {
    // "khoản" dính vào chữ phía sau: không phải một từ đứng riêng, nên không
    // được coi là dấu hiệu tiếng Việt.
    expect(passthrough('taikhoanx failure')).toContain('Yêu cầu tới dịch vụ AI thất bại');
  });
});
