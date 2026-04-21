import { ConfigService } from '@nestjs/config';

/** Single source for JwtModule.sign and JwtStrategy.verify — must stay identical. */
export function jwtSecretFromConfig(config: ConfigService): string {
  return config.get<string>('JWT_SECRET') ?? 'changeme-in-production';
}
