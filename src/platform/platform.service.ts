import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export const EARNING_CONFIG_CACHE_KEY = 'platform:earning-config';
const MEMORY_CACHE_TTL_MS = 60_000; // 60 seconds

export interface EarningConfig {
  viewsPerReward: number;
  rewardAmountPaise: number;
  earningsEnabled: boolean;
  minWatchDurationMs: number;
}

export interface WithdrawalConfig {
  minWithdrawalInr: number;
  tdsPercentage: number;
  platformFeePercentage: number;
}
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  private memoryCache: EarningConfig | null = null;
  private memoryCacheExpiresAt: number = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getEarningConfig(): Promise<EarningConfig> {
    // Layer 1 — memory cache
    if (this.memoryCache && Date.now() < this.memoryCacheExpiresAt) {
      return this.memoryCache;
    }

    // Layer 2 — Redis
    const cached = await this.redis.get(EARNING_CONFIG_CACHE_KEY);
    if (cached) {
      const config = JSON.parse(cached) as EarningConfig;
      this.memoryCache = config;
      this.memoryCacheExpiresAt = Date.now() + MEMORY_CACHE_TTL_MS;
      return config;
    }

    // Layer 3 — PostgreSQL
    return this.loadAndCacheEarningConfig();
  }

  async getWithdrawalConfig(): Promise<WithdrawalConfig> {
    const [minRow, tdsRow, feeRow] = await Promise.all([
      this.prisma.systemConfig.findUnique({ where: { key: 'MIN_WITHDRAWAL_INR' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'TDS_PERCENTAGE' } }),
      this.prisma.systemConfig.findUnique({ where: { key: 'PLATFORM_FEE_PERCENTAGE' } }),
    ]);

    const minWithdrawalInr = typeof minRow?.valueJson === 'number' ? minRow.valueJson : 100;
    const tdsPercentage = typeof tdsRow?.valueJson === 'number' ? tdsRow.valueJson : 10;
    const platformFeePercentage = typeof feeRow?.valueJson === 'number' ? feeRow.valueJson : 5;

    // Auto-seed missing keys
    if (!minRow) await this.upsertConfig('MIN_WITHDRAWAL_INR', minWithdrawalInr);
    if (!tdsRow) await this.upsertConfig('TDS_PERCENTAGE', tdsPercentage);
    if (!feeRow) await this.upsertConfig('PLATFORM_FEE_PERCENTAGE', platformFeePercentage);

    return {
      minWithdrawalInr,
      tdsPercentage,
      platformFeePercentage,
    };
  }

  async loadAndCacheEarningConfig(): Promise<EarningConfig> {
    const [viewsPerRewardRow, rewardAmountPaiseRow, earningsEnabledRow, minWatchDurationRow] =
      await Promise.all([
        this.prisma.systemConfig.findUnique({ where: { key: 'VIEWS_PER_REWARD' } }),
        this.prisma.systemConfig.findUnique({ where: { key: 'REWARD_AMOUNT_PAISE' } }),
        this.prisma.systemConfig.findUnique({ where: { key: 'EARNINGS_ENABLED' } }),
        this.prisma.systemConfig.findUnique({ where: { key: 'MIN_WATCH_DURATION_MS' } }),
      ]);

    const viewsPerReward = typeof viewsPerRewardRow?.valueJson === 'number' ? viewsPerRewardRow.valueJson : 200;
    const rewardAmountPaise = typeof rewardAmountPaiseRow?.valueJson === 'number' ? rewardAmountPaiseRow.valueJson : 100;
    const earningsEnabled = typeof earningsEnabledRow?.valueJson === 'boolean' ? earningsEnabledRow.valueJson : true;
    const minWatchDurationMs = typeof minWatchDurationRow?.valueJson === 'number' ? minWatchDurationRow.valueJson : 10000;

    // Auto-seed missing keys
    if (!viewsPerRewardRow) await this.upsertConfig('VIEWS_PER_REWARD', viewsPerReward);
    if (!rewardAmountPaiseRow) await this.upsertConfig('REWARD_AMOUNT_PAISE', rewardAmountPaise);
    if (!earningsEnabledRow) await this.upsertConfig('EARNINGS_ENABLED', earningsEnabled);
    if (!minWatchDurationRow) await this.upsertConfig('MIN_WATCH_DURATION_MS', minWatchDurationMs);

    const config: EarningConfig = {
      viewsPerReward,
      rewardAmountPaise,
      earningsEnabled,
      minWatchDurationMs,
    };

    await this.redis.set(EARNING_CONFIG_CACHE_KEY, JSON.stringify(config));
    this.logger.log(`Earning config cached: ${JSON.stringify(config)}`);
    return config;
  }

async upsertConfig(key: string, value: any): Promise<void> {
    await this.prisma.systemConfig.upsert({
      where: { key },
      create: { key, valueJson: value },
      update: { valueJson: value },
    });
  }

  async invalidateEarningConfigCache(): Promise<void> {
    this.memoryCache = null;
    this.memoryCacheExpiresAt = 0;
    await this.redis.del(EARNING_CONFIG_CACHE_KEY);
  }
}