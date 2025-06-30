// import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
// import { PrismaService } from '../prisma/prisma.service';
// import { RegisterUserDto, UserResponseDto } from './dto/user.dto';
// import * as bcrypt from 'bcryptjs';

// @Injectable()
// export class UserService {
//   constructor(private prisma: PrismaService) {}

//   async createUser(data: RegisterUserDto): Promise<UserResponseDto> {
//     // Check if user already exists
//     const existingUser = await this.prisma.user.findUnique({
//       where: { email: data.email },
//     });

//     if (existingUser) {
//       throw new ConflictException('User with this email already exists');
//     }

//     // Hash password
//     const hashedPassword = await bcrypt.hash(data.password, 12);

//     // Create user
//     const user = await this.prisma.user.create({
//       data: {
//         email: data.email,
//         name: data.name,
//         password_hash: hashedPassword,
//         status: 'ACTIVE',
//       },
//     });

//     return this.transformUser(user);
//   }

//   async findByEmail(email: string) {
//     return this.prisma.user.findUnique({
//       where: { email },
//     });
//   }

//   async findById(id: string) {
//     const user = await this.prisma.user.findUnique({
//       where: { id },
//     });

//     if (!user) {
//       throw new NotFoundException('User not found');
//     }

//     return this.transformUser(user);
//   }

//   async validatePassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
//     return bcrypt.compare(plainPassword, hashedPassword);
//   }

//   private transformUser(user: any): UserResponseDto {
//     return {
//       id: user.id.toString(),
//       email: user.email,
//       name: user.name,
//       status: user.status,
//       created_at: user.created_at,
//       updated_at: user.updated_at,
//     };
//   }
// }