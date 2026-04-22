import { BadRequestException } from '@nestjs/common';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import type { Request } from 'express';

const UPLOAD_ROOT = join(process.cwd(), 'uploads', 'posts');
const AVATAR_UPLOAD_ROOT = join(process.cwd(), 'uploads', 'avatars');

// Ensure the directories exist at startup
mkdirSync(UPLOAD_ROOT, { recursive: true });
mkdirSync(AVATAR_UPLOAD_ROOT, { recursive: true });

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;  // 100 MB

export const postMediaMulterOptions = {
  storage: diskStorage({
    destination: UPLOAD_ROOT,
    filename: (_req: Request, file: Express.Multer.File, cb: (err: Error | null, filename: string) => void) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),

  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(
        new BadRequestException(
          `Unsupported file type "${file.mimetype}". Allowed: JPEG, PNG, GIF, WEBP, MP4, MOV, AVI, WEBM.`,
        ),
        false,
      );
    }
    cb(null, true);
  },

  limits: {
    files: 10,              // max 10 files per post
    fileSize: MAX_VIDEO_BYTES, // multer enforces the largest limit; per-type check is in the service
  },
};

/** Build the server-relative URL stored in PostMedia.url */
export function mediaUrl(filename: string): string {
  return `/uploads/posts/${filename}`;
}

/** Avatar uploads — smaller limit, images only, stored at /uploads/avatars/<file>. */
export const avatarMulterOptions = {
  storage: diskStorage({
    destination: AVATAR_UPLOAD_ROOT,
    filename: (
      _req: Request,
      file: Express.Multer.File,
      cb: (err: Error | null, filename: string) => void,
    ) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      cb(null, `${unique}${extname(file.originalname)}`);
    },
  }),

  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(
        new BadRequestException(
          `Unsupported avatar format "${file.mimetype}". Use JPEG, PNG, GIF, or WEBP.`,
        ),
        false,
      );
    }
    cb(null, true);
  },

  limits: {
    files: 1,
    fileSize: MAX_IMAGE_BYTES,
  },
};

export function avatarUrl(filename: string): string {
  return `/uploads/avatars/${filename}`;
}

export function isImage(mimetype: string): boolean {
  return ALLOWED_IMAGE_TYPES.includes(mimetype);
}

export function isVideo(mimetype: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(mimetype);
}

export const MAX_IMAGE_SIZE = MAX_IMAGE_BYTES;
