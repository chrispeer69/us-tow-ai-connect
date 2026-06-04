import { ArgumentMetadata, BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodError, ZodTypeAny } from 'zod';

export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'body') {
      return value;
    }
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        status: 'error',
        code: 'VALIDATION_ERROR',
        errors: this.formatErrors(result.error),
      });
    }
    return result.data;
  }

  private formatErrors(err: ZodError): { path: string; message: string }[] {
    return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  }
}
