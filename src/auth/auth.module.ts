// import { Module } from '@nestjs/common';
// import { JwtModule } from '@nestjs/jwt';
// import { PassportModule } from '@nestjs/passport';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import { AuthService } from './auth.service';
// import { AuthController } from './auth.controller';
// import { UserModule } from '../user/user.module';
// import { JwtStrategy } from './strategies/jwt.strategy';
// import { JwtAuthGuard } from './guards/jwt-auth.guard';

// @Module({
//   imports: [
//     UserModule,
//     PassportModule,
//     JwtModule.registerAsync({
//       imports: [ConfigModule],
//       useFactory: async (configService: ConfigService) => ({
//         secret: configService.get<string>('JWT_SECRET'),
//         signOptions: {
//           expiresIn: configService.get<string>('JWT_EXPIRES_IN'),
//         },
//       }),
//       inject: [ConfigService],
//     }),
//   ],
//   providers: [AuthService, JwtStrategy, JwtAuthGuard],
//   controllers: [AuthController],
//   exports: [AuthService, JwtAuthGuard],
// })
// export class AuthModule {}