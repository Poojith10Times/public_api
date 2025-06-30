// import { Injectable, UnauthorizedException } from '@nestjs/common';
// import { JwtService } from '@nestjs/jwt';
// import { UserService } from '../user/user.service';
// import { RegisterUserDto, LoginUserDto } from '../user/dto/user.dto';
// import { AuthResponseDto } from './dto/auth.dto';
// import { JwtPayload } from './strategies/jwt.strategy';
// import { ConfigService } from '@nestjs/config';
// import { PrismaService } from 'src/prisma/prisma.service';

// @Injectable()
// export class AuthService {
//   constructor(
//     private userService: UserService,
//     private jwtService: JwtService,
//     private configService: ConfigService,
//     private prisma: PrismaService,
//   ) {}

//   async register(data: RegisterUserDto): Promise<AuthResponseDto> {
//     const user = await this.userService.createUser(data);
//     const tokens = await this.generateTokens(user.id, user.email);

//     return {
//       access_token: tokens.access_token,
//       // refresh_token: tokens.refresh_token, 
//       user: {
//         id: user.id,
//         email: user.email,
//         name: user.name
//       },
//     };
//   }

//   async login(data: LoginUserDto): Promise<AuthResponseDto> {
//     const user = await this.userService.findByEmail(data.email);

//     if (!user || !user.password_hash) {
//       throw new UnauthorizedException('Invalid credentials');
//     }

//     const isPasswordValid = await this.userService.validatePassword(
//       data.password,
//       user.password_hash,
//     );

//     if (!isPasswordValid) {
//       throw new UnauthorizedException('Invalid credentials');
//     }

//     if (user.status === 'INACTIVE') {
//       throw new UnauthorizedException('Account is inactive');
//     }

//     const tokens = await this.generateTokens(user.id.toString(), user.email);

//     return {
//       access_token: tokens.access_token,
//       // refresh_token: tokens.refresh_token,
//       user: {
//         id: user.id.toString(),
//         email: user.email,
//         name: user.name,
//       },
//     };
//   }

//   // async refreshToken(data: RefreshTokenRequestDto): Promise<RefreshTokenResponseDto> {
//   //   const { refresh_token } = data;

//   //   try {
//   //     // First, verify the JWT signature and decode payload
//   //     const payload = await this.jwtService.verifyAsync(refresh_token, {
//   //       secret: this.configService.get<string>('JWT_SECRET'),
//   //     });

//   //     // Find the refresh token in database
//   //     const tokenRecord = await this.prisma.apiToken.findUnique({
//   //       where: { 
//   //         token: refresh_token,
//   //         is_active: true,
//   //       },
//   //       include: {
//   //         user: true,
//   //       },
//   //     });

//   //     if (!tokenRecord) {
//   //       throw new UnauthorizedException('Invalid or expired refresh token');
//   //     }

//   //     // Check if user is still active
//   //     if (tokenRecord.user.status === 'INACTIVE') {
//   //       throw new UnauthorizedException('User account is inactive');
//   //     }

//   //     // Verify the payload matches the stored user
//   //     if (payload.sub !== tokenRecord.user.id) {
//   //       throw new UnauthorizedException('Token user mismatch');
//   //     }

//   //     // Generate new tokens
//   //     const tokens = await this.generateTokens(
//   //       tokenRecord.user.id,
//   //       tokenRecord.user.email,
//   //       tokenRecord.id, // Pass existing token ID to update it
//   //     );

//   //     return {
//   //       access_token: tokens.access_token,
//   //       refresh_token: tokens.refresh_token,
//   //     };

//   //   } catch (error) {
//   //     // JWT verification failed or other error
//   //     if (error.name === 'TokenExpiredError') {
//   //       // Clean up expired token from DB
//   //       await this.cleanupExpiredToken(refresh_token);
//   //       throw new UnauthorizedException('Refresh token has expired');
//   //     } else if (error.name === 'JsonWebTokenError') {
//   //       throw new UnauthorizedException('Invalid refresh token');
//   //     } else {
//   //       // Re-throw UnauthorizedException from our checks
//   //       throw error;
//   //     }
//   //   }
//   // }

//   // async logout(userId: string): Promise<void> {
//   //   // Deactivate all refresh tokens for this user
//   //   await this.prisma.apiToken.updateMany({
//   //     where: { 
//   //       user_id: userId,
//   //       is_active: true,
//   //     },
//   //     data: { is_active: false },
//   //   });
//   // }

// private async generateTokens(userId: string, email: string, existingTokenId?: string) {
//   const payload: JwtPayload = {
//     sub: userId,
//     email: email,
//   };

//   // Generate access token
//   const access_token = await this.jwtService.signAsync(payload, {
//     expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN', '30d'),
//   });

//   // const refresh_token = await this.jwtService.signAsync(payload, {
//   //   expiresIn: this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '30d'),
//   // });

//   // return { access_token, refresh_token };
//   return { access_token };
// }

//   // private getRefreshTokenMaxAge(): number {
//   //   // 30 days in milliseconds
//   //   return 30 * 24 * 60 * 60 * 1000;
//   // }

//   //  async validateRefreshToken(token: string): Promise<boolean> {
//   //   const tokenRecord = await this.prisma.apiToken.findUnique({
//   //     where: { 
//   //       token,
//   //       is_active: true,
//   //     },
//   //   });

//   //   if (!tokenRecord) {
//   //     return false;
//   //   }

//   //   const refreshTokenAge = Date.now() - tokenRecord.created_at.getTime();
//   //   const maxAge = this.getRefreshTokenMaxAge();
    
//   //   return refreshTokenAge <= maxAge;
//   // }

//   // private async cleanupExpiredToken(token: string): Promise<void> {
//   //   // Deactivate expired token in database
//   //   await this.prisma.apiToken.updateMany({
//   //     where: { token },
//   //     data: { is_active: false },
//   //   });
//   // }


// }
