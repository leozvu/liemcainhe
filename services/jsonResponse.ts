/**
 * Phân tích JSON do mô hình sinh ra. Mô hình đôi khi bọc Markdown, thêm lời dẫn
 * hoặc bị ngắt giữa chuỗi khi chạm giới hạn token; bộ phân tích này xử lý các
 * trường hợp có thể sửa an toàn trước khi báo lỗi cho người dùng.
 */

const stripMarkdownFence = (value: string): string => value
  .trim()
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();

const extractJsonRoot = (value: string): string => {
  const objectStart = value.indexOf('{');
  const arrayStart = value.indexOf('[');
  const start = objectStart === -1
    ? arrayStart
    : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);
  if (start === -1) return value.trim();

  const source = value.slice(start);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') stack.push(char);
    if (char === '}' || char === ']') {
      const expected = char === '}' ? '{' : '[';
      if (stack.at(-1) === expected) stack.pop();
      if (stack.length === 0) return source.slice(0, index + 1);
    }
  }
  return source;
};

const escapeControlCharactersInsideStrings = (value: string): string => {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const char of value) {
    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }
      if (char === '\\') {
        result += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        result += char;
        inString = false;
        continue;
      }
      if (char === '\n') result += '\\n';
      else if (char === '\r') result += '\\r';
      else if (char === '\t') result += '\\t';
      else result += char;
      continue;
    }
    result += char;
    if (char === '"') inString = true;
  }
  return result;
};

const closeTruncatedJson = (value: string): string => {
  let repaired = escapeControlCharactersInsideStrings(value).trim();
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const char of repaired) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' && stack.at(-1) === '{') stack.pop();
    else if (char === ']' && stack.at(-1) === '[') stack.pop();
  }

  if (escaped) repaired = repaired.slice(0, -1);
  if (inString) repaired += '"';
  repaired = repaired.replace(/,\s*$/g, '').replace(/:\s*$/g, ': null');
  while (stack.length) repaired += stack.pop() === '{' ? '}' : ']';
  return repaired.replace(/,\s*([}\]])/g, '$1');
};

export const parseModelJson = <T = unknown>(input: string): T => {
  const candidate = extractJsonRoot(stripMarkdownFence(input || ''));
  const attempts = [
    candidate,
    escapeControlCharactersInsideStrings(candidate).replace(/,\s*([}\]])/g, '$1'),
    closeTruncatedJson(candidate),
  ];

  let lastError: unknown;
  for (const attempt of Array.from(new Set(attempts))) {
    try {
      return JSON.parse(attempt) as T;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : 'JSON không hợp lệ';
  throw new Error(`Phản hồi có cấu trúc của AI bị thiếu hoặc hỏng (${detail})`);
};

