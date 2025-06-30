// import { z } from 'zod';
// import { createZodDto } from 'nestjs-zod';

// // Registration Schema
// export const RegisterUserSchema = z.object({
//   email: z.string().email('Invalid email format'),
//   name: z.string().min(2, 'Name must be at least 2 characters').optional(),
//   password: z.string().min(6, 'Password must be at least 6 characters'),
// });

// // Login Schema
// export const LoginUserSchema = z.object({
//   email: z.string().email('Invalid email format'),
//   password: z.string().min(1, 'Password is required'),
// });

// // Response Schema
// export const UserResponseSchema = z.object({
//   id: z.string(),
//   email: z.string(),
//   name: z.string().nullable(),
//   status: z.enum(['ACTIVE', 'INACTIVE']).nullable(),
//   created_at: z.date(),
//   updated_at: z.date(),
// });

// // DTOs
// export class RegisterUserDto extends createZodDto(RegisterUserSchema) {}
// export class LoginUserDto extends createZodDto(LoginUserSchema) {}
// export class UserResponseDto extends createZodDto(UserResponseSchema) {}