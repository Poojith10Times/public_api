// import { Controller, Get, UseGuards, Request } from '@nestjs/common';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { UserService } from './user.service';
// import { UserResponseDto } from './dto/user.dto';

// @Controller('user')
// export class UserController {
//   constructor(private userService: UserService) {}

//   @Get('profile')
//   @UseGuards(JwtAuthGuard)
//   async getProfile(@Request() req): Promise<UserResponseDto> {
//     return this.userService.findById(req.user.id);
//   }
// }