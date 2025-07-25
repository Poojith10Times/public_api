import { Controller, Put, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { SponsorService } from './services/sponsor.service';
import { SponsorUpsertRequestDto } from './dto/sponsor-upsert-request.dto';
import { SponsorUpsertResponseDto } from './dto/sponsor-upsert-response.dto';
import { UserId } from '../common/Decorators/user-id.decorator';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Sponsor API')
@Controller('v1/sponsor')
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) {}

  @Put('upsert')
  @HttpCode(HttpStatus.OK)
  async upsertSponsor(
    @Body() payload: SponsorUpsertRequestDto,
    @UserId() userId: number,
  ): Promise<SponsorUpsertResponseDto> {
    return this.sponsorService.upsertSponsor(payload, userId);
  }
}