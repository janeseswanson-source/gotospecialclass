import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlurValidation } from './useBlurValidation';

describe('useBlurValidation', () => {
  it('hides errors until a field is touched', () => {
    const { result } = renderHook(() => useBlurValidation());
    // Untouched → no error shown even if one exists.
    expect(result.current.errorFor('name', 'Required')).toBeNull();
    act(() => result.current.touch('name'));
    expect(result.current.errorFor('name', 'Required')).toBe('Required');
  });

  it('shows null when there is no error, even after touch', () => {
    const { result } = renderHook(() => useBlurValidation());
    act(() => result.current.touch('name'));
    expect(result.current.errorFor('name', null)).toBeNull();
    expect(result.current.errorFor('name', undefined)).toBeNull();
  });

  it('touchAll marks every listed field at once', () => {
    const { result } = renderHook(() => useBlurValidation());
    act(() => result.current.touchAll(['a', 'b']));
    expect(result.current.errorFor('a', 'x')).toBe('x');
    expect(result.current.errorFor('b', 'y')).toBe('y');
    expect(result.current.errorFor('c', 'z')).toBeNull(); // not touched
  });

  it('touch is idempotent (no error thrown on repeat)', () => {
    const { result } = renderHook(() => useBlurValidation());
    act(() => { result.current.touch('a'); result.current.touch('a'); });
    expect(result.current.touched.a).toBe(true);
  });
});
