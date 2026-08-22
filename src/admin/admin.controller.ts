import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
  Body,
  Delete,
  Headers,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import { RedisService } from '../redis/redis.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { Inject } from '@nestjs/common';
import type { PayoutProvider } from '../payout/payout-provider.interface';

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly redisService: RedisService,
    private readonly kafkaProducer: KafkaProducerService,
    @Inject('PAYOUT_PROVIDER') private readonly payoutProvider: PayoutProvider,
  ) {}

  @Post('auth/login')
  @ApiOperation({ summary: 'Admin Login' })
  login(@Body() body: any) {
    return this.adminService.login(body.email, body.password);
  }

@Get('public/platform-stats')
  @ApiOperation({ summary: 'Public platform stats for login page (no auth required)' })
  getPublicPlatformStats() {
    return this.adminService.getPublicPlatformStats();
  }

  @Get('feature-flags')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all platform feature flags' })
  getFeatureFlags(@Req() req: any) {
    return this.adminService.getFeatureFlags(req.user.id);
  }

  @Patch('feature-flags/:key')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enable or disable a platform feature flag' })
  updateFeatureFlag(
    @Param('key') key: string,
    @Body() body: { enabled: boolean },
    @Req() req: any,
  ) {
    return this.adminService.updateFeatureFlag(key, body.enabled, req.user.id);
  }
@Get('dashboard-stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Dashboard Statistics' })
  getDashboardStats(@Req() req: any, @Query('city') city?: string) {
    return this.adminService.getDashboardStats(req.user.id, city);
  }

  @Get('referrals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Referrals' })
  getReferrals(@Req() req: any) {
    return this.adminService.getReferrals(req.user.id);
  }

  @Get('kyc/pending')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all pending KYC applications' })
  getPendingKyc(@Req() req: any) {
    return this.adminService.getPendingKyc();
  }

  @Post('kyc/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a KYC application' })
  approveKyc(@Param('id') kycId: string, @Req() req: any) {
    return this.adminService.approveKyc(kycId, req.user.id);
  }

  @Post('users/:id/suspend')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Suspend a user account' })
  suspendUser(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.suspendUser(userId, req.user.id);
  }

  @Post('reels/:id/delete')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a reported reel' })
  deleteReel(@Param('id') reelId: string, @Req() req: any) {
    return this.adminService.deleteReel(reelId, req.user.id);
  }

@Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users' })
  getUsers(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getUsers(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 50);
  }

@Get('reels')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all reels' })
  getReels(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getReels(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 50);
  }

@Get('transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all transactions' })
  getTransactions(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getTransactions(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 50);
  }

  @Get('reports')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all moderation reports' })
  getReports(@Req() req: any) {
    return this.adminService.getReports(req.user.id);
  }

  @Get('tickets')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all support tickets' })
  getTickets(@Req() req: any) {
    return this.adminService.getTickets(req.user.id);
  }

@Get('withdrawals')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all withdrawal requests' })
  getWithdrawals(@Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.getWithdrawals(req.user.id, page ? parseInt(page) : 1, limit ? parseInt(limit) : 50);
  }
@Get('withdrawals/:id/review')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get full withdrawal request detail for admin review' })
  reviewWithdrawal(@Param('id') reqId: string, @Req() req: any) {
    return this.adminService.reviewWithdrawal(reqId, req.user.id);
  }

  @Post('withdrawals/:id/draft')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin selects approved amount and creates payment draft' })
  createPaymentDraft(
    @Param('id') reqId: string,
    @Body('approvedAmount') approvedAmount: number,
    @Req() req: any,
  ) {
    return this.adminService.createPaymentDraft(reqId, req.user.id, approvedAmount);
  }

  @Post('withdrawals/:id/send')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin confirms and sends Cashfree payout from DRAFT state' })
  approveWithdrawal(@Param('id') reqId: string, @Req() req: any) {
    return this.adminService.approveWithdrawal(reqId, req.user.id, this.payoutProvider);
  }

  @Post('withdrawals/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a withdrawal request (reason mandatory)' })
  rejectWithdrawal(
    @Param('id') reqId: string,
    @Body('reason') reason: string,
    @Req() req: any,
  ) {
    return this.adminService.rejectWithdrawal(reqId, req.user.id, reason);
  }

  @Post('withdrawals/cashfree-webhook')
  @Post('withdrawals/payout-webhook')
  @Get('withdrawals/cashfree-webhook')
  @Get('withdrawals/payout-webhook')
  @ApiOperation({ summary: 'Cashfree payout webhook — verified by signature + timestamp' })
  handlePayoutWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-webhook-signature') signature?: string,
    @Headers('x-webhook-timestamp') timestamp?: string,
  ) {
    return this.adminService.handlePayoutWebhook(req.rawBody, signature, timestamp);
  }

  @Get('payment-process')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payment process list (DRAFT, PROCESSING, SUCCESS, FAILED, REVERSED)' })
  getPaymentProcessList(@Req() req: any, @Query('status') status?: string) {
    return this.adminService.getPaymentProcessList(req.user.id, status);
  }

  @Get('payment-process/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get full payment process detail with earnings breakdown' })
  getPaymentProcessDetail(@Param('id') reqId: string, @Req() req: any) {
    return this.adminService.getPaymentProcessDetail(reqId, req.user.id);
  }
  // Gifts
  @Get('gifts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all premium gifts' })
  getGifts() {
    return this.adminService.getGifts();
  }

  @Post('gifts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new premium gift' })
  addGift(@Body() body: any, @Req() req: any) {
    return this.adminService.addGift(body, req.user.id);
  }

@Patch('gifts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a premium gift' })
  updateGift(@Param('id') giftId: string, @Body() body: any, @Req() req: any) {
    return this.adminService.updateGift(giftId, body, req.user.id);
  }

  @Delete('gifts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a premium gift' })
  deleteGift(@Param('id') giftId: string, @Req() req: any) {
    return this.adminService.deleteGift(giftId, req.user.id);
  }

  // System Configs
  @Get('configs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all system configs' })
  getConfigs(@Req() req: any) {
    return this.adminService.getConfigs(req.user.id);
  }

@Post('configs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a system config' })
  updateConfig(@Body() body: { key: string; value: any }, @Req() req: any) {
    return this.adminService.updateConfig(body.key, body.value, req.user.id);
  }

  // Coin Packages
  @Get('coin-packages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all coin packages' })
  getCoinPackages(@Req() req: any) {
    return this.adminService.getCoinPackages(req.user.id);
  }

  @Post('coin-packages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a coin package' })
  createCoinPackage(@Body() body: any, @Req() req: any) {
    return this.adminService.createCoinPackage(body, req.user.id);
  }

  @Patch('coin-packages/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a coin package' })
  updateCoinPackage(
    @Param('id') packageId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.adminService.updateCoinPackage(packageId, body, req.user.id);
  }

@Delete('coin-packages/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a coin package' })
  deleteCoinPackage(@Param('id') packageId: string, @Req() req: any) {
    return this.adminService.deleteCoinPackage(packageId, req.user.id);
  }

@Get('campaigns')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all campaigns' })
  getCampaigns(@Req() req: any) {
    return this.adminService.getCampaigns(req.user.id);
  }

  @Post('campaigns')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a campaign' })
  createCampaign(@Body() body: any, @Req() req: any) {
    return this.adminService.createCampaign(body, req.user.id);
  }

  @Patch('campaigns/:id/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update campaign status' })
  updateCampaignStatus(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.adminService.updateCampaignStatus(id, body.status, req.user.id);
  }

  @Delete('campaigns/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a campaign' })
  deleteCampaign(@Param('id') id: string, @Req() req: any) {
    return this.adminService.deleteCampaign(id, req.user.id);
  }

  @Get('analytics') 
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform analytics' })
  getAnalytics(@Req() req: any) {
    return this.adminService.getAnalytics(req.user.id);
  }

  @Get('feed-metrics')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get real-time feed pipeline metrics' })
  getFeedMetrics(@Req() req: any) {
    return this.adminService.getFeedMetrics(req.user.id);
  }

  @Get('feed-boosts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active feed boosts' })
  getFeedBoosts(@Req() req: any) {
    return this.adminService.getFeedBoosts(req.user.id);
  }

  @Post('feed-boosts')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new feed boost' })
  createFeedBoost(@Body() body: any, @Req() req: any) {
    return this.adminService.createFeedBoost(body, req.user.id);
  }

@Delete('feed-boosts/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate a feed boost' })
  deleteFeedBoost(@Param('id') boostId: string, @Req() req: any) {
    return this.adminService.deleteFeedBoost(boostId, req.user.id);
  }

@Get('fraud-stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get real fraud and security statistics' })
  getFraudStats(@Req() req: any) {
    return this.adminService.getFraudStats(req.user.id);
  }

@Get('monetization-summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get monetization summary: top earners, pending withdrawals, totals' })
  getMonetizationSummary(@Req() req: any) {
    return this.adminService.getMonetizationSummary(req.user.id);
  }

  @Get('payment-records')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all successful coin purchase payment records' })
  getPaymentRecords(@Req() req: any) {
    return this.adminService.getPaymentRecords(req.user.id);
  }

  @Post('payment-records/:id/refund')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execute a coin purchase refund via Cashfree' })
  executeCoinRefund(
    @Param('id') paymentRecordId: string,
    @Body() body: { refundType: 'FULL' | 'PARTIAL'; amount?: number; reason: string },
    @Req() req: any,
  ) {
    return this.adminService.executeCoinRefund(paymentRecordId, body, req.user.id);
  }
  @Post('users/:id/unban')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Unban a user' })
  unbanUser(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.unbanUser(userId, req.user.id);
  }

  @Post('users/:id/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify a user' })
  verifyUser(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.verifyUser(userId, req.user.id);
  }

  @Post('users/:id/remove-verification')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove verification from a user' })
  removeVerification(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.removeVerification(userId, req.user.id);
  }

  @Post('users/:id/shadowban')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Shadow ban a user' })
  shadowBanUser(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.shadowBanUser(userId, req.user.id);
  }

  @Post('users/:id/freeze-earnings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle earnings freeze for a user' })
  freezeEarnings(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.freezeEarnings(userId, req.user.id);
  }

  @Patch('users/:id/monetization')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle monetization for a user' })
  toggleMonetization(@Param('id') userId: string, @Req() req: any) {
    return this.adminService.toggleMonetization(userId, req.user.id);
  }

  @Post('reels/:id/hide')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle reel visibility' })
  hideReel(@Param('id') reelId: string, @Req() req: any) {
    return this.adminService.hideReel(reelId, req.user.id);
  }

  @Post('reels/:id/force-trend')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle force trending on a reel' })
  forceTrendReel(@Param('id') reelId: string, @Req() req: any) {
    return this.adminService.forceTrendReel(reelId, req.user.id);
  }

  @Post('reels/:id/restrict-age')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle age restriction on a reel' })
  restrictAgeReel(@Param('id') reelId: string, @Req() req: any) {
    return this.adminService.restrictAgeReel(reelId, req.user.id);
  }

  @Post('reels/:id/disable-comments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle comments on a reel' })
  disableCommentsReel(@Param('id') reelId: string, @Req() req: any) {
    return this.adminService.disableCommentsReel(reelId, req.user.id);
  }

  @Patch('reports/:id/resolve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolve a moderation report' })
  resolveReport(@Param('id') reportId: string, @Body() body: any, @Req() req: any) {
    return this.adminService.resolveReport(reportId, body.action, req.user.id);
  }

@Post('tickets/:id/reply')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reply to a support ticket' })
  replyToTicket(@Param('id') ticketId: string, @Body() body: any, @Req() req: any) {
    return this.adminService.replyToTicket(ticketId, body.message, req.user.id);
  }

  @Get('platform/earning-settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get earning configuration settings' })
  getEarningSettings(@Req() req: any) {
    return this.adminService.getEarningSettings(req.user.id);
  }

  @Patch('platform/earning-settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update earning configuration — updates DB, Redis cache, and broadcasts via Kafka' })
  updateEarningSettings(@Body() body: any, @Req() req: any) {
    return this.adminService.updateEarningSettings(
      body,
      req.user.id,
      this.redisService,
      this.kafkaProducer,
    );
  }
}