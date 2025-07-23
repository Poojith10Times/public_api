import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { VisitorService } from './services/visitor.service';
import { VisitorRegistrationDto } from './dto/visitor-registration.dto';
import { VisitorRegistrationResponseDto } from './dto/visitor-registration-response.dto';
import { ApiTags } from '@nestjs/swagger';
import { UserId } from '../common/Decorators/user-id.decorator';
import { Source } from '../common/Decorators/source.decorator';

@ApiTags('Visitor API')
@Controller('v1/visitor')
export class VisitorController {
  constructor(private readonly visitorService: VisitorService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Body() visitorRegistrationDto: VisitorRegistrationDto,
    @UserId() userId: number,
    @Source() source: string,
  ): Promise<VisitorRegistrationResponseDto> {
    return this.visitorService.register(visitorRegistrationDto, userId, source);
  }
}