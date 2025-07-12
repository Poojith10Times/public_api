import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

export const UserId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest();
    const userId = request.headers['user-id'];
    
    if (!userId) {
      throw new BadRequestException('User ID is required in header (user-id)');
    }
    
    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId)) {
      throw new BadRequestException('User ID must be a valid number');
    }
    
    return parsedUserId;
  },
);