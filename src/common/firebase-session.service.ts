import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

interface FirebaseConfig {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

interface FirebaseCloneData {
  eventId: number;
  companyId: number;
  source: number;
  destination: number;
}

@Injectable()
export class FirebaseSessionService {
  private readonly logger = new Logger(FirebaseSessionService.name);
  private firebaseConfig: FirebaseConfig | null = null;

  constructor(private readonly configService: ConfigService) {
    this.loadFirebaseConfig();
  }

  private loadFirebaseConfig(): void {
    try {
      const configPath = this.configService.get<string>('FIREBASE_CONFIG_PATH') || 
                        path.join(process.cwd(), 'firebaseKey.json');
      
      this.logger.log(`Loading Firebase config from: ${configPath}`);
      
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        this.firebaseConfig = JSON.parse(configContent);
        this.logger.log(`Firebase config loaded. Project ID: ${this.firebaseConfig?.project_id}`);
      } else {
        this.logger.warn(`Firebase config file not found at: ${configPath}`);
        this.logger.warn('Please ensure firebaseKey.json exists in your project root');
      }
    } catch (error) {
      this.logger.error('Failed to load Firebase configuration:', error.message);
    }
  }

  async cloneFirebaseSession(
    eventId: number,
    companyId: number,
    cloneFrom: number,
    cloneTo: number,
    clonetype: string
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    try {
      if (!this.firebaseConfig?.project_id) {
        this.logger.warn('Firebase configuration not available');
        return { 
          success: false, 
          error: 'Firebase configuration not loaded' 
        };
      }

      this.logger.log(
        `Cloning Firebase session - Event: ${eventId}, From: ${cloneFrom} To: ${cloneTo}, Type: ${clonetype}`
      );

      const data: FirebaseCloneData = {
        eventId: eventId,
        companyId: companyId,
        source: cloneFrom,
        destination: cloneTo
      };

      const functionUrl = `https://us-central1-${this.firebaseConfig.project_id}.cloudfunctions.net/${clonetype}`;
      
      this.logger.log(`Calling Firebase function: ${functionUrl}`);
      this.logger.debug(`Data being sent:`, data);

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          eventId: data.eventId.toString(),
          companyId: data.companyId.toString(),
          source: data.source.toString(),
          destination: data.destination.toString()
        }).toString(),
      });

      const result = await response.text();
      
      this.logger.log(`Firebase function response status: ${response.status}`);
    //   this.logger.debug(`Firebase function response: ${result}`);
      
      if (response.ok) {
        return { 
          success: true, 
          result: result 
        };
      } else {
        return { 
          success: false, 
          error: `HTTP ${response.status}: ${result}` 
        };
      }

    } catch (error) {
      this.logger.error(`Firebase session cloning failed:`, error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  async cloneEventSession(
    eventId: number,
    oldCompanyId: number,
    newCompanyId: number
  ): Promise<{ success: boolean; result?: string; error?: string }> {
    return this.cloneFirebaseSession(
      eventId,
      newCompanyId,     
      oldCompanyId,    
      newCompanyId,     
      'clone-event'  
    );
  }

  
  isConfigured(): boolean {
    return !!(this.firebaseConfig?.project_id);
  }

  getConfigStatus(): {
    configured: boolean;
    projectId?: string;
    functionUrl?: string;
  } {
    const projectId = this.firebaseConfig?.project_id;
    return {
      configured: this.isConfigured(),
      projectId: projectId,
      functionUrl: projectId ? `https://us-central1-${projectId}.cloudfunctions.net` : undefined
    };
  }


  reloadConfig(): void {
    this.firebaseConfig = null;
    this.loadFirebaseConfig();
  }
}