import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OutboundVoiceService } from './outbound-voice.service';

const DemoCallSchema = z.object({
  mode: z.enum(['explicit', 'live']).optional(),
  scenario: z.enum(['competitor_repair', 'auto_body', 'residence', 'our_shop', 'unknown']).optional(),
  scriptType: z
    .enum(['auto_flip', 'eta_confirmation', 'status_update', 'winch_out', 'convini_only'])
    .optional(),
  toPhone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+0-9 ()\-]+$/, 'invalid phone format'),
  customerName: z.string().max(120).optional().nullable(),
  businessName: z.string().max(120).optional().nullable(),
  vehicle: z.string().max(160).optional().nullable(),
  destination: z.string().max(240).optional().nullable(),
  pickupLocation: z.string().max(240).optional().nullable(),
  motorClub: z.string().max(120).optional().nullable(),
});

type DemoCallBody = z.infer<typeof DemoCallSchema>;

@Controller('v1/public/demo-call')
export class PublicDemoCallController {
  constructor(private readonly service: OutboundVoiceService) {}

  @Get('status')
  async status() {
    return { status: 'success', data: await this.service.publicDemoCallStatus() };
  }

  @Post()
  @HttpCode(200)
  async create(
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
    @Body(new ZodValidationPipe(DemoCallSchema)) body: DemoCallBody,
  ) {
    try {
      return await this.service.publicDemoCall({
        ...body,
        ipKey: publicIpKey(req),
      });
    } catch (err) {
      if (err instanceof Error) {
        throw new BadRequestException({
          status: 'error',
          code: 'PUBLIC_DEMO_CALL_BLOCKED',
          message: err.message,
        });
      }
      throw err;
    }
  }
}

function publicIpKey(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return first?.split(',')[0]?.trim() || req.ip || 'unknown';
}
