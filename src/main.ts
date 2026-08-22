import './instrument';
import 'dotenv/config';
import * as admin from 'firebase-admin';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as dns from 'dns';
import { HttpExceptionFilter } from './http-exception.filter';

// Force Node.js to use Google DNS to bypass broken Hotspot IPv6 DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';

import helmet from 'helmet';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';
import { PlatformService } from './platform/platform.service';

async function bootstrap() {
 
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });

    console.log('Firebase Admin initialized successfully.');
  }


  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  app.use(helmet());

  
  app.use(
    '/wallet/recharge/webhook',
    require('express').raw({
      type: 'application/json',
    }),
  );

  app.use(
    '/admin/withdrawals/cashfree-webhook',
    require('express').raw({
      type: 'application/json',
    }),
  );

  app.use(
    '/admin/withdrawals/payout-webhook',
    require('express').raw({
      type: 'application/json',
    }),
  );

  app.enableCors({
    origin: true,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Bypass-Tunnel-Reminder',
    ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

 
  const config = new DocumentBuilder()
    .setTitle('Popli API')
    .setDescription('The Popli backend API documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(
    app,
    config,
  );

  SwaggerModule.setup(
    'api/docs',
    app,
    document,
  );

  
  await app.listen(
    process.env.PORT ?? 3000,
    '0.0.0.0',
  );

  console.log(
    `Popli backend started on port ${process.env.PORT ?? 3000}`,
  );

  await syncRedisOnStartup(app);
}

async function syncRedisOnStartup(app: any) {
  const logger = {
    log: (message: string) =>
      console.log(`[StartupSync] ${message}`),
  };

  try {
    const prisma = app.get(PrismaService);
    const redis = app.get(RedisService);
    const platformService = app.get(PlatformService);

    logger.log('Checking Redis client...');

    const redisClient = redis.getClient();

    if (!redisClient) {
      throw new Error(
        'Redis client was not initialized.',
      );
    }

    if (redisClient.status !== 'ready') {
      logger.log(
        `Redis is not ready yet. Current status: ${redisClient.status}`,
      );

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();

          reject(
            new Error(
              `Redis connection timeout. Current status: ${redisClient.status}`,
            ),
          );
        }, 15000);

        const cleanup = () => {
          clearTimeout(timeout);

          redisClient.off(
            'ready',
            onReady,
          );

          redisClient.off(
            'error',
            onError,
          );
        };

        const onReady = () => {
          cleanup();
          resolve();
        };

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        redisClient.once(
          'ready',
          onReady,
        );

        redisClient.once(
          'error',
          onError,
        );
      });
    }

    logger.log(
      `Redis ready. Status: ${redisClient.status}`,
    );
  
    await platformService.loadAndCacheEarningConfig();

    logger.log(
      'Platform earning config warmed into Redis',
    );

    const viewCounts =
      await prisma.reelViewCount.findMany({
        select: {
          reelId: true,
          totalViews: true,
        },
      });

    for (const vc of viewCounts) {
      const key = `reel:view-count:${vc.reelId}`;

      const existing =
        await redis.get(key);

      const existingVal = existing
        ? parseInt(existing, 10)
        : 0;

      const dbVal = Number(
        vc.totalViews,
      );

      if (dbVal > existingVal) {
        await redis.set(
          key,
          dbVal.toString(),
        );
      }
    }

    logger.log(
      `Redis warmed: ${viewCounts.length} reel view counts restored`,
    );
  } catch (err: any) {
    
    console.error(
      `[StartupSync] Failed: ${
        err?.message ?? err
      }`,
    );

    console.error(
      '[StartupSync] Error details:',
      err,
    );
  }
}


bootstrap();