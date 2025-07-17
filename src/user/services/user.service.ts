import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserUpsertRequestDto } from '../dto/user-upsert-request.dto';
import { UserUpsertResponseDto, createUserSuccessResponse, createUserErrorResponse } from '../dto/user-upsert-response.dto';
import { UserValidationService } from '../common/user-validation.service';
import { UserLookupService } from '../common/user-lookup.service';
import { UserProcessingService } from '../common/user-processing.service';
import { PhoneValidationService } from '../common/phone-validation.service';
import { UserCommonService } from '../common/userCommon.service';
import { RabbitmqService } from 'src/common/rabbitmq.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userValidationService: UserValidationService,
    private readonly userLookupService: UserLookupService,
    private readonly userProcessingService: UserProcessingService,
    private readonly phoneValidationService: PhoneValidationService,
    private readonly commonService: UserCommonService,
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  async upsertUser(userData: UserUpsertRequestDto): Promise<UserUpsertResponseDto> {
    try {
      this.logger.log(`Starting user upsert for changesMadeBy: ${userData.changesMadeBy}`);

      // Step 1: Basic validation
      const basicValidation = await this.userValidationService.validateBasicData(userData);
      if (!basicValidation.isValid) {
        return createUserErrorResponse([basicValidation.message!]);
      }

      // Step 2: Determine source-based flags
      const sourceFlags = this.userValidationService.validateSource(userData.source);
      
      // Step 3: Check automatic phone verification
      // const shouldVerifyPhone = this.userValidationService.shouldVerifyPhone(userData);
      // if (shouldVerifyPhone) {
      //   userData.phone_verified = true;
      // }

      // const shouldVerifyPhone = this.userValidationService.shouldVerifyPhoneInternal(userData);
      const shouldVerifyPhone = await this.userValidationService.shouldVerifyPhoneInternal(userData);


      // Step 4: Handle encoded user verification
      // if (userData.encodeUser && userData.userId) {
      //   const encodedValidation = this.userValidationService.validateEncodedUser(
      //     userData.userId, 
      //     userData.encodeUser
      //   );
      //   if (encodedValidation.isValid && encodedValidation.data?.status === 'verified') {
      //     userData.userUpdate = true;
      //   }
      // }

      // Step 5: Location validation and resolution
      const locationValidation = await this.userValidationService.validateLocation(userData);
      if (!locationValidation.isValid) {
        return createUserErrorResponse([locationValidation.message!]);
      }

      // Step 6: Find existing user
      const lookupResult = await this.userLookupService.findUser(userData);
      
      if (lookupResult.user) {

        if (userData.deactivate === 'false' && userData.deactivateId) {
            if (lookupResult.user.id !== userData.deactivateId) {
            return createUserErrorResponse(['Invalid reactivation attempt']);
            }
        }

        if (lookupResult.user.published === 0 && !userData.deactivate) {
            return await this.formatUserResponse(lookupResult.user);
        }

        // const whatsappCheck = await this.userLookupService.checkWhatsAppVerification(
        //     lookupResult.user, 
        //     userData
        // );
        
        // if (whatsappCheck.shouldVerifyPhone) {
        //     // userData.phoneVerified = true;
        //     userData.userUpdate = true;
        //     userData.phone = whatsappCheck.phone;
        // }

        if (userData.deactivate === 'false' && userData.deactivateId && 
            lookupResult.user.id === userData.deactivateId) {
            return await this.reactivateUser(lookupResult.user, userData);
        }

        // Update existing user
        return await this.updateExistingUser(
          lookupResult.user, 
          userData, 
          sourceFlags,
          locationValidation.locationData
        );
      } else {
        // Create new user
        return await this.createNewUser(
          userData, 
          sourceFlags,
          locationValidation.locationData
        );
      }

    } catch (error) {
      this.logger.error(`User upsert failed: ${error.message}`, error.stack);
      return createUserErrorResponse(['User operation failed']);
    }
  }

  private async updateExistingUser(
    existingUser: any,
    userData: UserUpsertRequestDto,
    sourceFlags: any,
    locationData: any
  ): Promise<UserUpsertResponseDto> {
    try {
      this.logger.log(`Updating existing user: ${existingUser.id}`);

      // Determine update mode (full update vs partial update)
      // const isFullUpdate = userData.userUpdate === true;
      let isFullUpdate = userData.changesMadeBy === existingUser.id;
      const isPartialUpdate = userData.changesMadeBy === 29988050;

      if (userData.encodeUser && userData.userId) {
      const encodedValidation = this.userValidationService.validateEncodedUser(
        userData.userId, 
        userData.encodeUser
      );
      if (encodedValidation.isValid && encodedValidation.data?.status === 'verified') {
        isFullUpdate = true; // Force full update for encoded user verification
      }
    }

    // Handle WhatsApp verification (force full update)
    const whatsappCheck = await this.userLookupService.checkWhatsAppVerification(
      existingUser, 
      userData
    );

    if (whatsappCheck.shouldVerifyPhone) {
      userData.phone = whatsappCheck.phone;
      isFullUpdate = true; // Force full update for WhatsApp verification
    }
      // Company and designation validation
      const companyValidation = await this.userValidationService.validateCompany(
        userData, 
        existingUser.email
      );

      if (userData.phone) {
        const currentPhone = existingUser.phone || '';
        const newPhone = userData.phone;
        
        // Normalize both phones for comparison
        const currentPhoneNormalized = this.phoneValidationService.normalizePhoneNumber(currentPhone);
        const newPhoneNormalized = this.phoneValidationService.normalizePhoneNumber(newPhone);
        
        // Only check duplicates if phone actually changed
        if (currentPhoneNormalized !== newPhoneNormalized) {
          const duplicateCheck = await this.phoneValidationService.checkPhoneDuplicate(
            newPhone, 
            existingUser.id
          );
          
          if (duplicateCheck.isDuplicate) {
            return createUserErrorResponse(['Phone number already mapped to other account']);
          }
        }
      }
      const phoneVerified = await this.userValidationService.shouldVerifyPhoneInternal(userData);
      
      const designationValidation = await this.userValidationService.validateDesignation(userData);

      let result = await this.prisma.$transaction(async (tx) => {
        const oldUserData = { ...existingUser };
        const updatedUser = await this.userProcessingService.updateUser(
          existingUser,
          userData,
          {
            isFullUpdate,
            isPartialUpdate,
            sourceFlags,
            locationData: locationData,
            companyData: companyValidation.companyData,
            designationData: designationValidation.designationData,
            phoneVerificationResult: phoneVerified,
          },
          tx
        );

        if (userData.phone) {
          const currentPhone = existingUser.phone || '';
          const newPhone = userData.phone;
          
          // Normalize both phones for comparison
          const currentPhoneNormalized = this.phoneValidationService.normalizePhoneNumber(currentPhone);
          const newPhoneNormalized = this.phoneValidationService.normalizePhoneNumber(newPhone);
          
          // Determine if we should update (different or empty current phone)
          const shouldUpdatePhone = currentPhoneNormalized !== newPhoneNormalized || !currentPhone;
          
          if (shouldUpdatePhone) {
            // Determine phone verification status
            // const phoneVerified = this.userValidationService.shouldVerifyPhoneInternal(userData);
            const phoneVerified = await this.userValidationService.shouldVerifyPhoneInternal(userData);
            
            // Let the phone service handle duplicates and clearing logic
            const phoneResult = await this.phoneValidationService.upsertUserPhone(
              updatedUser.id,
              userData.phone,
              true, // updatePhone = true since we determined we should update
              phoneVerified,
              tx
            );

            if (!phoneResult.isValid) {
              throw new Error(phoneResult.message || 'Phone update failed');
            }
          } else if (await this.userValidationService.shouldVerifyPhoneInternal(userData) && !existingUser.phone_verified) {            // Phone didn't change but verification status should be updated
            const phoneResult = await this.phoneValidationService.upsertUserPhone(
              updatedUser.id,
              userData.phone,
              false, 
              true,
              tx
            );

            if (!phoneResult.isValid) {
              this.logger.warn(`Phone verification update failed for user ${updatedUser.id}: ${phoneResult.message}`);
            }
          }
        }

        // await this.commonService.createUserUpdateReview(
        //   userData,
        //   oldUserData,
        //   updatedUser,
        //   tx
        // );

        return updatedUser;
      },
      {
        maxWait: 1000,     
        timeout: 20000,   
      }
    );

      if (result.profile_completed || this.shouldUpdateProfileScore(result, userData)) {
        try {
          await this.commonService.updateProfileScore(result.id);
          // Refresh user data to get updated scores
          const updatedResult = await this.prisma.user.findUnique({
            where: { id: result.id },
            include: {
              city_user_cityTocity: true,
              country_user_countryTocountry: true,
              company_user_companyTocompany: true,
            },
          });
          if (updatedResult) {
            result = updatedResult;
          }
        } catch (error) {
          this.logger.warn(`Profile score update failed: ${error.message}`);
        }
      }

      await this.performPostProcessing(result, userData, false);

      return await this.formatUserResponse(result, true);

    } catch (error) {
      this.logger.error(`Update user failed: ${error.message}`);
      return createUserErrorResponse([error.message || 'User update failed']);
    }
  }

  private async createNewUser(
    userData: UserUpsertRequestDto,
    sourceFlags: any,
    locationData: any
  ): Promise<UserUpsertResponseDto> {
    try {
      this.logger.log('Creating new user');

      // Validate creation requirements
      const creationValidation = this.userValidationService.validateCreationRequirements(userData);
      if (!creationValidation.isValid) {
        return createUserErrorResponse([creationValidation.message!]);
      }

      // Email format validation for new users
      if (userData.email && !this.isValidEmail(userData.email)) {
        return createUserErrorResponse(['Invalid email format']);
      }

      // if (userData.phone) {
      //   const duplicateCheck = await this.phoneValidationService.checkPhoneDuplicate(userData.phone);
        
      //   if (duplicateCheck.isDuplicate) {
      //     return createUserErrorResponse(['Phone number already mapped to other account']);
      //   }
      // }

      // Company and designation validation
      const companyValidation = await this.userValidationService.validateCompany(
        userData, 
        userData.email
      );
      
      const designationValidation = await this.userValidationService.validateDesignation(userData);
      const phoneVerified = await this.userValidationService.shouldVerifyPhoneInternal(userData);


      let result = await this.prisma.$transaction(async (tx) => {
        const newUser = await this.userProcessingService.createUser(
          userData,
          {
            sourceFlags,
            locationData,
            companyData: companyValidation.companyData,
            designationData: designationValidation.designationData,
            phoneVerificationResult: phoneVerified,

          },
          tx
        );

        // Handle phone setup if provided
        // if (userData.phone) {
        //   this.logger.log(`Setting up phone for user: ${newUser.id}`);
        //   const phoneResult = await this.phoneValidationService.upsertUserPhone(
        //     newUser.id,
        //     userData.phone,
        //     false,
        //     Boolean(userData.phone_verified),
        //     tx
        //   );
        //   if (!phoneResult.isValid) {
        //     throw new Error(phoneResult.message || 'Phone setup failed');
        //   }
        // }

        if (userData.phone) {
          this.logger.log(`Setting up phone for user: ${newUser.id}`);
          // const phoneVerified = this.userValidationService.shouldVerifyPhoneInternal(userData);
          const phoneVerified = await this.userValidationService.shouldVerifyPhoneInternal(userData);
          
          const phoneResult = await this.phoneValidationService.upsertUserPhone(
            newUser.id,
            userData.phone,
            false, // new user, so not updating
            phoneVerified,
            tx
          );
          if (!phoneResult.isValid) {
            throw new Error(phoneResult.message || 'Phone setup failed');
          }
        }


        // Set password (OTP) for new users
        await this.setUserPassword(newUser, tx);

        // await this.commonService.createUserCreationReview(
        //   userData,
        //   newUser,
        //   tx
        // );


        return newUser;
      },
      {
        maxWait: 1000,    
        timeout: 20000,   
      }
    );

      try {
        await this.commonService.updateProfileScore(result.id);
        // Refresh user data to get updated scores
        const updatedResult = await this.prisma.user.findUnique({
          where: { id: result.id },
          include: {
            city_user_cityTocity: true,
            country_user_countryTocountry: true,
            company_user_companyTocompany: true,
          },
        });
        if (updatedResult) {
          result = updatedResult;
        }
      } catch (error) {
        this.logger.warn(`Profile score update failed: ${error.message}`);
      }


      // Post-processing operations
      await this.performPostProcessing(result, userData, true);
      // this.performPostProcessing(result, userData, true).catch(error => {
      //   this.logger.warn(`Post-processing failed: ${error.message}`);
      // });

      // Format and return response
      return await this.formatUserResponse(result);

    } catch (error) {
      this.logger.error(`Create user failed: ${error.message}`);
      return createUserErrorResponse([error.message || 'User creation failed']);
    }
  }

  private async reactivateUser(
    user: any,
    userData: UserUpsertRequestDto
  ): Promise<UserUpsertResponseDto> {
    try {
      this.logger.log(`Reactivating user: ${user.id}`);

      const sourceFlags = this.userValidationService.validateSource(userData.source);
      const shouldPublish = !sourceFlags.noPublishedFlag;

      const updateData: any = {
        modified: new Date(),
        modifiedby: userData.changesMadeBy,
      };

      if (shouldPublish) {
        updateData.published = true;
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const reactivatedUser = await tx.user.update({
          where: { id: user.id },
          data: updateData,
          include: {
            city_user_cityTocity: true,
            country_user_countryTocountry: true,
            company_user_companyTocompany: true,
          },
        });

        // Create review for user reactivation
        // await this.commonService.createUserReactivationReview(
        //   userData,
        //   reactivatedUser,
        //   tx
        // );

        return reactivatedUser;
      });

      return await this.formatUserResponse(result);

    } catch (error) {
      this.logger.error(`Reactivate user failed: ${error.message}`);
      return createUserErrorResponse(['User reactivation failed']);
    }
  }

  private shouldUpdateProfileScore(user: any, userData: UserUpsertRequestDto): boolean {
  // Update score if significant profile changes were made
    return !!(
      userData.name || 
      userData.email || 
      userData.phone || 
      userData.company || 
      userData.designation || 
      userData.city || 
      userData.country ||
      userData.about ||
      userData.profilePicture ||
      userData.website ||
      userData.facebookId ||
      userData.linkedinId ||
      userData.googleId ||
      userData.twitterId
    );
  }

  private async setUserPassword(user: any, tx: any): Promise<void> {
    try {
      const userId = user.id;      
      // Generate 4-digit OTP
      const otp = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;

      await tx.user.update({
        where: { id: userId },
        data: {
          password: otp.toString(),
        },
      });

      this.logger.log(`Password set for user: ${userId}`);

    } catch (error) {
      this.logger.error(`Set password failed: ${error.message}`);
      throw error;
    }
  }

 
  private async performPostProcessing(
    user: any, 
    userData: UserUpsertRequestDto, 
    isNewUser: boolean
  ): Promise<void> {
    try {
      // Save social profile data
      if (userData.metadata && userData.source) {
        try {
          await this.saveSocialProfile(user, userData.source, userData.metadata);
        } catch (error) {
          this.logger.warn(`Social profile save failed: ${error.message}`);
        }
      }

      if (user.profile_completed) {
      // if (user.name || user.city || user.user_company || user.designation) {
        try {
          const eventVisitorData = {
            id: user.id,
            name: user.name,
            city: user.city,
            country: user.country,
            userCompany: user.user_company,
            designation: user.designation,
            cityName: user.city_user_cityTocity?.name,
            countryName: user.country_user_countryTocountry?.name,
            phone: user.phone,
            designationId: user.designation_id,
          };

          await this.commonService.syncEventVisitorData(eventVisitorData, userData);
        } catch (error) {
          this.logger.warn(`Event visitor sync failed: ${error.message}`);
        }
      }

      // Update profile score (async)
      // if (!userData.odashActiveness && userData.noCountQr !== true) {
      //   setImmediate(() => {
      //     this.commonService.updateProfileScore(user.id).catch(error => {
      //       this.logger.warn(`Profile score update failed: ${error.message}`);
      //     });
      //   });
      // }

      // setImmediate(() => {
      //   this.commonService.updateProfileScore(user.id).catch(error => {
      //     this.logger.warn(`Profile score update failed: ${error.message}`);
      //   });
      // });
      

      // Send to search index and messaging (async)
      setImmediate(() => {
        this.sendToSearchAndMessaging(user, isNewUser).catch(error => {
          this.logger.warn(`Search and messaging failed: ${error.message}`);
        });
      });

      // Spam score calculation for published users (async)
      if (user.published === true) {
        setImmediate(() => {
          this.commonService.calculateAndSaveSpamScore(user.id).catch(error => {
            this.logger.warn(`Spam score calculation failed: ${error.message}`);
          });
        });
      }

    } catch (error) {
      this.logger.warn(`Post-processing failed: ${error.message}`);
      // Don't fail the main operation for post-processing errors
    }
  }

  private async formatUserResponse(user: any, isExistingUser: boolean = false): Promise<UserUpsertResponseDto> {
    try {
      // Get enhanced user data
      const userData = await this.userProcessingService.formatUserData(user, isExistingUser);
      
      return createUserSuccessResponse(userData);

    } catch (error) {
      this.logger.error(`Format response failed: ${error.message}`);
      return createUserErrorResponse(['Response formatting failed']);
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async saveSocialProfile(
    user: any, 
    source: string, 
    metadata: string
  ): Promise<void> {
    try {
      this.logger.log(`Saving social profile for user ${user.id}, source: ${source}`);
      
      await this.commonService.saveSocialProfile({
        userId: user.id,
        source: source as 'facebook' | 'linkedin' | 'google' | 'twitter',
        metadata: metadata,
      });
    } catch (error) {
      this.logger.error(`Save social profile failed: ${error.message}`);
    }
  }

  private async updateProfileScore(userId: number): Promise<void> {
    try {
      this.logger.log(`Updating profile score for user: ${userId}`);
      await this.commonService.updateProfileScore(userId);
    } catch (error) {
      this.logger.error(`Profile score update failed: ${error.message}`);
    }
  }

  // private async sendToSearchAndMessaging(user: any, isNewUser: boolean): Promise<void> {
  //   try {
  //     // TODO: Implement Elasticsearch and RabbitMQ integration
  //     this.logger.log(`Sending user ${user.id} to search and messaging systems`);
      
  //   } catch (error) {
  //     this.logger.error(`Search and messaging integration failed: ${error.message}`);
  //   }
  // }

  private async sendToSearchAndMessaging(user: any, isNewUser: boolean): Promise<void> {
    try {
      this.logger.log(`Sending user ${user.id} to search and messaging systems`);
      
      // Send visitor ES message 
      if (isNewUser || this.shouldSendVisitorUpdate(user)) {
        const visitorMessage = {
          event: 0, // Default event
          edition: 0, // Default edition  
          user: user.id,
          action: isNewUser ? 'create' : 'update',
          payload: {
            userId: user.id,
            name: user.name,
            email: user.email,
            city: user.city,
            country: user.country,
            company: user.user_company,
            designation: user.designation,
            published: user.published,
          }
        };

        const messageSent = await this.rabbitmqService.sendVisitorEsMessage(visitorMessage);
        
        if (messageSent) {
          this.logger.log(`Visitor ES message sent for user ${user.id}`);
        } else {
          this.logger.warn(`Failed to send visitor ES message for user ${user.id}`);
        }
      }
      
    } catch (error) {
      this.logger.error(`Search and messaging integration failed: ${error.message}`);
    }
  }

  private shouldSendVisitorUpdate(user: any): boolean {
    return !!(
      user.name || 
      user.city || 
      user.user_company || 
      user.designation ||
      user.published !== undefined
    );
  }

 
//   private async calculateSpamScore(userId: number): Promise<void> {
//     try {
//       // TODO: Implement spam score calculation
//       this.logger.log(`Calculating spam score for user: ${userId}`);
      
//     } catch (error) {
//       this.logger.error(`Spam score calculation failed: ${error.message}`);
//     }
//   }

  private async calculateSpamScore(userId: number): Promise<void> {
    try {
        this.logger.log(`Calculating spam score for user: ${userId}`);
        
        const result = await this.commonService.calculateAndSaveSpamScore(userId);
      
        if (result.status === 0) {
        this.logger.warn(`Spam score calculation failed for user ${userId}: ${result.message}`);
        } else {
        this.logger.log(`Spam score calculated for user ${userId}: ${result.data?.score}`);
        }
        
    } catch (error) {
        this.logger.error(`Spam score calculation failed: ${error.message}`);
    }
  }
}