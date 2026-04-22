import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { UsersService } from '../users/users.service';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './strategies/jwt.strategy';

const SALT_ROUNDS = 12;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectRepository(PasswordResetToken)
    private readonly resetTokenRepo: Repository<PasswordResetToken>,
  ) {}

  async signup(dto: SignupDto) {
    const [existingEmail, existingUsername] = await Promise.all([
      this.usersService.findByEmail(dto.email),
      this.usersService.findByUsername(dto.username),
    ]);

    if (existingEmail) throw new ConflictException('Email is already registered');
    if (existingUsername) throw new ConflictException('Username is already taken');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      username: dto.username,
      displayName: dto.displayName,
      bio: dto.bio ?? null,
      avatarUrl: dto.avatarUrl ?? null,
    });

    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user: this.sanitize(user) };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    const token = this.signToken(user.id, user.email);
    return { accessToken: token, user: this.sanitize(user) };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      return { message: 'If that email is registered you will receive a reset link shortly.' };
    }

    await this.resetTokenRepo.update({ userId: user.id, used: false }, { used: true });

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.resetTokenRepo.save(
      this.resetTokenRepo.create({ userId: user.id, tokenHash, expiresAt }),
    );

    return {
      message: 'If that email is registered you will receive a reset link shortly.',
      resetToken: rawToken,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const candidates = await this.resetTokenRepo.find({
      where: { used: false },
      relations: ['user'],
    });

    let matched: PasswordResetToken | null = null;
    for (const candidate of candidates) {
      if (candidate.expiresAt < new Date()) continue;
      const isMatch = await bcrypt.compare(dto.token, candidate.tokenHash);
      if (isMatch) { matched = candidate; break; }
    }

    if (!matched) throw new NotFoundException('Reset token is invalid or has expired');

    const hashedPassword = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await Promise.all([
      this.usersService.updatePassword(matched.userId, hashedPassword),
      this.resetTokenRepo.update(matched.id, { used: true }),
    ]);

    return { message: 'Password has been reset successfully.' };
  }

  private signToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.jwtService.sign(payload);
  }

  private sanitize(user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    followersCount: number;
    followingCount: number;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      followersCount: user.followersCount,
      followingCount: user.followingCount,
      createdAt: user.createdAt,
    };
  }
}
