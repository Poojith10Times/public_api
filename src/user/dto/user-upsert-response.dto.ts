// import { createZodDto } from 'nestjs-zod';
// import { z } from 'zod';

// export const UserDataSchema = z.object({
//   id: z.number(),
//   name: z.string().nullable(),
//   email: z.string().nullable(),
//   phone: z.string().nullable(),
//   userCompany: z.string().nullable(),
//   designation: z.string().nullable(),
//   city: z.union([z.string(), z.number()]).nullable(),
//   country: z.union([z.string(), z.number()]).nullable(),
//   cityName: z.string().nullable(),
//   countryName: z.string().nullable(),
//   stateName: z.string().nullable(),
//   place_id: z.string().nullable(), // camelcase
//   cityUrl: z.string().nullable(),
//   countryUrl: z.string().nullable(),
//   profilepicture: z.string(),
//   about: z.string().nullable(),
//   website: z.string().nullable(),
  
//   // Social media URLs
//   facebookid: z.string(),
//   linkedinid: z.string(),
//   googleid: z.string(),
//   twitterid: z.string(),
  
//   // Verification status
//   verified: z.number(),
//   emailVerified: z.number(),
//   phoneVerified: z.number(),
//   phoneVerified_completed: z.string().nullable(), // phoneVerifiedDate
//   profileVerified: z.string().nullable(), 
//   firstVerified: z.number(),
  
//   // Phone validation
//   number_valid: z.object({
//     numberType: z.number().optional(),
//     isValid: z.boolean(),
//     internationalFormat: z.string(),
//     countryCode: z.number(),
//     nationalFormat: z.union([z.string(), z.number()]),
//   }),
//   numberValid: z.boolean(),
//   countryCode: z.string(),
//   starPhone: z.string(),
//   hasPhone: z.number(),
  
//   // Email validation
//   emailValid: z.string(),
  
//   // Profile completion
//   complete_on: z.number(),
//   profileComplete: z.number(),
//   profileScore: z.number().nullable(),
  
//   // Missing data analysis
//   missingData: z.object({
//     name: z.number(),
//     place_id: z.number(),
//     userCompany: z.number(),
//     designation: z.number(),
//     phoneNumber: z.number(),
//   }),
  
//   // System fields
//   lastActive: z.string().nullable(),
//   profile_page: z.number().nullable(),
//   membership: z.number().nullable(),
//   spamFlag: z.number().nullable(),
//   hasPassword: z.boolean(),
//   userExists: z.number(),
//   user_created: z.string(),
// });

// // Response status schema
// export const UserResponseStatusSchema = z.object({
//   code: z.number(),
//   message: z.array(z.string()).optional(),
//   error_message: z.array(z.string()).optional(),
// });

// export const UserUpsertResponseSchema = z.object({
//   status: UserResponseStatusSchema.optional(),
//   id: z.number().optional(),
//   name: z.string().nullable().optional(),
//   email: z.string().nullable().optional(),
//   phone: z.string().nullable().optional(),
//   userCompany: z.string().nullable().optional(),
//   designation: z.string().nullable().optional(),
//   city: z.union([z.string(), z.number()]).nullable().optional(),
//   country: z.union([z.string(), z.number()]).nullable().optional(),
//   cityName: z.string().nullable().optional(),
//   countryName: z.string().nullable().optional(),
//   stateName: z.string().nullable().optional(),
//   place_id: z.string().nullable().optional(),
//   cityUrl: z.string().nullable().optional(),
//   countryUrl: z.string().nullable().optional(),
//   profilepicture: z.string().optional(),
//   about: z.string().nullable().optional(),
//   website: z.string().nullable().optional(),
//   facebookid: z.string().optional(),
//   linkedinid: z.string().optional(),
//   googleid: z.string().optional(),
//   twitterid: z.string().optional(),
//   verified: z.number().optional(),
//   emailVerified: z.number().optional(),
//   phoneVerified: z.number().optional(),
//   phoneVerified_completed: z.string().nullable().optional(),
//   profileVerified: z.string().nullable().optional(),
//   firstVerified: z.number().optional(),
//   number_valid: z.object({
//     numberType: z.number().optional(),
//     isValid: z.boolean(),
//     internationalFormat: z.string(),
//     countryCode: z.number(),
//     nationalFormat: z.union([z.string(), z.number()]),
//   }).optional(),
//   numberValid: z.boolean().optional(),
//   countryCode: z.string().optional(),
//   starPhone: z.string().optional(),
//   hasPhone: z.number().optional(),
//   emailValid: z.string().optional(),
//   complete_on: z.number().optional(),
//   profileComplete: z.number().optional(),
//   profileScore: z.number().nullable().optional(),
//   missingData: z.object({
//     name: z.number(),
//     place_id: z.number(),
//     userCompany: z.number(),
//     designation: z.number(),
//     phoneNumber: z.number(),
//   }).optional(),
//   lastActive: z.string().nullable().optional(),
//   profile_page: z.number().nullable().optional(),
//   membership: z.number().nullable().optional(),
//   spamFlag: z.number().nullable().optional(),
//   hasPassword: z.boolean().optional(),
//   userExists: z.number().optional(),
//   user_created: z.string().optional(),
// });

// export class UserUpsertResponseDto extends createZodDto(UserUpsertResponseSchema) {}


// export const WrappedUserResponseSchema = z.object({
//   status: UserResponseStatusSchema,
//   data: z.array(UserUpsertResponseSchema),
// });

// export class WrappedUserResponseDto extends createZodDto(WrappedUserResponseSchema) {}

// export const createUserSuccessResponse = (user: any): WrappedUserResponseDto => {
//   return {
//     status: {
//       code: 1,
//     },
//     data: [user],
//   };
// };



// export const createUserErrorResponse = (messages: string[]): UserUpsertResponseDto => {
//   return {
//     status: {
//       code: 0,
//       message: messages,
//     },
//   };
// };

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const UserDataSchema = z.object({
  id: z.number(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  userCompany: z.string().nullable(),
  designation: z.string().nullable(),
  about: z.string().nullable(),
  website: z.string().nullable(),
  
  // Location info
  city: z.union([z.string(), z.number()]).nullable(),
  country: z.union([z.string(), z.number()]).nullable(),
  cityName: z.string().nullable(),
  countryName: z.string().nullable(),
  stateName: z.string().nullable(),
  placeId: z.string().nullable(), 
  cityUrl: z.string().nullable(),
  countryUrl: z.string().nullable(),
  
  // Profile media
  profilePicture: z.string(), 
  
  // Social media URLs
  facebookId: z.string(), 
  linkedinId: z.string(), 
  googleId: z.string(), 
  twitterId: z.string(), 
  
  // Verification status
  verified: z.number(),
  emailVerified: z.number(),
  phoneVerified: z.number(),
  phoneVerifiedDate: z.string().nullable(), 
  profileVerified: z.string().nullable(),
  firstVerified: z.number(),
  
  // Phone validation details
  numberValid: z.object({
    numberType: z.number().optional(),
    isValid: z.boolean(),
    internationalFormat: z.string(),
    countryCode: z.number(),
    nationalFormat: z.union([z.string(), z.number()]),
  }),
  isNumberValid: z.boolean(), 
  countryCode: z.string(),
  maskedPhone: z.string(), 
  hasPhone: z.number(),
  
  // Email validation
  isEmailValid: z.string(), 
  
  // Profile completion status
  isCompleteProfile: z.number(), 
  profileComplete: z.number(),
  profileScore: z.number().nullable(),
  
  // Missing data analysis
  missingData: z.object({
    name: z.number(),
    placeId: z.number(), 
    userCompany: z.number(),
    designation: z.number(),
    phoneNumber: z.number(),
  }),
  
  // System fields
  lastActive: z.string().nullable(),
  profilePage: z.number().nullable(), 
  membership: z.number().nullable(),
  spamFlag: z.number().nullable(),
  hasPassword: z.boolean(),
  userExists: z.number(),
  userCreated: z.string(), 
});

// Response status schema
export const UserResponseStatusSchema = z.object({
  code: z.number(),
  message: z.array(z.string()).optional(),
  errorMessage: z.array(z.string()).optional(), // Fixed camelCase
});

// Main response schema - simplified and focused
export const UserUpsertResponseSchema = z.object({
  status: UserResponseStatusSchema,
  data: z.array(UserDataSchema).optional(),
});

export class UserUpsertResponseDto extends createZodDto(UserUpsertResponseSchema) {}

// Helper functions for creating responses
export const createUserSuccessResponse = (userData: any): UserUpsertResponseDto => {
  return {
    status: {
      code: 1,
    },
    data: [userData],
  };
};

export const createUserErrorResponse = (messages: string[]): UserUpsertResponseDto => {
  return {
    status: {
      code: 0,
      message: messages,
    },
  };
};