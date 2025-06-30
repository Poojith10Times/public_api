// import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
// import { PassportStrategy } from '@nestjs/passport';
// import { ExtractJwt, Strategy } from 'passport-jwt';
// import { ConfigService } from '@nestjs/config';
// import { PrismaService } from '../../prisma/prisma.service';

// export interface JwtPayload {
//   sub: string;
//   email: string;
//   iat?: number;
//   exp?: number;
// }

// @Injectable()
// export class JwtStrategy extends PassportStrategy(Strategy) {

//   constructor(
//     private configService: ConfigService,
//     private prisma: PrismaService,
//   ) {
//     const jwtSecret = configService.get<string>('JWT_SECRET');
//     if (!jwtSecret) {
//       throw new Error('JWT_SECRET is not defined in environment variables');
//     }
//     super({
//       jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
//       ignoreExpiration: false,
//       secretOrKey: jwtSecret,
//     });
//   }

//   async validate(payload: JwtPayload) {
//     const userId = payload.sub;
//     const cacheKey = `user:${userId}`;
    
//     const user = await this.prisma.user.findUnique({
//       where: { id: payload.sub },
//       select: {
//         id: true,
//         email: true,
//         name: true,
//         status: true,
//       },
//     });

//     // console.log('User found in DB:', user);

//     if (!user || user.status === 'INACTIVE') {
//       // console.log('User validation failed:', { user, status: user?.status });
//       throw new UnauthorizedException('User not found or inactive');
//     }

//     const result = {
//       id: user.id.toString(),
//       email: user.email,
//       name: user.name,
//       status: user.status,
//     };

//     // console.log('Returning user object:', result);
//     return result;
//   }
// }