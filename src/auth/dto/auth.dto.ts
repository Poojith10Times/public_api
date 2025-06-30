// import { z } from 'zod';
// import { createZodDto } from 'nestjs-zod';
// import { ref } from 'process';

// export const AuthResponseSchema = z.object({
//   access_token: z.string(),
//   // refresh_token: z.string(),
//   user: z.object({
//     id: z.string(),
//     email: z.string(),
//     name: z.string().nullable(),
//     status: z.enum(['ACTIVE', 'INACTIVE']).nullable().optional(),
//   }),
// });

// // export const RefreshTokenRequestSchema = z.object({
// //   refresh_token: z.string(),
// // });

// // export const RefreshTokenResponseSchema = z.object({
// //   access_token: z.string(),
// //   refresh_token: z.string(),
// // });

// export class AuthResponseDto extends createZodDto(AuthResponseSchema) {}
// // export class RefreshTokenRequestDto extends createZodDto(RefreshTokenRequestSchema) {}
// // export class RefreshTokenResponseDto extends createZodDto(RefreshTokenResponseSchema) {}
