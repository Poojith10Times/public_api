import { Controller, Post, Body, HttpStatus, HttpCode, Put, Get } from '@nestjs/common';
import { EventService } from './Services/event.service';
import { CreateEventRequestDto } from './dto/create-event-request.dto';
import { CreateEventResponseDto } from './dto/create-event-response.dto';
import { ApiTags } from '@nestjs/swagger';
import { EventUpsertRequestDto } from './dto/upsert-event-request.dto';
import { EventUpsertResponseDto } from './dto/upsert-event-response.dto';
import { UserId } from '../common/Decorators/user-id.decorator';


@ApiTags('Add Event API')
@Controller('v1/event')
export class EventController {
  constructor(
    private readonly eventService: EventService,
  ) {}

  @Post('add')
  @HttpCode(HttpStatus.OK)
  async addEvent(@Body() createEventDto: CreateEventRequestDto,@UserId() userId: number, req: any): Promise<CreateEventResponseDto> {
    return this.eventService.createEvent(createEventDto, userId, req);
  }

  @Put('upsert')
  async upsertEvent(@Body() eventData: EventUpsertRequestDto,@UserId() userId: number): Promise<EventUpsertResponseDto> {
    return this.eventService.upsertEvent(eventData, userId);
  }
}