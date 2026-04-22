import { mkdirSync } from 'fs';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

mkdirSync(join(process.cwd(), 'data'), { recursive: true });
mkdirSync(join(process.cwd(), 'uploads', 'posts'), { recursive: true });
mkdirSync(join(process.cwd(), 'uploads', 'avatars'), { recursive: true });

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.useStaticAssets(join(process.cwd(), 'public', 'trailers'), { prefix: '/trailers' });
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WatchCue API')
    .setDescription('Movie/TV social platform — hubs, posts, comments, lists, notifications.')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addTag('Auth', 'Signup, login, password reset')
    .addTag('Users', 'Profiles, follows')
    .addTag('Hubs', 'Title hubs (movies/series), follow, discovery')
    .addTag('Posts', 'Create, feed, like, repost, delete')
    .addTag('Comments', 'Threads, replies, likes')
    .addTag('Lists', 'Watchlist, watched, favorites, custom lists')
    .addTag('Notifications', 'Activity inbox and unread count')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`WatchCue API running on http://localhost:${port}`);
  console.log(`Swagger UI:           http://localhost:${port}/docs`);
}
bootstrap();
