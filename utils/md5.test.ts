import { describe, expect, it } from 'vitest';
import { md5, md5Join } from '@/utils/md5';

describe('md5', () => {
  it('matches known vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('hello world')).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  it('handles CJK + 中文', () => {
    expect(md5('国际城市设计产业中心')).toHaveLength(32);
  });

  it('md5Join reproduces the verified AMap favorite id', () => {
    // 参考项目: md5(point_x + "+" + point_y + "+" + name)
    const id = md5Join(['211796584', '110201320', '国际城市设计产业中心']);
    expect(id).toBe('6b2f0669cc26713c5b4e3e529006364c');
  });
});