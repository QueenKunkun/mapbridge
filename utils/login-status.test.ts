import { describe, expect, it } from 'vitest';
import { readAmapLoginStatus } from './login-status';

describe('readAmapLoginStatus', () => {
  it('recognizes a successful favorites response', () => {
    expect(readAmapLoginStatus({ status: 1 })).toBe(true);
    expect(readAmapLoginStatus({ status: '1' })).toBe(true);
  });

  it('recognizes an unauthorized response', () => {
    expect(readAmapLoginStatus({ status: 0 })).toBe(false);
    expect(readAmapLoginStatus({}, 401)).toBe(false);
  });

  it('leaves malformed responses unknown for DOM fallback', () => {
    expect(readAmapLoginStatus({ data: {} })).toBeUndefined();
  });
});
