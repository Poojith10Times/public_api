import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const Source = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const source = request.headers['source'];
    
    if (!source) {
      throw new BadRequestException('Source is required in header (source)');
    }
    
    return source;
  },
);