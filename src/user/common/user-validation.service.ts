import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserUpsertRequestDto } from '../dto/user-upsert-request.dto';
import { UserCommonService } from './userCommon.service';

export interface ValidationResult {
  isValid: boolean;
  message?: string;
  data?: any;
}

export interface LocationData {
  cityId?: number;
  countryId?: string;
  city?: any;
  country?: any;
}

export interface CompanyData {
  companyId?: number;
  company?: any;
  shouldUpdateCompany: boolean;
}

export interface DesignationData {
  designationId?: number;
  designation?: string;
  realName?: string;
}

@Injectable()
export class UserValidationService {
  private readonly logger = new Logger(UserValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userCommonService: UserCommonService,

  ) {}

  async validateBasicData(data: UserUpsertRequestDto): Promise<ValidationResult> {
    try {
      if (!data.changesMadeBy || !Number.isInteger(data.changesMadeBy)) {
        return {
          isValid: false,
          message: 'changesMadeBy cannot be empty',
        };
      }

      const userExists = await this.prisma.user.findUnique({
        where: { id: data.changesMadeBy },
        select: { id: true, published: true },
      });

      // if (!userExists || !userExists.published) {
      if (!userExists) {
        return {
          isValid: false,
          message: 'Invalid changesMadeBy user',
        };
      }

      // Validate email format if provided
      if (data.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(data.email)) {
          return {
            isValid: false,
            message: 'Invalid email format',
          };
        }
      }

      // Validate website format if provided
      if (data.website) {
        const isValidWebsite = this.validateWebsiteFormat(data.website);
        if (!isValidWebsite) {
          return {
            isValid: false,
            message: 'website is not in correct format',
          };
        }
      }

      return { isValid: true };

    } catch (error) {
      this.logger.error(`Basic validation error: ${error.message}`);
      return {
        isValid: false,
        message: 'Validation failed',
      };
    }
  }

  private validateWebsiteFormat(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.host}`;
      
      const regex = /^(https?:\/\/)?(?!.*(?:http:\/\/.*http:\/\/|https:\/\/.*https:\/\/))?(?!www{3,})(www\.)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,15}([\/\w\.\-\?\&\:\=\#\@\+\%]*)*$/;
      
      return regex.test(urlWithoutQuery);
    } catch {
      return false;
    }
  }

  // async validateLocation(data: UserUpsertRequestDto): Promise<{
  //   isValid: boolean;
  //   message?: string;
  //   locationData?: LocationData;
  // }> {
  //   try {
  //     const locationData: LocationData = {};

  //     // Handle place_id (Google Places integration)
  //     if (data.placeId) {
  //       const placeResult = await this.resolvePlaceId(data.placeId);
  //       if (placeResult.isValid) {
  //         locationData.cityId = placeResult.data.cityId;
  //         locationData.countryId = placeResult.data.countryCode;
  //       } else {
  //         return {
  //           isValid: false,
  //           message: placeResult.message,
  //         };
  //       }
  //     }

  //     // Handle cityCode
  //     if (data.city && typeof data.city === 'number') {
  //       const city = await this.prisma.city.findUnique({
  //         where: { id: data.city },
  //         // include: {
  //         //   country_city_countryTocountry: true,
  //         // },
  //       });

  //       if (city) {
  //         locationData.cityId = city.id;
  //         locationData.countryId = city.country || undefined;
  //         locationData.city = city;
  //         locationData.country = city.country;
  //       } else {
  //         return {
  //           isValid: false,
  //           message: 'Invalid city code',
  //         };
  //       }
  //     }

  //     return {
  //       isValid: true,
  //       locationData,
  //     };

  //   } catch (error) {
  //     this.logger.error(`Location validation error: ${error.message}`);
  //     return {
  //       isValid: false,
  //       message: 'Location validation failed',
  //     };
  //   }
  // }

  async validateLocation(data: UserUpsertRequestDto): Promise<{
    isValid: boolean;
    message?: string;
    locationData?: LocationData;
  }> {
    try {
      const locationData: LocationData = {};

      if (data.placeId) {
        const placeResult = await this.resolvePlaceId(data.placeId);
        if (placeResult.isValid) {
          locationData.cityId = placeResult.data.cityId;
          locationData.countryId = placeResult.data.countryCode;
        } else {
          return {
            isValid: false,
            message: placeResult.message,
          };
        }
      }

      if (data.city && typeof data.city === 'number') {
        const city = await this.prisma.city.findUnique({
          where: { id: data.city },
        });

        if (city) {
          locationData.cityId = city.id;
          locationData.city = city;
          locationData.countryId = city.country || undefined;

          let country: any = null;
          if (city.country) {
            country = await this.prisma.country.findUnique({
              where: { id: city.country },
            });
          }

          if (country) {
            locationData.country = country;
          }

        } else {
          return {
            isValid: false,
            message: 'Invalid city code',
          };
        }
      }

      return {
        isValid: true,
        locationData,
      };

    } catch (error) {
      this.logger.error(`Location validation error: ${error.message}`);
      return {
        isValid: false,
        message: 'Location validation failed',
      };
    }
  }


  private async resolvePlaceId(placeId: string): Promise<ValidationResult> {
    // TODO: Implement Google Places API integration
    // This is a placeholder for the actual implementation
    this.logger.warn(`Place ID resolution not implemented: ${placeId}`);
    return {
      isValid: false,
      message: 'Place ID resolution not implemented',
    };
  }

  async validateCompany(data: UserUpsertRequestDto, userEmail?: string): Promise<{
    isValid: boolean;
    message?: string;
    companyData?: CompanyData;
  }> {
    try {
      const companyData: CompanyData = {
        shouldUpdateCompany: false,
      };

      // if (data.companyId) {
      //   if (typeof data.companyId === 'number') {
      //     const company = await this.prisma.company.findUnique({
      //       where: { id: data.companyId },
      //     });

      //     if (company) {
      //       companyData.companyId = company.id;
      //       companyData.company = company;
      //     }
      //   }
      // }

      if (data.company && (userEmail || data.email)) {
        const email = userEmail || data.email;
        const domain = email!.split('@')[1];

        const domainCompany = await this.prisma.company.findFirst({
          where: { host: domain },
        });

        if (domainCompany) {
          companyData.shouldUpdateCompany = true;
          
          if (domainCompany.name.toLowerCase() === data.company.toLowerCase()) {
            companyData.companyId = domainCompany.id;
            companyData.company = domainCompany;
          } else {
            // Domain doesn't match company name
            companyData.companyId = undefined;
          }
        }
      }

      return {
        isValid: true,
        companyData,
      };

    } catch (error) {
      this.logger.error(`Company validation error: ${error.message}`);
      return {
        isValid: false,
        message: 'Company validation failed',
      };
    }
  }

  // shouldVerifyPhoneInternal(data: UserUpsertRequestDto): boolean {
  //   if (data.verificationSource && ['sms', 'autocall', 'whatsapp'].includes(data.verificationSource)) {
  //     return true;
  //   }

  //   // SMS verification
  //   if (data.userVerified && data.inviteVerify) {
  //     return true;
  //   }
  //   // For now, always return true
  //   return true;
  // }

  async shouldVerifyPhoneInternal(data: UserUpsertRequestDto): Promise<boolean> {
    if (data.firebaseToken && data.firebaseKey && data.phone) {
      const firebaseVerified = await this.userCommonService.verifyFirebasePhone(
        data.firebaseToken,
        data.firebaseKey,
        data.phone
      );
      if (firebaseVerified) {
        return true;
      }
    }

    // Existing verification source checks
    if (data.verificationSource && ['sms', 'autocall', 'whatsapp'].includes(data.verificationSource)) {
      return true;
    }

    // SMS verification
    if (data.userVerified && data.inviteVerify) {
      return true;
    }

    // Default to false instead of true
    return false;
  }

  async validateDesignation(data: UserUpsertRequestDto): Promise<{
    isValid: boolean;
    message?: string;
    designationData?: DesignationData;
  }> {
    try {
      const designationData: DesignationData = {};

      // Handle designation text
      if (data.designation) {
        const designationResult = await this.checkDesignation(data.designation, data.department);
        if (designationResult.isValid) {
          designationData.designationId = designationResult.data.tobeMapped;
          designationData.designation = designationResult.data.realName;
        }
      }

      // Handle designationId
      // if (data.designationId) {
      //   const designationResult = await this.checkDesignation(data.designationId, data.department);
      //   if (designationResult.isValid) {
      //     designationData.designationId = designationResult.data.tobeMapped;
      //     designationData.designation = designationResult.data.realName;
      //   }
      // }

      // Validate designation length and content
      if (data.designation) {
        const designation = data.designation.trim();
        if (designation.length < 2 || designation.toLowerCase() === 'individual') {
          designationData.designation = undefined;
          designationData.designationId = undefined;
        }
      }

      return {
        isValid: true,
        designationData,
      };

    } catch (error) {
      this.logger.error(`Designation validation error: ${error.message}`);
      return {
        isValid: false,
        message: 'Designation validation failed',
      };
    }
  }

  private async checkDesignation(
    designation: string | number,
    department?: string
  ): Promise<ValidationResult> {
    try {
      let designationRecord;

      const whereCondition: any = {
        published: 1,
      };

      if (typeof designation === 'number') {
        whereCondition.id = designation;
      } else {
        whereCondition.display_name = designation;
      }

      if (department && typeof department !== 'number') {
        whereCondition.department = department;
      }

      designationRecord = await this.prisma.designation.findFirst({
        where: whereCondition,
        include: {
          designation_designation_spelling_ofTodesignation: true,
        },
      });

      if (!designationRecord) {
        return {
          isValid: false,
          message: 'Designation not found',
        };
      }

      const result = {
        original: designationRecord.id,
        tobeMapped: designationRecord.spelling_of 
          ? designationRecord.spelling_of_designation.id 
          : designationRecord.id,
        realName: designationRecord.spelling_of 
          ? designationRecord.spelling_of_designation.display_name 
          : designationRecord.display_name,
      };

      return {
        isValid: true,
        data: result,
      };

    } catch (error) {
      this.logger.error(`Designation check error: ${error.message}`);
      return {
        isValid: false,
        message: 'Designation check failed',
      };
    }
  }

  validateSource(source?: string): {
    noPublishedFlag: boolean;
    autoPhoneVerify: boolean;
  } {
    if (!source) {
      return { noPublishedFlag: false, autoPhoneVerify: false };
    }

    // Sources that should set noPublishedFlag=1 (unpublished)
    const unpublishedSources = [
      '_import', 'website_import', 'email_contacts', 'send_invite',
      'phone_contacts', 'ios_bcard', 'and_bcard', 'android_qr',
      'ios_qr', 'business_card', 'add_contact', 'email_id'
    ];

    const noPublishedFlag = unpublishedSources.some(s => source.includes(s));

    // Sources that auto-verify phone
    const autoVerifySources = ['sms', 'autocall', 'whatsapp'];
    const autoPhoneVerify = autoVerifySources.includes(source);

    return { noPublishedFlag, autoPhoneVerify };
  }

  validateEncodedUser(userId: number, encodedUser: string): ValidationResult {
    try {
      const encryptionKey = '!@#hjka@#$jks*&@'; 

      const decodedData = this.decryptEncodedUser(userId, encodedUser);

      if (!decodedData.isValid) {
        return decodedData;
      }

      const [decryptUserId, decryptKey, decryptFlag] = decodedData.data!.split('-');

      if (decryptKey === encryptionKey && parseInt(decryptUserId) === userId) {
        return {
          isValid: true,
          data: { status: decryptFlag?.trim() === '2' ? 'verified' : 'unverified' },
        };
      }

      return {
        isValid: false,
        message: 'Invalid encoded user data',
      };

    } catch (error) {
      this.logger.error(`Encoded user validation error: ${error.message}`);
      return {
        isValid: false,
        message: 'Encoded user validation failed',
      };
    }
  }

  private decryptEncodedUser(userId: number, encodedUser: string): {
    isValid: boolean;
    data?: string;
    message?: string;
  } {
    try {
      const encryptionKey = '!@#hjka@#$jks*&@'; 

      const cleanedEncodedUser = encodedUser
        .replace(/%2B/g, '+')
        .replace(/%2F/g, '/')
        .replace(/%3D/g, '=')
        .replace(/%20/g, '+')
        .replace(/ /g, '+');

      const decodedBuffer = Buffer.from(cleanedEncodedUser, 'base64');
      const decrypted = this.Decrypt(decodedBuffer, encryptionKey);

      if (!decrypted) {
        return {
          isValid: false,
          message: 'Failed to decrypt encoded user data',
        };
      }

      const parts = decrypted.split('-');
      if (parts.length < 3) {
        return {
          isValid: false,
          message: 'Invalid encrypted data format',
        };
      }

      const [decryptUserId, decryptKey, _] = parts;

      if (decryptKey.trim() !== encryptionKey.trim()) {
        return {
          isValid: false,
          message: 'Invalid encryption key',
        };
      }

      if (parseInt(decryptUserId) !== userId) {
        return {
          isValid: false,
          message: 'User ID mismatch',
        };
      }

      return {
        isValid: true,
        data: decrypted,
      };

    } catch (error) {
      this.logger.error(`Decrypt encoded user error: ${error.message}`);
      return {
        isValid: false,
        message: 'Decryption failed',
      };
    }
  }

  private Decrypt(encryptedBuffer: Buffer, key: string): string | null {
    try {
      const keyBuffer = Buffer.from(key, 'utf8');
      const decryptedBuffer = Buffer.alloc(encryptedBuffer.length);

      for (let i = 0; i < encryptedBuffer.length; i++) {
        decryptedBuffer[i] = encryptedBuffer[i] ^ keyBuffer[i % keyBuffer.length];
      }

      return decryptedBuffer.toString('utf8').replace(/\0/g, '');

    } catch (error) {
      this.logger.error(`Legacy decrypt error: ${error.message}`);
      return null;
    }
  }



  shouldVerifyPhone(data: UserUpsertRequestDto): boolean {
    const { autoPhoneVerify } = this.validateSource(data.source);
    
    // Auto-verify based on source
    if (autoPhoneVerify) {
      return true;
    }

    // SMS verification
    if (data.userVerified && data.inviteVerify) {
      return true;
    }

    return false;
  }

  validateCreationRequirements(data: UserUpsertRequestDto): ValidationResult {
    const identifiers = [
      data.email, data.phone, data.linkedinId, data.twitterId,
      data.wikipediaId, data.facebookId, data.googleId
    ];

    const hasIdentifier = identifiers.some(id => id && id.toString().trim() !== '');

    if (!hasIdentifier) {
      return {
        isValid: false,
        message: 'email|phone|linkedinId|twitterId|wikipediaId|facebookId|googleId atleast one is mandatory',
      };
    }

    // Phone verification requirement for phone-only users
    // if (!data.email && data.phone && data.phone_verified === false) {
    //   return {
    //     isValid: false,
    //     message: 'phone unverified',
    //   };
    // }

    return { isValid: true };
  }
}