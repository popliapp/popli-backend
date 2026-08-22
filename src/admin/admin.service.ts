import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { checkAndProcessReferral } from '../utils/referral.util';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

async login(email: string, passwordString: string) {
    const admin = await this.prisma.user.findFirst({
      where: { email, role: 'ADMIN' },
    });

    if (!admin) {
      const existingAdminsCount = await this.prisma.user.count({
        where: { role: 'ADMIN' },
      });
      if (
        existingAdminsCount === 0 &&
        email === 'admin@popli.com' &&
        passwordString === 'admin123'
      ) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        const newAdmin = await this.prisma.user.create({
          data: {
            name: 'Super Admin',
            username: 'popli_admin',
            email: 'admin@popli.com',
            passwordHash: hashedPassword,
            role: 'ADMIN',
            isVerified: true,
            phone: '+910000000000',
          },
        });
        const token = this.jwtService.sign({ sub: newAdmin.id, role: newAdmin.role });
        return {
          token,
          user: { id: newAdmin.id, name: newAdmin.name, email: newAdmin.email, role: 'super_admin' },
        };
      }

      const partner = await this.prisma.adminPartner.findUnique({ where: { email } });
      if (partner) {
        if (partner.status === 'SUSPENDED') {
          throw new UnauthorizedException('Your account has been suspended. Contact the Super Admin.');
        }
        const isPartnerMatch = await bcrypt.compare(passwordString, partner.passwordHash);
        if (!isPartnerMatch) throw new UnauthorizedException('Invalid credentials');

        await this.prisma.adminPartner.update({
          where: { id: partner.id },
          data: { lastLoginAt: new Date() },
        });

        const token = this.jwtService.sign({
          sub: partner.id,
          isPartner: true,
          permissions: partner.permissions,
        });

        return {
          token,
          user: {
            id: partner.id,
            name: partner.fullName,
            email: partner.email,
            role: 'admin_partner',
            permissions: partner.permissions,
            designation: partner.designation,
          },
        };
      }

      throw new UnauthorizedException('Invalid admin credentials');
    }

    const isMatch = await bcrypt.compare(passwordString, admin.passwordHash || '');
    if (!isMatch) throw new UnauthorizedException('Invalid password');

    const token = this.jwtService.sign({ sub: admin.id, role: admin.role });
    return {
      token,
      user: { id: admin.id, name: admin.name, email: admin.email, role: 'super_admin' },
    };
  }

async getMonetizationSummary(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = admin ? null : await this.prisma.adminPartner.findUnique({ where: { id: adminId } });
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const [
      topEarners,
      pendingWithdrawals,
      totalPaidOut,
      totalPendingAgg,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: 'CREATOR' },
        orderBy: { wallet: { totalEarnings: 'desc' } },
        take: 10,
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          wallet: {
            select: {
              totalEarnings: true,
              coinBalance: true,
              withdrawableBalance: true,
              totalWithdrawn: true,
            },
          },
        },
      }),
this.prisma.withdrawalRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        include: {
          wallet: {
            include: {
              user: {
                select: {
                  name: true,
                  username: true,
                  kycRecord: { select: { upiId: true, bankAccount: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'PENDING' },
        _sum: { amount: true },
      }),
    ]);

    return {
      topEarners: topEarners.map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        avatar: u.avatar,
        totalEarnings: u.wallet?.totalEarnings ?? 0,
        coinBalance: u.wallet?.coinBalance ?? 0,
        withdrawableBalance: u.wallet?.withdrawableBalance ?? 0,
        totalWithdrawn: u.wallet?.totalWithdrawn ?? 0,
      })),
    pendingWithdrawals: pendingWithdrawals.map((w) => ({
        id: w.id,
        creatorName: w.wallet?.user?.name ?? 'Unknown',
        creatorUsername: w.wallet?.user?.username ?? 'unknown',
        amount: w.amount,
        netPayable: w.netPayable,
        tdsDeducted: w.tdsDeducted,
        platformFeeDeducted: w.platformFeeDeducted,
        rupees: w.amount,
        method: w.wallet?.user?.kycRecord?.upiId
          ? `UPI: ${w.wallet.user.kycRecord.upiId}`
          : w.wallet?.user?.kycRecord?.bankAccount
          ? `Bank: ****${w.wallet.user.kycRecord.bankAccount.slice(-4)}`
          : 'No payment method',
        status: w.status.toLowerCase(),
        createdAt: w.createdAt,
      })),
      summary: {
        totalPaidOut: totalPaidOut._sum.amount ?? 0,
        totalPendingAmount: totalPendingAgg._sum.amount ?? 0,
        pendingCount: pendingWithdrawals.length,
      },
    };
  }

async getFeatureFlags(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin
      ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } })
      : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const flags = await this.prisma.platformFeatureFlag.findMany({
      orderBy: { key: 'asc' },
    });

    const result: Record<string, boolean> = {};
    flags.forEach((f) => { result[f.key] = f.enabled; });

    return {
      AI_MODERATION_ENABLED: result['AI_MODERATION_ENABLED'] ?? false,
      AUTO_SHADOW_BAN_ENABLED: result['AUTO_SHADOW_BAN_ENABLED'] ?? false,
      IP_FINGERPRINTING_ENABLED: result['IP_FINGERPRINTING_ENABLED'] ?? false,
      AUTO_PUSH_CHALLENGES_ENABLED: result['AUTO_PUSH_CHALLENGES_ENABLED'] ?? false,
    };
  }

  async updateFeatureFlag(key: string, enabled: boolean, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Only Super Admin can modify feature flags');

    const flag = await this.prisma.platformFeatureFlag.upsert({
      where: { key },
      update: { enabled, updatedBy: adminId },
      create: { key, enabled, updatedBy: adminId },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: `FEATURE_FLAG_${enabled ? 'ENABLED' : 'DISABLED'}`,
        entityType: 'PlatformFeatureFlag',
        entityId: flag.id,
        oldValue: { key, enabled: !enabled },
        newValue: { key, enabled },
      },
    });

    return { key: flag.key, enabled: flag.enabled };
  }

  async getPublicPlatformStats() {
    const [
      totalCreators,
      totalReels,
      suspiciousUsersCount,
      coinRevenue,
    ] = await Promise.all([
      this.prisma.user.count({ where: { role: 'CREATOR' } }),
      this.prisma.reel.count(),
      this.prisma.user.count({ where: { OR: [{ isShadowBanned: true }, { isBlocked: true }] } }),
      this.prisma.transaction.aggregate({
        where: { type: 'COIN_RECHARGE', status: 'SUCCESS' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalCreators,
      totalReels,
      suspiciousUsersBlocked: suspiciousUsersCount,
      totalCoinRevenue: coinRevenue._sum.amount || 0,
    };
  }

  async getReferrals(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const usersWithReferrals = await this.prisma.user.findMany({
      where: { referredById: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        referredById: true,
      }
    });

    const referrerIds = [...new Set(usersWithReferrals.map((u: any) => u.referredById).filter(Boolean))] as string[];
    const referrers = await this.prisma.user.findMany({
      where: { id: { in: referrerIds } },
      select: { id: true, name: true, phone: true }
    });
    
    const referrerMap = new Map(referrers.map((r: any) => [r.id, r]));

    return usersWithReferrals.map((u: any) => ({
      ...u,
      referrer: u.referredById ? referrerMap.get(u.referredById) : null
    }));
  }

async getDashboardStats(adminId: string, city?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const reelWhereClause = city && city !== 'all' ? { city } : {};

    const totalUsers = await this.prisma.user.count({
      where: { role: 'USER' },
    });
const totalCreators = await this.prisma.user.count({
      where: {
        role: { in: ['USER', 'CREATOR'] },
        reels: { some: {} },
      },
    });
    const totalReels = await this.prisma.reel.count();
    const pendingWithdrawals = await this.prisma.transaction.count({
      where: { type: 'WITHDRAWAL', status: 'PENDING' },
    });

const [
      coinsAgg,
      giftAgg,
      totalViewsAgg,
      avgWatchTimeAgg,
      userGrowthRaw,
    ] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { type: 'COIN_RECHARGE', status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: 'GIFT_SEND', status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.reel.aggregate({
        where: reelWhereClause,
        _sum: { viewsCount: true },
      }),
      this.prisma.viewEvent.aggregate({
        _avg: { watchDuration: true },
      }),
      this.prisma.$queryRaw<{ month: string; week: string; count: bigint }[]>`
        SELECT
          TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon') as month,
          TO_CHAR(DATE_TRUNC('week', "createdAt"), 'YYYY-WW') as week,
          COUNT(*)::bigint as count
        FROM "User"
        WHERE "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "createdAt"), DATE_TRUNC('week', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt") ASC
      `,
    ]);

    const botState = await this.prisma.botProtectionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const securityEvents = await this.prisma.securityEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

const avgWatchTimeMs = avgWatchTimeAgg._avg.watchDuration ?? 0;
    const avgWatchTimeMinutes = parseFloat((avgWatchTimeMs / 60000).toFixed(1));

    const monthlyGrowth = userGrowthRaw.reduce<Record<string, number>>((acc, row) => {
      const key = row.month;
      acc[key] = (acc[key] || 0) + Number(row.count);
      return acc;
    }, {});

    const userGrowthData = Object.entries(monthlyGrowth).map(([month, count]) => ({
      name: month,
      users: count,
    }));

    return {
      totalUsers,
      totalCreators,
      totalReels,
      totalViews: totalViewsAgg._sum.viewsCount || 0,
      pendingWithdrawals,
      distributedCoins: coinsAgg._sum.amount || 0,
      giftRevenue: giftAgg._sum.amount || 0,
      avgWatchTime: avgWatchTimeMinutes,
      userGrowthData,
      moodPieData: [],
    viralityAccel: await (async () => {
        const agg = await this.prisma.reel.aggregate({
          _sum: { viewsCount: true, sharesCount: true, commentsCount: true },
        });
        const views = agg._sum.viewsCount || 0;
        if (views === 0) return null;
        const engagement = (agg._sum.sharesCount || 0) + (agg._sum.commentsCount || 0);
        return parseFloat(((engagement / views) * 100).toFixed(1));
      })(),
      botProtection: {
        enabled: botState?.enabled ?? false,
        enabledAt: botState?.enabledAt ?? null,
        enabledBy: botState?.enabledBy ?? null,
      },
      securityEvents: securityEvents.map((e) => ({
        id: e.id,
        type: e.eventType,
        eventType: e.eventType,
        severity: e.severity,
        performedBy: e.performedByName,
        description: e.description,
        region: null,
        status: 'LOGGED',
        createdAt: e.createdAt,
        time: new Date(e.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      })),
    };
  }
  async getPendingKyc() {
    return this.prisma.kYCRecord.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { id: true, username: true, name: true } } },
    });
  }

  async approveKyc(kycId: string, adminId: string) {
    // Basic admin verification
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const kyc = await this.prisma.kYCRecord.update({
      where: { id: kycId },
      data: { status: 'APPROVED', reviewedAt: new Date() },
    });

    // Update user verification badge
    await this.prisma.user.update({
      where: { id: kyc.userId },
      data: { isVerified: true, role: 'CREATOR' },
    });

    checkAndProcessReferral(this.prisma, kyc.userId).catch((err) => {
      console.error('Referral process error on KYC approval', err);
    });

    return { message: 'KYC Approved successfully' };
  }

  async suspendUser(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.user.update({
      where: { id: userId },
      data: { role: 'USER', isVerified: false },
    });
  }

  async deleteReel(reelId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.reel.delete({ where: { id: reelId } });
  }

async getUsers(adminId: string, page = 1, limit = 50) {
  const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
  if (!admin || admin.role !== 'ADMIN')
    throw new UnauthorizedException('Not authorized');
  return this.prisma.user.findMany({
    where: { role: { in: ['USER', 'CREATOR'] } },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      wallet: { select: { totalEarnings: true, coinBalance: true } },
      _count: { select: { reels: true } },
    },
  });
}
async getReels(adminId: string, page = 1, limit = 50) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');
    return this.prisma.reel.findMany({
      include: {
        creator: { select: { username: true, name: true, avatar: true } },
        taggedUsers: { select: { username: true, id: true }, take: 10 },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

async getTransactions(adminId: string, page = 1, limit = 50) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');
    return this.prisma.transaction.findMany({
      include: {
        wallet: {
          include: { user: { select: { username: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async getReports(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');
    return this.prisma.report.findMany({
      include: {
        reporter: { select: { username: true, name: true } },
        reel: {
          select: {
            description: true,
            creator: { select: { username: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTickets(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');
    return this.prisma.supportTicket.findMany({
      include: { creator: { select: { username: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

async getWithdrawals(adminId: string, page = 1, limit = 50) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    return this.prisma.withdrawalRequest.findMany({
      include: {
        wallet: {
          include: {
            user: {
              select: {
                username: true,
                name: true,
                kycRecord: {
                  select: {
                    upiId: true,
                    bankAccount: true,
                    ifscCode: true,
                    fullName: true,
                    isPanVerified: true,
                    isBankLinked: true,
                    isUpiLinked: true,
                  },
                },
              },
            },
          },
        },
      },
    orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

async reviewWithdrawal(reqId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: reqId },
      include: {
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
                phone: true,
                createdAt: true,
                wallet: {
                  select: {
                    withdrawableBalance: true,
                    totalEarnings: true,
                    totalWithdrawn: true,
                  },
                },
                kycRecord: {
                  select: {
                    fullName: true,
                    upiId: true,
                    bankAccount: true,
                    ifscCode: true,
                    isPanVerified: true,
                    isBankLinked: true,
                    isUpiLinked: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!request) throw new BadRequestException('Withdrawal request not found');

    const kyc = request.wallet.user.kycRecord;
    const wallet = request.wallet;

    return {
      id: request.id,
      status: request.status,
      amount: request.amount,
      netPayable: request.netPayable,
      tdsDeducted: request.tdsDeducted,
      platformFeeDeducted: request.platformFeeDeducted,
      idempotencyKey: request.idempotencyKey,
      createdAt: request.createdAt,
      creator: {
        id: wallet.user.id,
        name: wallet.user.name,
        username: wallet.user.username,
        email: wallet.user.email,
        phone: wallet.user.phone,
        createdAt: wallet.user.createdAt,
        availableBalance: wallet.withdrawableBalance,
        totalEarnings: wallet.totalEarnings,
        totalWithdrawn: wallet.totalWithdrawn,
      },
      paymentMethod: kyc?.upiId
        ? { type: 'UPI', upiId: kyc.upiId, verified: kyc.isUpiLinked }
        : kyc?.bankAccount
        ? {
            type: 'BANK',
            accountNumber: `XXXX${kyc.bankAccount.slice(-4)}`,
            ifscCode: kyc.ifscCode,
            verified: kyc.isBankLinked,
          }
        : null,
      kycVerified: kyc?.isPanVerified ?? false,
    };
  }

  async createPaymentDraft(
    reqId: string,
    adminId: string,
    approvedAmount: number,
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    if (!approvedAmount || approvedAmount <= 0) {
      throw new BadRequestException('Approved amount must be greater than 0');
    }

    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: reqId },
      include: { wallet: { include: { user: { include: { kycRecord: true } } } } },
    });

    if (!request) throw new BadRequestException('Withdrawal request not found');
    if (!['PENDING', 'UNDER_REVIEW'].includes(request.status)) {
      throw new BadRequestException(`Cannot create draft for request with status: ${request.status}`);
    }
    if (approvedAmount > request.amount) {
      throw new BadRequestException('Approved amount cannot exceed requested amount');
    }
    if (approvedAmount > request.wallet.withdrawableBalance + request.amount) {
      throw new BadRequestException('Approved amount exceeds creator available balance');
    }

    const kyc = request.wallet.user.kycRecord;
    if (!kyc?.isPanVerified) throw new BadRequestException('Creator KYC is incomplete');
    if (!kyc.upiId && !kyc.bankAccount) throw new BadRequestException('Creator has no verified payment method');

    const tdsPercent = request.tdsDeducted / request.amount;
    const feePercent = request.platformFeeDeducted / request.amount;
    const newTds = Math.round(approvedAmount * tdsPercent * 100) / 100;
    const newFee = Math.round(approvedAmount * feePercent * 100) / 100;
    const newNetPayable = Math.round((approvedAmount - newTds - newFee) * 100) / 100;

    await this.prisma.withdrawalRequest.update({
      where: { id: reqId },
      data: {
        status: 'DRAFT',
        approvedAmount,
        tdsDeducted: newTds,
        platformFeeDeducted: newFee,
        netPayable: newNetPayable,
        processedBy: adminId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'WITHDRAWAL_DRAFT_CREATED',
        entityType: 'WithdrawalRequest',
        entityId: reqId,
        oldValue: { status: request.status, amount: request.amount },
        newValue: { status: 'DRAFT', approvedAmount, netPayable: newNetPayable },
      },
    });

    return {
      withdrawalId: reqId,
      approvedAmount,
      netPayable: newNetPayable,
      tdsDeducted: newTds,
      platformFeeDeducted: newFee,
      paymentMethod: kyc.upiId
        ? { type: 'UPI', upiId: kyc.upiId }
        : { type: 'BANK', accountNumber: `XXXX${kyc.bankAccount!.slice(-4)}`, ifscCode: kyc.ifscCode },
      cashfreeEnvironment: process.env.CASHFREE_ENV || 'sandbox',
    };
  }

  async approveWithdrawal(reqId: string, adminId: string, payoutProvider: any) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: reqId },
      include: { wallet: { include: { user: { include: { kycRecord: true } } } } },
    });

if (!request) throw new BadRequestException('Withdrawal request not found');
    if (request.status !== 'DRAFT') {
      throw new BadRequestException(`Payment can only be sent from DRAFT status. Current: ${request.status}`);
    }
    if (!request.idempotencyKey) throw new BadRequestException('Invalid withdrawal request: missing idempotency key');

    const kyc = request.wallet.user.kycRecord;
    if (!kyc || !kyc.isPanVerified) throw new BadRequestException('Creator KYC is incomplete');
    if (!kyc.upiId && !kyc.bankAccount) throw new BadRequestException('Creator has no verified payment method');

    await this.prisma.withdrawalRequest.update({
      where: { id: reqId },
      data: { status: 'PROCESSING' },
    });

   const payoutAmount = (request as any).approvedAmount ?? request.amount;
    const payoutResult = await payoutProvider.initiatePayout({
      withdrawalId: reqId,
      idempotencyKey: request.idempotencyKey,
      amount: request.netPayable,
      currency: 'INR',
      recipientName: kyc.fullName || request.wallet.user.name,
      upiId: kyc.upiId || undefined,
      bankAccount: kyc.bankAccount || undefined,
      ifscCode: kyc.ifscCode || undefined,
      narration: `Popli creator payout - ${request.wallet.user.username}`,
    });

    if (!payoutResult.success) {
      await this.prisma.withdrawalRequest.update({
        where: { id: reqId },
        data: {
          status: 'FAILED',
          providerResponse: payoutResult.providerResponse,
          processedBy: adminId,
          processedAt: new Date(),
        },
      });

      await this.prisma.wallet.update({
        where: { id: request.walletId },
        data: { withdrawableBalance: { increment: request.amount } },
      });

      await this.prisma.walletLedger.create({
        data: {
          userId: request.wallet.userId,
          walletId: request.walletId,
          source: 'FRAUD_REVERSAL',
          sourceId: reqId,
          credit: request.amount,
          balanceAfter: request.wallet.withdrawableBalance + request.amount,
          description: `Payout failed — refunded ₹${request.amount}: ${payoutResult.errorMessage}`,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_PAYOUT_FAILED',
          entityType: 'WithdrawalRequest',
          entityId: reqId,
          newValue: { error: payoutResult.errorMessage, providerResponse: payoutResult.providerResponse },
        },
      });

      return this.prisma.notification.create({
        data: {
          userId: request.wallet.userId,
          type: 'WITHDRAWAL_FAILED',
          title: 'Withdrawal Failed',
          body: `Your withdrawal of ₹${request.amount} could not be processed. The amount has been refunded to your wallet.`,
        },
      }).catch(() => {}).then(() => ({ success: false, error: payoutResult.errorMessage }));
    }

    const isInstantSuccess = ['processed', 'reversed'].includes(payoutResult.status);

    return this.prisma.$transaction(async (tx) => {
      const currentWallet = await tx.wallet.findUnique({ where: { id: request.walletId } });
      if (!currentWallet) throw new BadRequestException('Wallet not found');

const updatedRequest = await tx.withdrawalRequest.update({
        where: { id: reqId },
        data: {
          status: isInstantSuccess ? 'SUCCESS' : 'PROCESSING',
          payoutId: payoutResult.payoutId,
          cashfreeTransferId: payoutResult.payoutId,
          cashfreeReferenceId: payoutResult.providerResponse?.data?.transfer?.referenceId || null,
          providerResponse: payoutResult.providerResponse,
          processedBy: adminId,
          processedAt: new Date(),
          newBalance: currentWallet.withdrawableBalance,
        },
      });

      if (isInstantSuccess) {
        await tx.wallet.update({
          where: { id: request.walletId },
          data: { totalWithdrawn: { increment: request.amount } },
        });

        await tx.walletLedger.create({
          data: {
            userId: request.wallet.userId,
            walletId: request.walletId,
            source: 'WITHDRAWAL',
            sourceId: reqId,
            debit: 0,
            credit: 0,
            balanceAfter: currentWallet.withdrawableBalance,
            description: `Payout SUCCESS — ₹${request.netPayable} sent via ${kyc.upiId ? 'UPI' : 'Bank'}. Ref: ${payoutResult.payoutId}`,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: isInstantSuccess ? 'WITHDRAWAL_SUCCESS' : 'WITHDRAWAL_PROCESSING',
          entityType: 'WithdrawalRequest',
          entityId: reqId,
          oldValue: { balance: currentWallet.withdrawableBalance },
          newValue: {
            payoutId: payoutResult.payoutId,
            status: payoutResult.status,
            amount: request.netPayable,
          },
        },
      });

      await this.prisma.notification.create({
        data: {
          userId: request.wallet.userId,
          type: isInstantSuccess ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_PROCESSING',
          title: isInstantSuccess ? 'Withdrawal Successful' : 'Withdrawal Processing',
          body: isInstantSuccess
            ? `₹${request.netPayable} has been transferred to your ${kyc.upiId ? 'UPI' : 'bank account'}.`
            : `Your withdrawal of ₹${request.netPayable} is being processed. It will arrive within 24 hours.`,
          metaData: { withdrawalId: reqId, amount: request.netPayable, payoutId: payoutResult.payoutId },
        },
      }).catch(() => {});

      return updatedRequest;
    });
  }

  async rejectWithdrawal(reqId: string, adminId: string, reason: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    if (!reason || reason.trim().length < 5) {
      throw new BadRequestException('A rejection reason of at least 5 characters is mandatory');
    }

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findUnique({
        where: { id: reqId },
        include: { wallet: true },
      });

  if (!request) throw new BadRequestException('Withdrawal request not found');
      if (!['PENDING', 'UNDER_REVIEW', 'DRAFT'].includes(request.status)) {
        throw new BadRequestException(`Cannot reject a request with status: ${request.status}`);
      }

      const wallet = await tx.wallet.update({
        where: { id: request.walletId },
        data: { withdrawableBalance: { increment: request.amount } },
      });

      await tx.walletLedger.create({
        data: {
          userId: wallet.userId,
          walletId: wallet.id,
          source: 'FRAUD_REVERSAL',
          sourceId: reqId,
          credit: request.amount,
          balanceAfter: wallet.withdrawableBalance,
          description: `Withdrawal rejected — ₹${request.amount} refunded. Reason: ${reason}`,
        },
      });

      const updated = await tx.withdrawalRequest.update({
        where: { id: reqId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason.trim(),
          rejectedBy: adminId,
          rejectedAt: new Date(),
          processedBy: adminId,
          processedAt: new Date(),
          newBalance: wallet.withdrawableBalance,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'WITHDRAWAL_REJECTED',
          entityType: 'WithdrawalRequest',
          entityId: reqId,
          oldValue: { status: 'PENDING', balance: wallet.withdrawableBalance - request.amount },
          newValue: { status: 'REJECTED', reason, refundedAmount: request.amount },
        },
      });

      await this.prisma.notification.create({
        data: {
          userId: wallet.userId,
          type: 'WITHDRAWAL_REJECTED',
          title: 'Withdrawal Request Rejected',
          body: `Your withdrawal request of ₹${request.amount} has been rejected. Reason: ${reason}. The amount has been refunded to your wallet.`,
          metaData: { withdrawalId: reqId, amount: request.amount, reason },
        },
      }).catch(() => {});

      return updated;
    });
  }

  async handlePayoutWebhook(rawBody: Buffer | undefined, signature: string | undefined, timestamp: string | undefined) {
    // If Cashfree sends a test ping without signature / empty body during dashboard setup
    if (!rawBody || !signature || !timestamp) {
      return { received: true, message: 'Cashfree Webhook Endpoint Active' };
    }

    const crypto = require('crypto');

    const signatureData = timestamp + rawBody.toString();
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CASHFREE_PAYOUT_CLIENT_SECRET!)
      .update(signatureData)
      .digest('base64');

    if (expectedSignature !== signature) {
      // In case of a test webhook or format difference
      return { received: true, warning: 'Signature mismatch, but acknowledged' };
    }

    let event: any;
    try {
      event = JSON.parse(rawBody.toString());
    } catch {
      return { received: true };
    }

    const transferData = event?.data || event;
    const cfTransferId = transferData?.transfer?.referenceId || transferData?.referenceId;
    const transferId = transferData?.transfer?.transferId || transferData?.transferId;
    const eventType = event?.event || event?.type;

    if (!cfTransferId && !transferId) return { received: true };

    const withdrawalRequest = await this.prisma.withdrawalRequest.findFirst({
      where: {
        OR: [
          cfTransferId ? { cashfreeTransferId: cfTransferId } : undefined,
          transferId ? { cashfreeTransferId: transferId } : undefined,
          transferId ? { idempotencyKey: `TXN_${transferId}` } : undefined,
        ].filter(Boolean) as any,
      },
      include: { wallet: true },
    });

    if (!withdrawalRequest) return { received: true };

    if (
      withdrawalRequest.webhookProcessedAt &&
      ['SUCCESS', 'FAILED', 'REVERSED', 'REJECTED'].includes(withdrawalRequest.status)
    ) {
      return { received: true };
    }

    await this.prisma.withdrawalRequest.update({
      where: { id: withdrawalRequest.id },
      data: { webhookProcessedAt: new Date() },
    });

    if (eventType === 'TRANSFER_SUCCESS' || eventType === 'payout.processed') {
      await this.prisma.$transaction(async (tx) => {
        await tx.withdrawalRequest.update({
          where: { id: withdrawalRequest.id },
          data: {
            status: 'SUCCESS',
            providerResponse: transferData,
            processedAt: new Date(),
          },
        });

        await tx.wallet.update({
          where: { id: withdrawalRequest.walletId },
          data: { totalWithdrawn: { increment: withdrawalRequest.amount } },
        });

        await tx.walletLedger.create({
          data: {
            userId: withdrawalRequest.wallet.userId,
            walletId: withdrawalRequest.walletId,
            source: 'WITHDRAWAL',
            sourceId: withdrawalRequest.id,
            debit: 0,
            credit: 0,
            balanceAfter: withdrawalRequest.wallet.withdrawableBalance,
            description: `Cashfree payout confirmed. Ref: ${cfTransferId || transferId}`,
          },
        });
      });

      await this.prisma.notification.create({
        data: {
          userId: withdrawalRequest.wallet.userId,
          type: 'WITHDRAWAL_APPROVED',
          title: 'Withdrawal Successful',
          body: `₹${withdrawalRequest.netPayable} has been successfully transferred to your account.`,
          metaData: { withdrawalId: withdrawalRequest.id, transferId: cfTransferId || transferId },
        },
      }).catch(() => {});
    }

    if (
      eventType === 'TRANSFER_FAILED' ||
      eventType === 'TRANSFER_REVERSED' ||
      eventType === 'payout.failed' ||
      eventType === 'payout.reversed' ||
      eventType === 'payout.cancelled'
    ) {
      await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.update({
          where: { id: withdrawalRequest.walletId },
          data: { withdrawableBalance: { increment: withdrawalRequest.amount } },
        });

        const newStatus =
          eventType === 'TRANSFER_REVERSED' || eventType === 'payout.reversed'
            ? 'REVERSED'
            : 'FAILED';

        await tx.withdrawalRequest.update({
          where: { id: withdrawalRequest.id },
          data: {
            status: newStatus,
            providerResponse: transferData,
            processedAt: new Date(),
            newBalance: wallet.withdrawableBalance,
          },
        });

        await tx.walletLedger.create({
          data: {
            userId: withdrawalRequest.wallet.userId,
            walletId: withdrawalRequest.walletId,
            source: 'FRAUD_REVERSAL',
            sourceId: withdrawalRequest.id,
            credit: withdrawalRequest.amount,
            balanceAfter: wallet.withdrawableBalance,
            description: `Cashfree payout ${newStatus.toLowerCase()} — ₹${withdrawalRequest.amount} refunded. Ref: ${cfTransferId || transferId}`,
          },
        });
      });

      await this.prisma.notification.create({
        data: {
          userId: withdrawalRequest.wallet.userId,
          type: 'WITHDRAWAL_FAILED',
          title: 'Withdrawal Failed',
          body: `Your withdrawal of ₹${withdrawalRequest.amount} could not be completed. The amount has been returned to your wallet.`,
          metaData: { withdrawalId: withdrawalRequest.id, transferId: cfTransferId || transferId },
        },
      }).catch(() => {});
    }

    if (eventType === 'TRANSFER_PENDING' || eventType === 'payout.queued') {
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: { status: 'PROCESSING', providerResponse: transferData },
      });
    }

    return { received: true };
  }
  async getPaymentProcessList(adminId: string, status?: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const whereClause: any = {};
    if (status && status !== 'ALL') {
      whereClause.status = status;
    } else {
      whereClause.status = { in: ['DRAFT', 'PROCESSING', 'SUCCESS', 'FAILED', 'REVERSED'] };
    }

    const records = await this.prisma.withdrawalRequest.findMany({
      where: whereClause,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        wallet: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                username: true,
                email: true,
                phone: true,
                kycRecord: {
                  select: {
                    upiId: true,
                    bankAccount: true,
                    ifscCode: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return records.map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount,
      approvedAmount: (r as any).approvedAmount,
      netPayable: r.netPayable,
      tdsDeducted: r.tdsDeducted,
      platformFeeDeducted: r.platformFeeDeducted,
      cashfreeTransferId: (r as any).cashfreeTransferId,
      cashfreeReferenceId: (r as any).cashfreeReferenceId,
      payoutId: r.payoutId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      processedAt: r.processedAt,
      creator: {
        id: r.wallet.user.id,
        name: r.wallet.user.name,
        username: r.wallet.user.username,
        email: r.wallet.user.email,
        phone: r.wallet.user.phone,
      },
      paymentMethod: r.wallet.user.kycRecord?.upiId
        ? { type: 'UPI', upiId: r.wallet.user.kycRecord.upiId }
        : r.wallet.user.kycRecord?.bankAccount
        ? { type: 'BANK', accountNumber: `XXXX${r.wallet.user.kycRecord.bankAccount.slice(-4)}` }
        : null,
    }));
  }

  async getPaymentProcessDetail(reqId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: reqId },
      include: {
        wallet: {
          include: {
            user: {
              include: {
                kycRecord: true,
                wallet: {
                  include: {
                    ledgers: {
                      orderBy: { createdAt: 'desc' },
                      take: 50,
                      include: {
                        // reelId available for cross-referencing
                      },
                    },
                    withdrawalRequests: {
                      orderBy: { createdAt: 'desc' },
                      take: 20,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!request) throw new BadRequestException('Payment record not found');

    const user = request.wallet.user;
    const kyc = user.kycRecord;
    const wallet = user.wallet!;

    const viewEarnings = wallet.ledgers
      .filter((l) => l.source === 'VIEW_EARNING')
      .reduce((s, l) => s + l.credit, 0);
    const giftEarnings = wallet.ledgers
      .filter((l) => l.source === 'GIFT_RECEIVED')
      .reduce((s, l) => s + l.credit, 0);

    const reelIds = [...new Set(wallet.ledgers.filter((l) => l.reelId).map((l) => l.reelId!))];
    const reels = reelIds.length
      ? await this.prisma.reel.findMany({
          where: { id: { in: reelIds } },
          select: {
            id: true,
            description: true,
            viewsCount: true,
            likesCount: true,
            commentsCount: true,
            sharesCount: true,
            savesCount: true,
            createdAt: true,
          },
        })
      : [];

    const reelMap = new Map(reels.map((r) => [r.id, r]));

    const earningsByReel = wallet.ledgers
      .filter((l) => l.source === 'VIEW_EARNING' && l.reelId)
      .reduce<Record<string, { reel: any; totalEarning: number; entries: any[] }>>((acc, l) => {
        const key = l.reelId!;
        if (!acc[key]) {
          acc[key] = { reel: reelMap.get(key) || null, totalEarning: 0, entries: [] };
        }
        acc[key].totalEarning += l.credit;
        acc[key].entries.push({
          id: l.id,
          credit: l.credit,
          description: l.description,
          createdAt: l.createdAt,
        });
        return acc;
      }, {});

    const giftLedgerEntries = wallet.ledgers.filter((l) => l.source === 'GIFT_RECEIVED');

    return {
      withdrawalId: request.id,
      status: request.status,
      amount: request.amount,
      approvedAmount: (request as any).approvedAmount,
      netPayable: request.netPayable,
      tdsDeducted: request.tdsDeducted,
      platformFeeDeducted: request.platformFeeDeducted,
      cashfreeTransferId: (request as any).cashfreeTransferId,
      cashfreeReferenceId: (request as any).cashfreeReferenceId,
      payoutId: request.payoutId,
      createdAt: request.createdAt,
      processedAt: request.processedAt,
      creator: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        createdAt: user.createdAt,
        totalEarnings: wallet.totalEarnings,
        withdrawableBalance: wallet.withdrawableBalance,
        totalWithdrawn: wallet.totalWithdrawn,
        viewEarnings,
        giftEarnings,
      },
      paymentMethod: kyc?.upiId
        ? { type: 'UPI', upiId: kyc.upiId, verified: kyc.isUpiLinked }
        : kyc?.bankAccount
        ? {
            type: 'BANK',
            accountNumber: `XXXX${kyc.bankAccount.slice(-4)}`,
            ifscCode: kyc.ifscCode,
            verified: kyc.isBankLinked,
          }
        : null,
      earningsByReel: Object.values(earningsByReel),
      giftTransactions: giftLedgerEntries.map((l) => ({
        id: l.id,
        credit: l.credit,
        description: l.description,
        reelId: l.reelId,
        createdAt: l.createdAt,
      })),
      withdrawalHistory: wallet.withdrawalRequests.map((w) => ({
        id: w.id,
        amount: w.amount,
        netPayable: w.netPayable,
        status: w.status,
        cashfreeTransferId: (w as any).cashfreeTransferId,
        rejectionReason: w.rejectionReason,
        createdAt: w.createdAt,
        processedAt: w.processedAt,
      })),
    };
  }

  // Gifts
  async getGifts() {
    return this.prisma.gift.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

async addGift(data: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const lastGift = await this.prisma.gift.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    return this.prisma.gift.create({
      data: {
        name: data.name,
        costInCoins: data.coinPrice ?? data.costInCoins ?? 0,
        costInINR: data.costInINR ?? 0,
        iconUrl: data.icon ?? data.iconUrl,
        animationType: data.animationType || 'fly',
        isActive: data.isActive ?? true,
        sortOrder: (lastGift?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateGift(giftId: string, data: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.gift.update({
      where: { id: giftId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.coinPrice !== undefined && { costInCoins: data.coinPrice }),
        ...(data.costInCoins !== undefined && { costInCoins: data.costInCoins }),
        ...(data.costInINR !== undefined && { costInINR: data.costInINR }),
        ...(data.icon !== undefined && { iconUrl: data.icon }),
        ...(data.iconUrl !== undefined && { iconUrl: data.iconUrl }),
        ...(data.animationType !== undefined && { animationType: data.animationType }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
  }

  async deleteGift(giftId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.gift.delete({
      where: { id: giftId },
    });
  }

  // System Configs
  async getConfigs(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const configs = await this.prisma.systemConfig.findMany();
    const result: Record<string, any> = {};
    configs.forEach((c) => {
      result[c.key] = c.valueJson;
    });
    return result;
  }

  async updateConfig(key: string, value: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { valueJson: value, updatedBy: adminId },
      create: { key, valueJson: value, updatedBy: adminId },
    });
  }
  async getCoinPackages(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.coinPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async createCoinPackage(data: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const last = await this.prisma.coinPackage.findFirst({
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

 return this.prisma.coinPackage.create({
      data: {
        title: data.title,
        coins: data.coins,
        bonusCoins: data.bonusCoins ?? 0,
        priceInr: data.priceInr,
        badge: data.badge ?? null,
        badgeColor: data.badgeColor ?? null,
        description: data.description ?? null,
        isPopular: data.isPopular ?? false,
        isRecommended: data.isRecommended ?? false,
        isActive: data.isActive ?? true,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
  }

  async updateCoinPackage(packageId: string, data: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

return this.prisma.coinPackage.update({
      where: { id: packageId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.coins !== undefined && { coins: data.coins }),
        ...(data.bonusCoins !== undefined && { bonusCoins: data.bonusCoins }),
        ...(data.priceInr !== undefined && { priceInr: data.priceInr }),
        ...(data.badge !== undefined && { badge: data.badge }),
        ...(data.badgeColor !== undefined && { badgeColor: data.badgeColor }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isPopular !== undefined && { isPopular: data.isPopular }),
        ...(data.isRecommended !== undefined && { isRecommended: data.isRecommended }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
  }
async getEarningSettings(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');

    const keys = ['VIEWS_PER_REWARD', 'REWARD_AMOUNT_PAISE', 'EARNINGS_ENABLED'];
    const rows = await this.prisma.systemConfig.findMany({ where: { key: { in: keys } } });
    const map: Record<string, any> = {};
    rows.forEach((r) => { map[r.key] = r.valueJson; });

 if (map['VIEWS_PER_REWARD'] === undefined) throw new Error('Platform configuration VIEWS_PER_REWARD is not set');
    if (map['REWARD_AMOUNT_PAISE'] === undefined) throw new Error('Platform configuration REWARD_AMOUNT_PAISE is not set');
    if (map['EARNINGS_ENABLED'] === undefined) throw new Error('Platform configuration EARNINGS_ENABLED is not set');

    return {
      viewsPerReward: map['VIEWS_PER_REWARD'],
      rewardAmountPaise: map['REWARD_AMOUNT_PAISE'],
      earningsEnabled: map['EARNINGS_ENABLED'],
    };
  }

  async updateEarningSettings(
    data: { viewsPerReward?: number; rewardAmountPaise?: number; earningsEnabled?: boolean },
    adminId: string,
    redisService: any,
    kafkaProducer: any,
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');

    const updates: Promise<any>[] = [];

    if (data.viewsPerReward !== undefined) {
      updates.push(
        this.prisma.systemConfig.upsert({
          where: { key: 'VIEWS_PER_REWARD' },
          update: { valueJson: data.viewsPerReward, updatedBy: adminId },
          create: { key: 'VIEWS_PER_REWARD', valueJson: data.viewsPerReward, updatedBy: adminId },
        }),
      );
    }

    if (data.rewardAmountPaise !== undefined) {
      updates.push(
        this.prisma.systemConfig.upsert({
          where: { key: 'REWARD_AMOUNT_PAISE' },
          update: { valueJson: data.rewardAmountPaise, updatedBy: adminId },
          create: { key: 'REWARD_AMOUNT_PAISE', valueJson: data.rewardAmountPaise, updatedBy: adminId },
        }),
      );
    }

    if (data.earningsEnabled !== undefined) {
      updates.push(
        this.prisma.systemConfig.upsert({
          where: { key: 'EARNINGS_ENABLED' },
          update: { valueJson: data.earningsEnabled, updatedBy: adminId },
          create: { key: 'EARNINGS_ENABLED', valueJson: data.earningsEnabled, updatedBy: adminId },
        }),
      );
    }

    await Promise.all(updates);

    await redisService.del('platform:earning-config');

    await kafkaProducer.publish('platform-settings-updated', [
      {
        key: 'earning-config',
        value: JSON.stringify({
          event: 'platform-settings-updated',
          updatedBy: adminId,
          timestamp: new Date().toISOString(),
          data,
        }),
      },
    ]);

    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: 'EARNING_SETTINGS_UPDATED',
        entityType: 'SystemConfig',
        entityId: 'earning-settings',
        newValue: data,
      },
    });

    return { success: true, updated: data };
  }

async getPaymentRecords(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    return this.prisma.paymentRecord.findMany({
      where: { status: { in: ['SUCCESS', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        refunds: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  async executeCoinRefund(
    paymentRecordId: string,
    data: { refundType: 'FULL' | 'PARTIAL'; amount?: number; reason: string },
    adminId: string,
  ) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');

    if (!data.reason?.trim()) throw new BadRequestException('Refund reason is required.');
    if (!['FULL', 'PARTIAL'].includes(data.refundType)) throw new BadRequestException('refundType must be FULL or PARTIAL.');

    const paymentRecord = await this.prisma.paymentRecord.findUnique({
      where: { id: paymentRecordId },
      include: {
        refunds: { where: { status: { in: ['PROCESSING', 'COMPLETED'] } } },
      },
    });

    if (!paymentRecord) throw new BadRequestException('Payment record not found.');
    if (!paymentRecord.gatewayPaymentId) throw new BadRequestException('No Gateway payment ID. Cannot process refund.');
    if (!['SUCCESS', 'PARTIALLY_REFUNDED'].includes(paymentRecord.status)) {
      throw new BadRequestException(`Cannot refund a payment with status: ${paymentRecord.status}`);
    }

    const pendingRefund = paymentRecord.refunds.find(r => r.status === 'PROCESSING');
    if (pendingRefund) throw new BadRequestException('A refund is already processing for this payment.');

    const totalAlreadyRefunded = paymentRecord.refunds
      .filter(r => r.status === 'COMPLETED')
      .reduce((s, r) => s + r.amount, 0);

    const remainingRefundable = paymentRecord.amount - totalAlreadyRefunded;
    if (remainingRefundable <= 0) throw new BadRequestException('This payment has already been fully refunded.');

    const refundAmount = data.refundType === 'FULL'
      ? remainingRefundable
      : Math.round(Number(data.amount));

    if (!refundAmount || refundAmount <= 0) throw new BadRequestException('Invalid refund amount.');
    if (refundAmount > remainingRefundable) {
      throw new BadRequestException(`Refund amount ₹${refundAmount} exceeds remaining refundable ₹${remainingRefundable}.`);
    }

    const coinsToDeduct = Math.round((refundAmount / paymentRecord.amount) * paymentRecord.coinsToCredit);

    const refundRecord = await this.prisma.coinRefund.create({
      data: {
        paymentRecordId,
        userId: paymentRecord.userId,
        amount: refundAmount,
        coinsDeducted: coinsToDeduct,
        reason: data.reason.trim(),
        status: 'PROCESSING',
        requestedById: adminId,
      },
    });

    const axios = require('axios');

    try {
      const isProd = process.env.CASHFREE_ENV === 'production';
      const url = isProd ? 'https://api.cashfree.com/pg/orders' : 'https://sandbox.cashfree.com/pg/orders';
      const response = await axios.post(
        `${url}/${paymentRecord.gatewayOrderId}/refunds`,
        {
          refund_amount: refundAmount,
          refund_id: refundRecord.id.substring(0, 40),
          refund_note: data.reason.trim(),
        },
        {
          headers: {
            'x-client-id': process.env.CASHFREE_PG_APP_ID!,
            'x-client-secret': process.env.CASHFREE_PG_SECRET_KEY!,
            'x-api-version': '2023-08-01',
          },
        }
      );

      const cfRefund = response.data;
      const gatewayRefundId = String(cfRefund.cf_refund_id || cfRefund.refund_id);
      const refundStatus = cfRefund.refund_status === 'SUCCESS' ? 'COMPLETED' : 'PROCESSING';
      const totalRefunded = totalAlreadyRefunded + refundAmount;
      const isFullyRefunded = totalRefunded >= paymentRecord.amount;

      await this.prisma.$transaction(async (tx) => {
        await tx.coinRefund.update({
          where: { id: refundRecord.id },
          data: {
            status: refundStatus,
            gatewayRefundId: gatewayRefundId,
            gatewayResponse: JSON.parse(JSON.stringify(cfRefund)),
            processedAt: refundStatus === 'COMPLETED' ? new Date() : undefined,
          },
        });

        await tx.paymentRecord.update({
          where: { id: paymentRecordId },
          data: { status: isFullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });

        const wallet = await tx.wallet.findUnique({ where: { userId: paymentRecord.userId } });
        if (wallet && wallet.coinBalance >= coinsToDeduct) {
          await tx.wallet.update({
            where: { userId: paymentRecord.userId },
            data: { coinBalance: { decrement: coinsToDeduct } },
          });

          await tx.walletLedger.create({
            data: {
              userId: paymentRecord.userId,
              walletId: wallet.id,
              source: 'ADJUSTMENT',
              sourceId: refundRecord.id,
              debit: coinsToDeduct,
              balanceAfter: wallet.coinBalance - coinsToDeduct,
              description: `${coinsToDeduct} coins deducted due to refund of ₹${refundAmount}. Ref: ${gatewayRefundId}`,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: 'COIN_REFUND_EXECUTED',
            entityType: 'CoinRefund',
            entityId: refundRecord.id,
            newValue: {
              paymentRecordId,
              refundAmount,
              coinsDeducted: coinsToDeduct,
              razorpayRefundId: gatewayRefundId,
              reason: data.reason.trim(),
            },
          },
        });
      });

      await this.prisma.notification.create({
        data: {
          userId: paymentRecord.userId,
          type: 'COIN_REFUND_INITIATED',
          title: refundStatus === 'COMPLETED' ? 'Refund Processed' : 'Refund Initiated',
          body: `₹${refundAmount} refund for your coin purchase has been ${refundStatus === 'COMPLETED' ? 'processed' : 'initiated'}. ${coinsToDeduct} coins have been deducted from your wallet. Amount will be credited within 5-7 business days.`,
          metaData: { refundId: refundRecord.id, razorpayRefundId: gatewayRefundId, amount: refundAmount },
        },
      }).catch(() => {});

      return {
        success: true,
        razorpayRefundId: gatewayRefundId,
        status: refundStatus,
        refundAmount,
        coinsDeducted: coinsToDeduct,
        remainingRefundable: remainingRefundable - refundAmount,
        message: refundStatus === 'COMPLETED' ? 'Refund processed successfully.' : 'Refund initiated. Amount will be credited within 5-7 business days.',
      };
    } catch (gatewayErr: any) {
      await this.prisma.coinRefund.update({
        where: { id: refundRecord.id },
        data: {
          status: 'FAILED',
          gatewayResponse: { error: gatewayErr.error || gatewayErr.message },
        },
      });
      const errMsg = gatewayErr.error?.description || gatewayErr.message || 'Gateway refund failed.';
      throw new BadRequestException(`Razorpay refund failed: ${errMsg}`);
    }
  }

  async deleteCoinPackage(packageId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.coinPackage.delete({ where: { id: packageId } });
  }

async getCampaigns(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');
    return this.prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createCampaign(data: any, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');
    return this.prisma.campaign.create({
      data: {
        title: data.title,
        type: data.type,
        status: data.status || 'active',
        targetAudience: data.targetAudience || null,
        targetCity: data.targetCity || null,
        hashtag: data.hashtag || null,
        scheduledTime: data.scheduledTime ? new Date(data.scheduledTime) : null,
        createdBy: adminId,
      },
    });
  }

  async updateCampaignStatus(campaignId: string, status: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');
    return this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status },
    });
  }

  async deleteCampaign(campaignId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN') throw new UnauthorizedException('Not authorized');
    return this.prisma.campaign.delete({ where: { id: campaignId } });
  }

async getAnalytics(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    const partner = !admin ? await this.prisma.adminPartner.findUnique({ where: { id: adminId } }) : null;
    if (!admin && !partner) throw new UnauthorizedException('Not authorized');
    const [
      topReels,
      categoryGroups,
      cityGroups,
      topCreators,
      earningSnapshots,
      topHashtags,
      giftAgg,
      coinAgg,
      withdrawalAgg,
      userGrowthRaw,
    ] = await Promise.all([
      this.prisma.reel.findMany({
        orderBy: { viewsCount: 'desc' },
        take: 10,
        select: {
          id: true,
          description: true,
          viewsCount: true,
          likesCount: true,
          sharesCount: true,
          commentsCount: true,
          category: true,
          createdAt: true,
          creator: { select: { username: true, name: true } },
        },
      }),
      this.prisma.reel.groupBy({
        by: ['category'],
        _count: { id: true },
        _sum: { viewsCount: true, likesCount: true },
        orderBy: { _sum: { viewsCount: 'desc' } },
      }),
      this.prisma.reel.groupBy({
        by: ['city'],
        where: { city: { not: null } },
        _count: { id: true },
        _sum: { viewsCount: true },
        orderBy: { _sum: { viewsCount: 'desc' } },
        take: 8,
      }),
      this.prisma.user.findMany({
        orderBy: { followersCount: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          followersCount: true,
          totalLikesReceived: true,
          _count: { select: { reels: true } },
          wallet: { select: { totalEarnings: true } },
        },
      }),
      this.prisma.earningSnapshot.groupBy({
        by: ['date'],
        _sum: { totalEarnings: true, viewEarnings: true, giftEarnings: true },
        orderBy: { date: 'asc' },
        take: 30,
      }),
      this.prisma.hashtag.findMany({
        orderBy: { usageCount: 'desc' },
        take: 10,
        select: { id: true, name: true, usageCount: true, recentScore: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: 'GIFT_SEND', status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { type: 'COIN_RECHARGE', status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.withdrawalRequest.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
      this.prisma.$queryRaw<{ month: string; count: bigint }[]>`
        SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'Mon') as month,
               COUNT(*)::bigint as count
        FROM "User"
        WHERE "createdAt" >= NOW() - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', "createdAt")
        ORDER BY DATE_TRUNC('month', "createdAt") ASC
      `,
    ]);

    return {
      topReels: topReels.map(r => ({
        id: r.id,
        title: r.description || 'Untitled',
        category: r.category || 'unknown',
        views: r.viewsCount,
        likes: r.likesCount,
        shares: r.sharesCount,
        comments: r.commentsCount,
        creatorUsername: r.creator.username,
        creatorName: r.creator.name,
        createdAt: r.createdAt,
      })),
      categoryBreakdown: categoryGroups.map(g => ({
        category: g.category || 'unknown',
        reelCount: g._count.id,
        totalViews: g._sum.viewsCount || 0,
        totalLikes: g._sum.likesCount || 0,
      })),
      cityBreakdown: cityGroups.map(g => ({
        city: g.city || 'Unknown',
        reelCount: g._count.id,
        totalViews: g._sum.viewsCount || 0,
      })),
      topCreators: topCreators.map(u => ({
        id: u.id,
        name: u.name,
        username: u.username,
        avatar: u.avatar,
        followers: u.followersCount,
        totalLikes: u.totalLikesReceived,
        reelCount: u._count.reels,
        totalEarnings: u.wallet?.totalEarnings || 0,
      })),
      earningsTrend: earningSnapshots.map(e => ({
        date: new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        totalEarnings: e._sum.totalEarnings || 0,
        viewEarnings: e._sum.viewEarnings || 0,
        giftEarnings: e._sum.giftEarnings || 0,
      })),
      topHashtags: topHashtags.map(h => ({
        id: h.id,
        name: h.name,
        usageCount: h.usageCount,
        recentScore: h.recentScore,
      })),
      revenueStats: {
        giftRevenue: giftAgg._sum.amount || 0,
        coinRevenue: coinAgg._sum.amount || 0,
        totalWithdrawn: withdrawalAgg._sum.amount || 0,
      },
      userGrowth: userGrowthRaw.map(r => ({
        month: r.month,
        count: Number(r.count),
      })),
    };
  }

  async getFeedMetrics(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const totalReels = await this.prisma.reel.count();
    const totalViews = await this.prisma.reel.aggregate({ _sum: { viewsCount: true } });
    const totalValidViews = await this.prisma.validView.count();
    const pendingEarningsViews = await this.prisma.reel.aggregate({ _sum: { pendingEarningsViews: true } });
    const activeUsers = await this.prisma.user.count({ where: { role: { in: ['USER', 'CREATOR'] } } });
    const totalReports = await this.prisma.report.count({ where: { status: 'PENDING' } });

    return {
      totalReels,
      totalViews: totalViews._sum.viewsCount || 0,
      totalValidViews,
      pendingEarningsViews: pendingEarningsViews._sum.pendingEarningsViews || 0,
      activeUsers,
      pendingReports: totalReports,
    };
  }

  async getFeedBoosts(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.feedBoost.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFeedBoost(data: { type: string; target: string; intensity: number }, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.feedBoost.create({
      data: {
        type: data.type,
        target: data.target,
        intensity: data.intensity,
        isActive: true,
        createdBy: adminId,
      },
    });
  }

async getFraudStats(adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    const [
      shadowBannedUsers,
      blockedUsers,
      revokedSessions,
      suspiciousIps,
      suspiciousDevices,
      highVolumeViewers,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { isShadowBanned: true },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          city: true,
          createdAt: true,
          earningsFrozen: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),

      this.prisma.user.findMany({
        where: { isBlocked: true },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          city: true,
          createdAt: true,
          earningsFrozen: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),

      this.prisma.session.count({ where: { revoked: true } }),

      this.prisma.session.groupBy({
        by: ['ipAddress'],
        where: {
          ipAddress: { not: null },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 15,
      }),

      this.prisma.session.groupBy({
        by: ['deviceInfo'],
        where: {
          deviceInfo: { not: null },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 15,
      }),

      this.prisma.viewEvent.groupBy({
        by: ['deviceId'],
        where: {
          deviceId: { not: null },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 15,
      }),
    ]);

    const SUSPICIOUS_IP_THRESHOLD = 3;
    const SUSPICIOUS_DEVICE_THRESHOLD = 5;
    const HIGH_VOLUME_VIEW_THRESHOLD = 50;

    return {
      shadowBannedCount: shadowBannedUsers.length,
      blockedCount: blockedUsers.length,
      revokedSessionsCount: revokedSessions,
      suspiciousUsers: [
        ...shadowBannedUsers.map((u) => ({ ...u, flagType: 'shadow_banned' as const })),
        ...blockedUsers.map((u) => ({ ...u, flagType: 'blocked' as const })),
      ],
      suspiciousIps: suspiciousIps
        .filter((s) => s._count.id >= SUSPICIOUS_IP_THRESHOLD)
        .map((s) => ({
          ipAddress: s.ipAddress,
          sessionCount: s._count.id,
          riskLevel: s._count.id >= 10 ? 'critical' : s._count.id >= 5 ? 'high' : 'medium',
        })),
      suspiciousDevices: suspiciousDevices
        .filter((s) => s._count.id >= SUSPICIOUS_DEVICE_THRESHOLD)
        .map((s) => ({
          deviceInfo: s.deviceInfo,
          sessionCount: s._count.id,
          riskLevel: s._count.id >= 20 ? 'critical' : s._count.id >= 10 ? 'high' : 'medium',
        })),
      highVolumeViewers: highVolumeViewers
        .filter((v) => v._count.id >= HIGH_VOLUME_VIEW_THRESHOLD)
        .map((v) => ({
          deviceId: v.deviceId,
          viewCount: v._count.id,
          riskLevel: v._count.id >= 200 ? 'critical' : v._count.id >= 100 ? 'high' : 'medium',
        })),
    };
  }

  async deleteFeedBoost(boostId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.feedBoost.update({
      where: { id: boostId },
      data: { isActive: false },
    });
  }

  async unbanUser(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isBlocked: false },
    });
  }

  async verifyUser(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isVerified: true },
    });
  }

  async removeVerification(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isVerified: false },
    });
  }

  async shadowBanUser(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.user.update({
      where: { id: userId },
      data: { isShadowBanned: true },
    });
  }

  async freezeEarnings(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

  const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.prisma.user.update({
      where: { id: userId },
      data: { earningsFrozen: !user?.earningsFrozen },
    });
  }

  async toggleMonetization(userId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return this.prisma.user.update({
      where: { id: userId },
      data: { isMonetized: !user?.isMonetized },
    });
  }

  async hideReel(reelId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

  const reel = await this.prisma.reel.findUnique({ where: { id: reelId } });
    return this.prisma.reel.update({
      where: { id: reelId },
      data: { privacy: reel?.privacy === 'Private' ? 'Public' : 'Private' },
    });
  }

  async forceTrendReel(reelId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

const reel = await this.prisma.reel.findUnique({ where: { id: reelId } });
    return this.prisma.reel.update({
      where: { id: reelId },
      data: { isTrending: !reel?.isTrending },
    });
  }

  async restrictAgeReel(reelId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

 const reel = await this.prisma.reel.findUnique({ where: { id: reelId } });
    return this.prisma.reel.update({
      where: { id: reelId },
      data: { ageRestricted: !reel?.ageRestricted },
    });
  }

  async disableCommentsReel(reelId: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

const reel = await this.prisma.reel.findUnique({ where: { id: reelId } });
    return this.prisma.reel.update({
      where: { id: reelId },
      data: { allowComments: !reel?.allowComments },
    });
  }

  async resolveReport(reportId: string, action: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    return this.prisma.report.update({
      where: { id: reportId },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }

  async replyToTicket(ticketId: string, message: string, adminId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (!admin || admin.role !== 'ADMIN')
      throw new UnauthorizedException('Not authorized');

    await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId: adminId,
        senderRole: 'ADMIN',
        message,
      },
    });

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'IN_PROGRESS' },
    });
  }
}