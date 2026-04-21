import { mkdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

mkdirSync(join(process.cwd(), 'data'), { recursive: true });
mkdirSync(join(process.cwd(), 'uploads', 'posts'), { recursive: true });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // strip unknown properties
      forbidNonWhitelisted: true,
      transform: true,       // auto-transform payload types (e.g. string → number)
    }),
  );

  // Serve uploaded media as static files: GET /uploads/posts/<filename>
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // Serve downloaded trailers: GET /trailers/<id>.mp4
  app.useStaticAssets(join(process.cwd(), 'public', 'trailers'), { prefix: '/trailers' });

  app.enableCors();

  await app.listen(process.env.PORT ?? 3000);
  console.log(`WatchCue API running on http://localhost:${process.env.PORT ?? 3000}`);
}
bootstrap();
