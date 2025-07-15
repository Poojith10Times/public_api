import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parsePhoneNumberWithError, isValidPhoneNumber, PhoneNumber } from 'libphonenumber-js';

export interface PhoneValidationResult {
  isValid: boolean;
  internationalFormat: string;
  nationalFormat: string | number;
  countryCode: number;
  numberType?: number;
  error?: string;
}

export interface PhoneUpsertResult {
  isValid: boolean;
  message?: string;
  error?: string;
}

@Injectable()
export class PhoneValidationService {
  private readonly logger = new Logger(PhoneValidationService.name);

  constructor(private readonly prisma: PrismaService) {}

  validatePhone(phone: string, country?: string): PhoneValidationResult {
    try {
      if (!phone || phone.trim() === '') {
        return {
          isValid: false,
          internationalFormat: '',
          nationalFormat: '',
          countryCode: 0,
          error: 'Phone number is required',
        };
      }

      let phoneNumber: PhoneNumber;

      if (country) {
        phoneNumber = parsePhoneNumberWithError(phone, country as any);
      } else {
        phoneNumber = parsePhoneNumberWithError(phone);
      }

      if (!phoneNumber || !phoneNumber.isValid()) {
        return {
          isValid: false,
          internationalFormat: '',
          nationalFormat: '',
          countryCode: 0,
          error: 'Invalid phone number format',
        };
      }

      return {
        isValid: true,
        internationalFormat: phoneNumber.formatInternational(),
        nationalFormat: phoneNumber.formatNational(),
        countryCode: parseInt(phoneNumber.countryCallingCode),
        numberType: this.getNumberType(phoneNumber.getType()),
      };

    } catch (error) {
      this.logger.error(`Phone validation error: ${error.message}`);
      return {
        isValid: false,
        internationalFormat: '',
        nationalFormat: '',
        countryCode: 0,
        error: 'Phone validation failed',
      };
    }
  }

  private getNumberType(type: string | undefined): number {
    const typeMapping: Record<string, number> = {
      'FIXED_LINE': 0,
      'MOBILE': 1,
      'FIXED_LINE_OR_MOBILE': 2,
      'TOLL_FREE': 3,
      'PREMIUM_RATE': 4,
      'SHARED_COST': 5,
      'VOIP': 6,
      'PERSONAL_NUMBER': 7,
      'PAGER': 8,
      'UAN': 9,
      'VOICEMAIL': 10,
    };

    return typeMapping[type || ''] || 1; 
  }

  async checkPhoneDuplicate(
    phone: string,
    userId?: number,
    excludeEmptyEmail: boolean = false
  ): Promise<{
    isDuplicate: boolean;
    conflictUser?: any;
    message?: string;
  }> {
    try {
      const validationResult = this.validatePhone(phone);
      if (!validationResult.isValid) {
        return {
          isDuplicate: false,
          message: validationResult.error,
        };
      }

      // Get both the original international format and a normalized version
      const internationalFormat = validationResult.internationalFormat;
      const normalizedPhone = internationalFormat.replace(/\s/g, ''); // Remove spaces for comparison
      
      // Also try common variations
      const phoneVariations = [
        internationalFormat,
        normalizedPhone,
        // Add the format that might exist in your DB
        internationalFormat.replace(/(\+\d{1,3})\s?(\d)/, '$1 $2'), // Ensure space after country code
      ];

      // Build the query conditions to check all variations
      const whereConditions: any = {
        OR: phoneVariations.map(variation => ({ u_phone: variation })),
      };

      // Exclude current user if updating
      if (userId) {
        whereConditions.id = { not: userId };
      }

      const conflictingUsers = await this.prisma.user.findMany({
        where: whereConditions,
        select: {
          id: true,
          email: true,
          name: true,
          u_phone: true,
        },
      });

      if (conflictingUsers.length === 0) {
        return { isDuplicate: false };
      }

      // **ALWAYS RETURN DUPLICATE - NO EXCEPTIONS**
      return {
        isDuplicate: true,
        conflictUser: conflictingUsers[0],
        message: 'Phone number already mapped to other account',
      };

    } catch (error) {
      this.logger.error(`Phone duplicate check error: ${error.message}`);
      return {
        isDuplicate: false,
        message: 'Phone duplicate check failed',
      };
    }
  }

  async upsertUserPhone(
    userId: number,
    phone: string,
    updatePhone: boolean = false,
    phoneVerified: boolean = false,
    externalTx?: any
  ): Promise<PhoneUpsertResult> {
    try {
      const validationResult = this.validatePhone(phone);
      if (!validationResult.isValid) {
        return {
          isValid: false,
          message: 'Invalid phone',
        };
      }

      const internationalFormat = validationResult.internationalFormat;
      const normalizedPhone = this.normalizePhoneNumber(phone);

      // Use external transaction if provided, otherwise create new one
      if (externalTx) {
        return await this.handlePhoneUpsert(externalTx, userId, phone, updatePhone, phoneVerified, internationalFormat, normalizedPhone);
      } else {
        return await this.prisma.$transaction(async (tx) => {
          return await this.handlePhoneUpsert(tx, userId, phone, updatePhone, phoneVerified, internationalFormat, normalizedPhone);
        },
      );
      }

    } catch (error) {
      this.logger.error(`Phone upsert error: ${error.message}`);
      return {
        isValid: false,
        message: error.message,
        error: error.message,
      };
    }
  }

  normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    
    try {
      const cleanPhone = this.cleanPhoneNumber(phone);
      const phoneNumber = parsePhoneNumberWithError(cleanPhone);
      
      if (phoneNumber && phoneNumber.isValid()) {
        // Return international format without spaces for consistent storage
        return phoneNumber.formatInternational().replace(/\s/g, '');
      }
    } catch (error) {
      this.logger.warn(`Phone normalization failed: ${error.message}`);
    }
    
    return this.cleanPhoneNumber(phone);
  }

  private cleanPhoneNumber(phone: string): string {
    if (!phone) return '';
    // Remove all spaces and extra characters, but keep + and digits
    return phone.replace(/[^\d+]/g, '');
  }

  private async handlePhoneUpsert(
    tx: any,
    userId: number,
    phone: string,
    updatePhone: boolean,
    phoneVerified: boolean,
    internationalFormat: string,
    normalizedPhone: string
  ): Promise<PhoneUpsertResult> {
    
    // Check for duplicates
    const duplicateCheck = await this.checkPhoneDuplicate(phone, userId);
    
    // Handle duplicate logic based on update mode and verification status
    if (duplicateCheck.isDuplicate) {
      // For existing users: only allow if updatePhone is true
      // For new users: allow if phoneVerified is true (since we're setting it true by default)
      if (!updatePhone && !phoneVerified) {
        throw new Error('Phone number already mapped to other account');
      }
      
      // Clear u_phone from other users (legacy duplicate clearing logic)
      this.logger.log(`Clearing u_phone from other users with same number: ${internationalFormat}`);
      
      await tx.user.updateMany({
        where: {
          u_phone: internationalFormat,
          id: { not: userId },
        },
        data: {
          u_phone: null,
        },
      });
    }

    // Get current user
    const currentUser = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        u_phone: true,
        phone_verified: true,
      },
    });

    if (!currentUser) {
      throw new Error('User not found');
    }

    // Prepare update data
    const updateData: any = {
      phone: internationalFormat,
      u_phone: null, // Reset verified phone initially
      modified: new Date(),
    };

    // Check if phone actually changed (for existing users)
    const currentPhoneNormalized = this.normalizePhoneNumber(currentUser.phone || '');
    const phoneChanged = currentPhoneNormalized !== normalizedPhone;

    // Reset phone verification if phone changed
    if (phoneChanged && currentUser.phone) {
      updateData.phone_verified = null;
    }

    // Set phone verification if requested
    if (phoneVerified && (!currentUser.phone_verified || phoneChanged || !currentUser.phone)) {
      updateData.phone_verified = new Date();
      updateData.verified = true;
    }

    // Set verified phone (u_phone) if user is verified or being verified
    if (currentUser.phone_verified || phoneVerified) {
      updateData.u_phone = internationalFormat;
    }

    // Update user record
    await tx.user.update({
      where: { id: userId },
      data: updateData,
    });

    // Update user_phone table
    await tx.$executeRaw`
      INSERT INTO user_phone (user_id, phone, created) 
      VALUES (${userId}, ${internationalFormat}, NOW()) 
      ON DUPLICATE KEY UPDATE phone = VALUES(phone)
    `;

    return {
      isValid: true,
      message: 'Phone updated successfully',
    };
  }

  createMaskedPhone(phone: PhoneValidationResult): string {
    try {
      if (!phone.isValid || !phone.nationalFormat) {
        return '';
      }

      const nationalFormat = phone.nationalFormat.toString();
      
      if (nationalFormat.length <= 4) {
        return nationalFormat;
      }

      const first2 = nationalFormat.substring(0, 2);
      const last2 = nationalFormat.substring(nationalFormat.length - 2);
      const middleLength = nationalFormat.length - 4;
      const maskedMiddle = '*'.repeat(middleLength);

      return `${first2}${maskedMiddle}${last2}`;

    } catch (error) {
      this.logger.error(`Phone masking error: ${error.message}`);
      return '';
    }
  }
}