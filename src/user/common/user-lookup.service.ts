import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PhoneValidationService } from './phone-validation.service';
import { UserUpsertRequestDto } from '../dto/user-upsert-request.dto';

export interface UserLookupResult {
  user: any | null;
  source: 'user_id' | 'email' | 'phone' | 'facebook' | 'linkedin' | 'google' | 'twitter' | 'wikipedia' | 'none';
  conflictType?: 'email_conflict' | 'phone_available';
}

@Injectable()
export class UserLookupService {
  private readonly logger = new Logger(UserLookupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneValidationService: PhoneValidationService,
  ) {}

  async findUser(data: UserUpsertRequestDto): Promise<UserLookupResult> {
    try {
      // Step 1: Try user_id first 
      if (data.userId) {
        const user = await this.findUserById(data.userId);
        if (user) {
          return { user, source: 'user_id' };
        }
      }

      // Step 2: Try email if provided
      if (data.email) {
        const user = await this.findUserByEmail(data.email);
        if (user) {
          return { user, source: 'email' };
        }
      }

      // Step 3: Try phone lookup with email conflict logic
        //   if (data.phone && data.checkphone) {
        if (data.phone) {
        const phoneResult = await this.findUserByPhone(data.phone, data.email);
        if (phoneResult.user) {
          return { 
            user: phoneResult.user, 
            source: 'phone',
            conflictType: phoneResult.conflictType
          };
        }
      }

      // Step 4: Try social platform lookups
      const socialResult = await this.findUserBySocialPlatforms(data);
      if (socialResult.user) {
        return socialResult;
      }

      // No user found
      return { user: null, source: 'none' };

    } catch (error) {
      this.logger.error(`User lookup error: ${error.message}`);
      return { user: null, source: 'none' };
    }
  }

  private async findUserById(userId: number): Promise<any | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          city_user_cityTocity: true,
          country_user_countryTocountry: true,
          company_user_companyTocompany: true,
        },
      });
    } catch (error) {
      this.logger.error(`Find user by ID error: ${error.message}`);
      return null;
    }
  }

  private async findUserByEmail(email: string): Promise<any | null> {
    try {
      return await this.prisma.user.findFirst({
        where: { 
            email: email
        },
        include: {
          city_user_cityTocity: true,
          country_user_countryTocountry: true,
          company_user_companyTocompany: true,
        },
      });
    } catch (error) {
      this.logger.error(`Find user by email error: ${error.message}`);
      return null;
    }
  }

  private async findUserByPhone(
    phone: string, 
    payloadEmail?: string
  ): Promise<{
    user: any | null;
    conflictType?: 'email_conflict' | 'phone_available';
  }> {
    try {
      const phoneValidation = this.phoneValidationService.validatePhone(phone);
      if (!phoneValidation.isValid) {
        return { user: null };
      }

      const internationalFormat = phoneValidation.internationalFormat;
      const normalizedPhone = internationalFormat.replace(/\s/g, ''); // Remove spaces
      
      // Create variations to check against existing data
      const phoneVariations = [
        internationalFormat,
        normalizedPhone,
        internationalFormat.replace(/(\+\d{1,3})\s?(\d)/, '$1 $2'), // Ensure space after country code
      ];

      // Search for user with any of these phone variations
      const phoneUser = await this.prisma.user.findFirst({
        where: {
          OR: phoneVariations.map(variation => ({ u_phone: variation })),
        },
        include: {
          city_user_cityTocity: true,
          country_user_countryTocountry: true,
          company_user_companyTocompany: true,
        },
        orderBy: { id: 'desc' }, 
      });

      if (!phoneUser) {
        return { user: null };
      }

      const existingEmail = phoneUser.email;

      // if (!existingEmail || existingEmail.trim() === '') {
      //   return { 
      //     user: phoneUser, 
      //     conflictType: 'phone_available' 
      //   };
      // } else if (!payloadEmail || payloadEmail.trim() === '') {
      //   return { 
      //     user: phoneUser, 
      //     conflictType: 'phone_available' 
      //   };
      // } else {
      //   // Phone exists with email, but payload also has email - should be conflict
      //   return { user: null };
      // }
      return { user: null };

    } catch (error) {
      this.logger.error(`Find user by phone error: ${error.message}`);
      return { user: null };
    }
  }

  private async findUserBySocialPlatforms(data: UserUpsertRequestDto): Promise<UserLookupResult> {
    const socialPlatforms = [
      { field: 'facebookId', column: 'facebook_id', source: 'facebook' as const },
      { field: 'linkedinId', column: 'linkedin_id', source: 'linkedin' as const },
      { field: 'googleId', column: 'google_id', source: 'google' as const },
      { field: 'twitterId', column: 'twitter_id', source: 'twitter' as const },
      { field: 'wikipediaId', column: 'wikipedia', source: 'wikipedia' as const },
    ];

    // Check if checkDuplicateBy is specified 
    // if (data.checkDuplicateBy) {
    //   const platform = socialPlatforms.find(p => p.field === data.checkDuplicateBy);
    //   if (platform && data[platform.field as keyof UserUpsertRequestDto]) {
    //     const user = await this.findUserBySocialId(
    //       platform.column, 
    //       data[platform.field as keyof UserUpsertRequestDto] as string
    //     );
    //     if (user) {
    //       return { user, source: platform.source };
    //     }
    //   }
    // }

    // Try each platform in order
    for (const platform of socialPlatforms) {
      const socialId = data[platform.field as keyof UserUpsertRequestDto] as string;
      
      if (socialId) {
        // Special Facebook logic with checkfbid flag
        // if (platform.field === 'facebookId') {
          const user = await this.findUserBySocialId(platform.column, socialId);
          if (user) {
            return { user, source: platform.source };
          }
        // } else if (platform.field !== 'facebookId') {
        //   const user = await this.findUserBySocialId(platform.column, socialId);
        //   if (user) {
        //     return { user, source: platform.source };
        //   }
        // }
      }
    }

    return { user: null, source: 'none' };
  }

  private async findUserBySocialId(column: string, socialId: string): Promise<any | null> {
    try {
      // Extract ID from social URLs if needed
      const processedId = this.extractSocialId(column, socialId);

      return await this.prisma.user.findFirst({
        where: {
          [column]: processedId,
        },
        include: {
          city_user_cityTocity: true,
          country_user_countryTocountry: true,
          company_user_companyTocompany: true,
        },
        orderBy: { id: 'desc' }, 
      });
    } catch (error) {
      this.logger.error(`Find user by social ID error: ${error.message}`);
      return null;
    }
  }

  private extractSocialId(platform: string, input: string): string {
    if (!input || input.trim() === '') {
      return input;
    }

    try {
      // Facebook ID extraction
      if (platform === 'facebook_id') {
        const urlParts = input.split('/');
        if (urlParts.length > 4 && /^\d+$/.test(urlParts[4])) {
          return urlParts[4]; // Numeric Facebook ID
        }
        return input;
      }

      // LinkedIn ID extraction
      if (platform === 'linkedin_id') {
        const urlParts = input.split('/');
        if (urlParts.length > 4) {
          return urlParts[4];
        }
        return input;
      }

      // Google ID extraction
      if (platform === 'google_id') {
        const urlParts = input.split('/');
        if (urlParts.length > 3) {
          if (!/^\d+$/.test(urlParts[3])) {
            return urlParts.length > 5 ? urlParts[5] : input;
          } else {
            return urlParts[3];
          }
        }
        return input;
      }

      return input;

    } catch (error) {
      this.logger.error(`Social ID extraction error: ${error.message}`);
      return input;
    }
  }

  async checkWhatsAppVerification(
    user: any,
    data: UserUpsertRequestDto
  ): Promise<{
    shouldVerifyPhone: boolean;
    shouldUpdateUser: boolean;
    phone?: string;
  }> {
    try {
      if (!user || data.verificationSource !== 'whatsapp' || 
          !data.inviteVerify || !data.userVerified) {
        return { shouldVerifyPhone: false, shouldUpdateUser: false };
      }

      // Check event visitor context
      if (data.getEventEditionId) {
        const visitor = await this.prisma.event_visitor.findFirst({
          where: {
            user: user.id,
            edition: data.getEventEditionId,
          },
        });

        if (visitor && visitor.visitor_phone === user.phone) {
          return {
            shouldVerifyPhone: true,
            shouldUpdateUser: true,
            phone: user.phone,
          };
        }
      } else {
        return {
          shouldVerifyPhone: true,
          shouldUpdateUser: true,
          phone: user.phone,
        };
      }

      return { shouldVerifyPhone: false, shouldUpdateUser: false };

    } catch (error) {
      this.logger.error(`WhatsApp verification check error: ${error.message}`);
      return { shouldVerifyPhone: false, shouldUpdateUser: false };
    }
  }

  shouldReactivateUser(user: any, data: UserUpsertRequestDto): boolean {
    // Check deactivation logic
    if (data.deactivate === 'false' && data.deactivateId) {
      return user.id === data.deactivateId;
    }

    // Check if user is unpublished and should be reactivated
    if (user.published === 0 && !data.deactivate) {
      return true;
    }

    return false;
  }
}