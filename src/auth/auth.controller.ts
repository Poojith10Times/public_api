// import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
// import { AuthService } from './auth.service';
// import { RegisterUserDto, LoginUserDto } from '../user/dto/user.dto';
// import { AuthResponseDto } from './dto/auth.dto';
// import { JwtAuthGuard } from './guards/jwt-auth.guard';

// @Controller('auth')
// export class AuthController {
//   constructor(private authService: AuthService) {}

//   @Post('register')
//   @HttpCode(HttpStatus.CREATED)
//   async register(@Body() registerDto: RegisterUserDto): Promise<AuthResponseDto> {
//     return this.authService.register(registerDto);
//   }

//   @Post('login')
//   @HttpCode(HttpStatus.OK)
//   async login(@Body() loginDto: LoginUserDto): Promise<AuthResponseDto> {
//     return this.authService.login(loginDto);
//   }

//   // @Post('refresh')
//   // @HttpCode(HttpStatus.OK)
//   // async refreshToken(@Body() refreshDto: RefreshTokenRequestDto): Promise<RefreshTokenResponseDto> {
//   //   return this.authService.refreshToken(refreshDto);
//   // }

//   // @Post('logout')
//   // @UseGuards(JwtAuthGuard)
//   // @HttpCode(HttpStatus.OK)
//   // async logout(@Request() req): Promise<{ message: string }> {
//   //   await this.authService.logout(req.user.id);
//   //   return { message: 'Logged out successfully' };
//   // }
// }