import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const TokenUserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): number | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const tokenUserId = request.headers['token-user-id'];
    
    if (!tokenUserId) {
      return undefined;
    }
    
    const parsedUserId = parseInt(tokenUserId, 10);
    return isNaN(parsedUserId) ? undefined : parsedUserId;
  },
);