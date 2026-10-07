import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderParts } from '../tools/render-parts.js';

// DOM tối giản đủ dùng cho renderParts (không cần jsdom).
function fakeEl() {
  const el = {
    children: [],
    className: '',
    style: {},
    _text: undefined,
    appendChild(child) { this.children.push(child); return child; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this.children = []; }
  };
  return el;
}

function textOf(el) {
  return el.children
    .map(c => (c.tagName === 'BR' ? '\n' : String(c.textContent ?? '')))
    .join('');
}

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement(tag) {
      const node = fakeEl();
      node.tagName = String(tag).toUpperCase();
      return node;
    }
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('renderParts (Coverage Supabase)', () => {
  it('không ném ".for is not iterable" khi gặp {br:true}', () => {
    const el = fakeEl();
    expect(() => renderParts(el, [
      'Profile: ',
      ['v56', { bold: true }],
      { br: true },
      'Số: ',
      [3, { bold: true }]
    ])).not.toThrow();
    expect(textOf(el)).toBe('Profile: v56\nSố: 3');
  });

  it('phần tử chuỗi hiển thị ĐẦY ĐỦ (trước đây chỉ ra 1 ký tự)', () => {
    const el = fakeEl();
    renderParts(el, ['Cập nhật gần nhất: ']);
    expect(textOf(el)).toBe('Cập nhật gần nhất: ');
  });

  it('phần tử mảng [text, opts] giữ bold/class', () => {
    const el = fakeEl();
    renderParts(el, [['lỗi', { class: 'bad' }]]);
    expect(el.children[0].className).toBe('bad');
    expect(el.children[0].textContent).toBe('lỗi');
  });

  it('bỏ qua null/undefined và parts không phải mảng', () => {
    const el = fakeEl();
    expect(() => renderParts(el, [null, undefined, 'x'])).not.toThrow();
    expect(() => renderParts(el, null)).not.toThrow();
    expect(() => renderParts(el, 'không phải mảng')).not.toThrow();
    expect(textOf(el)).toBe('x');
  });

  it('không dùng innerHTML (chống XSS từ dữ liệu server)', () => {
    const el = fakeEl();
    renderParts(el, ['<img src=x onerror=alert(1)>']);
    // renderParts chỉ dùng textContent — không bao giờ gán innerHTML
    expect(el.innerHTML).toBeUndefined();
    expect(el.children[0].textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
