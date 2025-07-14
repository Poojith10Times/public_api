import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const phoneValidation = z.string().refine((phone) => {
  if (!phone || phone.trim() === '') return true;
  
  return phone.trim().length >= 6;
}, {
  message: 'Phone number must be at least 6 characters',
}).optional();

const emailValidation = z.string().email('Invalid email format').optional();

const sourceValidation = z.string().refine((source) => {
  if (!source || source.trim() === '') return true;
  
  const validSources = [
    'website_import', 'email_contacts', 'send_invite', 'phone_contacts',
    'ios_bcard', 'and_bcard', 'android_qr', 'ios_qr', 'business_card',
    'add_contact', 'email_id', 'edit_profile',
    'facebook' , 'linkedin' , 'google' , 'twitter'
  ];
  
  return validSources.includes(source) || source.includes('_import') || source.includes('send_invite');
}, {
  message: 'Invalid source value',
}).optional();

const socialIdValidation = z.union([
  z.string().min(1, 'Social ID cannot be empty'),
  z.literal('remove'),
]).optional();

const metadataValidation = z.string().refine((metadata) => {
  if (!metadata || metadata.trim() === '') return true;
  
  try {
    JSON.parse(metadata);
    return true;
  } catch {
    return false;
  }
}, {
  message: 'Metadata must be valid JSON',
}).optional();

export const UserUpsertRequestSchema = z.object({

  userId: z.number().optional(),
  email: z.string().email('Invalid email format').optional(),
  phone: phoneValidation,
  
  name: z.string().min(1, 'Name cannot be empty').optional(),
  company: z.string().optional(),
  designation: z.string().optional(),
  about: z.string().optional(),
  website: z.string().url('Invalid website URL').optional(),
  
  // companyId: z.union([z.string(), z.number()]).optional(), // remove 
  // designationId: z.union([z.string(), z.number()]).optional(), // remove 
  department: z.string().optional(),
  
  city: z.union([z.string(), z.number()]).optional(),
  country: z.union([z.string(), z.number()]).optional(),
  placeId: z.string().optional(), // placeholder
  
  // Social media fields
  facebookId: socialIdValidation,
  linkedinId: socialIdValidation,
  googleId: socialIdValidation,
  twitterId: socialIdValidation,
  wikipediaId: socialIdValidation,
  
  // Social metadata
  metadata: metadataValidation,
  // savelinkedinMetadata: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // Profile settings
  profilePicture: z.union([
    z.string().min(1, 'Profile picture URL cannot be empty'),
    z.literal('remove'),
  ]).optional(), 
  pictureFromSocial: z.union([z.string(), z.number(), z.boolean()]).optional(), // not required 
  showMe: z.union([z.string(), z.number(), z.boolean()]).optional(),
  introduceMe: z.union([z.string(), z.number(), z.boolean()]).optional(), // also autointroduce
  // autointroduce: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // System fields
  source: sourceValidation,
  // utmMedium: z.string().optional(),
  platform: z.string().optional(),
  verificationSource: z.enum(['sms', 'autocall', 'whatsapp']).optional(),
  
  // Verification and status
  // verified: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // phoneVerified: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // phone_verified: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // emailVerified: z.union([z.string(), z.number(), z.boolean()]).optional(),
  userVerified: z.union([z.string(), z.number(), z.boolean()]).optional(),
  inviteVerify: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // Password and security
  newPassword: z.string().optional(),
  encodeUser: z.string().optional(),
  
  // Email handling
  newVerifiedEmail: emailValidation,
  mapEmail: emailValidation,
  
  // User management
  userUpdate: z.union([z.string(), z.number(), z.boolean()]).optional(),  // remove 
  deactivate: z.string().optional(),
  deactivateId: z.number().optional(),
  // updatePublished: z.union([z.string(), z.number(), z.boolean()]).optional(), // remove 
  published: z.union([z.string(), z.number()]).optional(), // published 
  
  // Phone checking flags
  // checkphone: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // updatePhone: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // Duplicate checking
  // checkDuplicateBy: z.enum(['facebookId', 'linkedinId', 'googleId', 'twitterId', 'wikipediaId']).optional(),
  // checkfbid: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // Social removal flags
  // removeLinkedIn: z.union([z.string(), z.number(), z.boolean()]).optional(),  // handle with main parameters NULL
  // removeFacebook: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // removeGoogle: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
  // Event context
  // eventId: z.number().optional(),
  getEventEditionId: z.number().optional(),
  action: z.string().optional(),
  
  // Geographic data
  geoLat: z.union([z.string(), z.number()]).optional(),
  geoLong: z.union([z.string(), z.number()]).optional(),
  
  // Subscription and notifications
  subscription: z.union([z.string(), z.number()]).optional(), 
  // unsubscribe: z.union([z.string(), z.number()]).optional(), // remove
  
  // User type and business fields
  // euser: z.union([z.string(), z.number(), z.boolean()]).optional(),
  bizType: z.string().optional(),
  
  // Tracking and analytics
  ip: z.string().optional(), //IP
  // noCountQr: z.union([z.string(), z.number(), z.boolean()]).optional(), // check 
  // odashActiveness: z.union([z.string(), z.number()]).optional(),
  
  // Changes tracking
  changesMadeBy: z.number().min(1, 'changesMadeBy is required'),
  // changesMadeFrom: z.string().optional(),
  
  // Language
  lang: z.string().optional(),
  
  // Login method tracking
  // loginMethod: z.enum(['fb', 'li', 'gplus']).optional(),
  
  // Type flag for processing
  // type: z.string().optional(),
  
  // Additional validation flags
  // sleep: z.union([z.string(), z.number(), z.boolean()]).optional(),
  
}).refine((data) => {
  const identifiers = [data.userId, data.email, data.phone, data.facebookId, data.linkedinId, data.googleId, data.twitterId, data.wikipediaId];
  const hasIdentifier = identifiers.some(id => id !== undefined && id !== null && id !== '');
  
  if (!hasIdentifier) {
    return false;
  }
  
  return true;
}, {
  message: "At least one identifier (user_id, email, phone, or social ID) is required",
});

export class UserUpsertRequestDto extends createZodDto(UserUpsertRequestSchema) {}