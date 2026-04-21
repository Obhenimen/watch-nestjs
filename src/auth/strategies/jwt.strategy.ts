import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { jwtSecretFromConfig } from '../jwt-secret.util';
import { UsersService } from '../../users/users.service';

export interface JwtPayload {
  sub: string; // user id
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    const secret = jwtSecretFromConfig(configService);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
    const fromEnv = !!configService.get<string>('JWT_SECRET');
    this.logger.log(
      `JwtStrategy uses same secret as JwtModule.sign (${fromEnv ? `JWT_SECRET from env, length ${secret.length}` : 'default fallback — set JWT_SECRET in .env'})`,
    );
  }

  /**
   * Runs after the JWT signature is verified and the payload is decoded.
   * Wrapped in try/catch so DB or logic errors surface in logs clearly.
   */
  async validate(payload: JwtPayload) {
    try {
      if (!payload?.sub) {
        this.logger.warn(
          `validate: missing sub in decoded payload: ${JSON.stringify(payload)}`,
        );
        throw new UnauthorizedException('Invalid token payload (missing sub)');
      }

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        this.logger.warn(
          `validate: no user found for JWT sub=${payload.sub} (email in token: ${payload.email ?? 'n/a'})`,
        );
        throw new UnauthorizedException('User no longer exists');
      }

      return user;
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      const stack = e instanceof Error ? e.stack : undefined;
      this.logger.error(
        `validate: unexpected error while resolving user for JWT: ${msg}`,
        stack,
      );
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
