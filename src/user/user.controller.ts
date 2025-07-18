import { Controller, Post, Body, HttpStatus, HttpCode } from '@nestjs/common';
import { UserService } from './services/user.service';
import { UserUpsertRequestDto } from './dto/user-upsert-request.dto';
import { UserUpsertResponseDto } from './dto/user-upsert-response.dto';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('User API')
@Controller('v1/user')
export class UserController {
  constructor(
    private readonly userService: UserService,
  ) {}

  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  async upsertUser(@Body() userData: UserUpsertRequestDto): Promise<UserUpsertResponseDto> {
    return this.userService.upsertUser(userData);
  }
}