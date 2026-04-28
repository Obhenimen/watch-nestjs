import { BadRequestException } from '@nestjs/common';
import {
  isImage,
  isVideo,
  mediaUrl,
  avatarUrl,
  postMediaMulterOptions,
  avatarMulterOptions,
  MAX_IMAGE_SIZE,
} from './multer.config';

describe('multer.config helpers', () => {
  describe('isImage / isVideo', () => {
    it.each([
      ['image/jpeg', true],
      ['image/png', true],
      ['image/gif', true],
      ['image/webp', true],
      ['image/bmp', false],
      ['video/mp4', false],
      ['text/plain', false],
    ])('isImage(%s) === %s', (mime, expected) => {
      expect(isImage(mime)).toBe(expected);
    });

    it.each([
      ['video/mp4', true],
      ['video/quicktime', true],
      ['video/x-msvideo', true],
      ['video/webm', true],
      ['video/ogg', false],
      ['image/png', false],
    ])('isVideo(%s) === %s', (mime, expected) => {
      expect(isVideo(mime)).toBe(expected);
    });
  });

  describe('URL builders', () => {
    it('mediaUrl prefixes the post-media path', () => {
      expect(mediaUrl('abc.png')).toBe('/uploads/posts/abc.png');
    });

    it('avatarUrl prefixes the avatar path', () => {
      expect(avatarUrl('abc.png')).toBe('/uploads/avatars/abc.png');
    });
  });

  describe('MAX_IMAGE_SIZE', () => {
    it('is exactly 10 MB', () => {
      expect(MAX_IMAGE_SIZE).toBe(10 * 1024 * 1024);
    });
  });

  describe('postMediaMulterOptions.fileFilter', () => {
    function runFilter(mimetype: string): { err: Error | null; accepted: boolean } {
      let result: { err: Error | null; accepted: boolean } = { err: null, accepted: false };
      const cb = (err: Error | null, accept: boolean) => {
        result = { err, accepted: accept };
      };
      // The filter signature is (req, file, cb).
      postMediaMulterOptions.fileFilter(
        {} as never,
        { mimetype } as never,
        cb,
      );
      return result;
    }

    it('accepts a png', () => {
      const r = runFilter('image/png');
      expect(r.err).toBeNull();
      expect(r.accepted).toBe(true);
    });

    it('accepts an mp4', () => {
      const r = runFilter('video/mp4');
      expect(r.err).toBeNull();
      expect(r.accepted).toBe(true);
    });

    it('rejects an executable masquerading as a file', () => {
      const r = runFilter('application/octet-stream');
      expect(r.err).toBeInstanceOf(BadRequestException);
      expect(r.accepted).toBe(false);
    });
  });

  describe('avatarMulterOptions.fileFilter', () => {
    function runFilter(mimetype: string): { err: Error | null; accepted: boolean } {
      let result: { err: Error | null; accepted: boolean } = { err: null, accepted: false };
      const cb = (err: Error | null, accept: boolean) => {
        result = { err, accepted: accept };
      };
      avatarMulterOptions.fileFilter(
        {} as never,
        { mimetype } as never,
        cb,
      );
      return result;
    }

    it('rejects videos for avatars (images only)', () => {
      const r = runFilter('video/mp4');
      expect(r.err).toBeInstanceOf(BadRequestException);
      expect(r.accepted).toBe(false);
    });

    it('accepts a png avatar', () => {
      const r = runFilter('image/png');
      expect(r.err).toBeNull();
      expect(r.accepted).toBe(true);
    });
  });
});
