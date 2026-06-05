import { describe, expect, it } from 'vitest';
import {
  IpcChannel,
  FsPickDirectoryPayloadSchema,
  FsPickDirectoryResponseSchema,
  FsPathExistsPayloadSchema,
  FsPathExistsResponseSchema,
} from '@awakon/contracts';

describe('fs IPC channels', () => {
  it('exposes the new channel names', () => {
    expect(IpcChannel.FsPickDirectory).toBe('core.fs.pick-directory');
    expect(IpcChannel.FsPathExists).toBe('core.fs.path-exists');
  });
});

describe('FsPickDirectoryPayloadSchema', () => {
  it('accepts an empty object (startPath is optional)', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a string startPath', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({ startPath: '/foo' }).success).toBe(true);
  });

  it('rejects a non-string startPath', () => {
    expect(FsPickDirectoryPayloadSchema.safeParse({ startPath: 5 }).success).toBe(false);
  });
});

describe('FsPickDirectoryResponseSchema', () => {
  it('accepts { path: string }', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({ path: '/foo' }).success).toBe(true);
  });

  it('accepts { cancelled: true }', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({ cancelled: true }).success).toBe(true);
  });

  it('rejects other shapes', () => {
    expect(FsPickDirectoryResponseSchema.safeParse({}).success).toBe(false);
    expect(FsPickDirectoryResponseSchema.safeParse({ cancelled: false }).success).toBe(false);
  });
});

describe('FsPathExistsPayloadSchema', () => {
  it('accepts a non-empty path', () => {
    expect(FsPathExistsPayloadSchema.safeParse({ path: '/foo' }).success).toBe(true);
  });

  it('rejects an empty path', () => {
    expect(FsPathExistsPayloadSchema.safeParse({ path: '' }).success).toBe(false);
  });
});

describe('FsPathExistsResponseSchema', () => {
  it('accepts { exists, isDirectory } booleans', () => {
    expect(FsPathExistsResponseSchema.safeParse({ exists: true,  isDirectory: true  }).success).toBe(true);
    expect(FsPathExistsResponseSchema.safeParse({ exists: false, isDirectory: false }).success).toBe(true);
  });

  it('rejects missing keys', () => {
    expect(FsPathExistsResponseSchema.safeParse({ exists: true }).success).toBe(false);
  });
});
