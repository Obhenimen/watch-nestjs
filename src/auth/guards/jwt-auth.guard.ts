import {
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest<TUser>(
    err: Error | undefined,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;

    const infoMessage = this.formatInfo(info);

    if (err || !user) {
      this.logger.warn(
        `JWT auth failed | ${req.method} ${req.url} | err=${err?.message ?? '(none)'} | info=${infoMessage} | passportStatus=${status ?? '(none)'}`,
      );
      if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
        this.logger.warn(
          `Bearer token received from client (full JWT):\n${auth.slice(7).trim()}`,
        );
      } else {
        this.logger.warn(
          `Authorization header: ${auth === undefined ? '(missing)' : JSON.stringify(auth)}`,
        );
      }
      throw new UnauthorizedException(
        infoMessage || err?.message || 'Unauthorized',
      );
    }

    this.logger.debug(
      `JWT ok | ${req.method} ${req.url} | userId=${(user as { id?: string }).id}`,
    );
    return user as TUser;
  }

  private formatInfo(info: unknown): string {
    if (info instanceof Error) return info.message;
    if (typeof info === 'string') return info;
    if (info && typeof info === 'object' && 'message' in info) {
      return String((info as { message: unknown }).message);
    }
    if (info !== undefined && info !== null && info !== '') {
      try {
        return JSON.stringify(info);
      } catch {
        return String(info);
      }
    }
    return '(none)';
  }
}
