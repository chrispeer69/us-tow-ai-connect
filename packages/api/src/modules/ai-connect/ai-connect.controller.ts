import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  LogInteractionRequestSchema,
  type LogInteractionRequest,
} from '@ustow/shared';
import { ApiKeyGuard, type AuthenticatedRequest } from '../../common/guards/api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AiConnectService } from './ai-connect.service';

@Controller('v1/ai-connect')
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class AiConnectController {
  constructor(private readonly service: AiConnectService) {}

  @Get('transfer-route')
  async getTransferRoute(@Req() req: AuthenticatedRequest) {
    const rule = await this.service.getActiveTransferRoute(req.tenantId);
    return {
      status: 'success',
      data: { transfer_number: rule.phoneNumber, label: rule.ruleName },
    };
  }

  @Post('log-interaction')
  @HttpCode(201)
  @UsePipes(new ZodValidationPipe(LogInteractionRequestSchema))
  async logInteraction(
    @Req() req: AuthenticatedRequest,
    @Body() body: LogInteractionRequest,
  ) {
    await this.service.logInteraction(req.tenantId, body);
    return { status: 'success', message: 'Interaction logged successfully.' };
  }
}
