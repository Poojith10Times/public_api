import { Injectable, Logger } from '@nestjs/common';

export interface EventESDocument {
  id: number;
  name: string;
  event_type: string;
  start_date: string;
  end_date: string;
  published: boolean;
  edition: number;
  abbr_name?: string;
  status: string;
  functionality: string;
  url?: string;
  city: number;
  city_name: string;
  country: string;
  country_name: string;
  company?: number;
  company_name?: string;
  venue?: number;
  venue_name?: string;
  website?: string;
  geo_location?: {
    lat: number;
    lon: number;
  } | null;
  event_audience: string[];
  event_type_new: string[];
  multi_city: number;
  online_event?: number | null;
  edition_data?: any[];
  categories?: string[];
  products?: string[];
  stats?: any;
  description?: string;
  short_desc?: string;
  timing?: any[];
  highlights?: string[];
  social_media?: {
    facebook?: string;
    twitter?: string;
    linkedin?: string;
  };
}

interface ESCluster {
  name: string;
  host: string;
  enabled: boolean;
  priority: number;
  acceptRedStatus?: boolean;
  auth?: {
    username: string;
    password: string;
  };
}

interface IndexingResult {
  success: boolean;
  errors: string[];
  successfulTargets: string[];
  failedTargets: string[];
  warnings: string[];
}

@Injectable()
export class ElasticsearchService {
  private readonly logger = new Logger(ElasticsearchService.name);
  private readonly clusters: ESCluster[];
  private readonly indices = ['event_v4', 'event_v6'];
  private readonly maxRetries = 2;
  private readonly retryDelay = 1000;
  private readonly timeout = 15000; 
  private clusterHealthCache = new Map<string, { 
    healthy: boolean; 
    status: string;
    lastCheck: number; 
    canIndex: boolean; 
  }>();
  private readonly healthCacheTTL = 60000; 

  constructor() {
  this.clusters = [
    {
      name: 'main',
      host: process.env.ELASTICSEARCH_HOST || 'http://stg-es.10times.com:80',
      enabled: true,
      priority: 1,
      acceptRedStatus: true 
    },
    {
      name: 'azure',
      host: process.env.ELASTICSEARCH_AZURE_HOST || 'http://stg-es.10times.com:80',
      enabled: process.env.ELASTICSEARCH_AZURE_ENABLED === 'true',
      priority: 2,
      acceptRedStatus: true,
      auth: process.env.ELASTICSEARCH_AZURE_USERNAME && process.env.ELASTICSEARCH_AZURE_PASSWORD ? {
        username: process.env.ELASTICSEARCH_AZURE_USERNAME,
        password: process.env.ELASTICSEARCH_AZURE_PASSWORD
      } : undefined
    }
  ];

    this.clusters.sort((a, b) => a.priority - b.priority);

    this.logger.log(`Elasticsearch service initialized:`);
    this.clusters.forEach(c => 
      this.logger.log(`${c.name}: ${c.host} (${c.enabled ? 'enabled' : 'disabled'})`)
    );

    this.initializeHealthCache();
  }

  private getAuthHeaders(cluster: ESCluster): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  if (cluster.auth) {
    const credentials = btoa(`${cluster.auth.username}:${cluster.auth.password}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }

  return headers;
}

  private async initializeHealthCache(): Promise<void> {
    setTimeout(async () => {
      try {
        await this.refreshHealthCache();
        this.logger.log('Initial health cache populated');
      } catch (error) {
        this.logger.warn('Failed to populate initial health cache:', error.message);
      }
    }, 100); 
  }

  async indexEvent(eventData: EventESDocument): Promise<IndexingResult> {
    const result: IndexingResult = {
      success: false,
      errors: [],
      successfulTargets: [],
      failedTargets: [],
      warnings: []
    };

    this.logger.log(`Indexing event ${eventData.id} to Elasticsearch`);

    const indexableClusters = await this.getIndexableClusters();
    
    if (indexableClusters.length === 0) {
      result.warnings.push('No indexable clusters found, attempting all enabled clusters');
      
      for (const cluster of this.clusters.filter(c => c.enabled)) {
        const clusterResult = await this.indexToCluster(eventData, cluster);
        this.mergeClusterResult(result, clusterResult, cluster.name);
      }
    } else {
      for (const cluster of indexableClusters) {
        const clusterResult = await this.indexToCluster(eventData, cluster);
        this.mergeClusterResult(result, clusterResult, cluster.name);
      }
    }

    if (result.success) {
      this.logger.log(`Event ${eventData.id} indexed successfully to: ${result.successfulTargets.join(', ')}`);
      if (result.failedTargets.length > 0) {
        this.logger.warn(`Some targets failed: ${result.failedTargets.join(', ')}`);
      }
    } else {
      this.logger.error(`Failed to index event ${eventData.id} to any target`);
    }

    return result;
  }

  private async getIndexableClusters(): Promise<ESCluster[]> {
    const indexableClusters: ESCluster[] = [];
    
    for (const cluster of this.clusters.filter(c => c.enabled)) {
      const canIndex = await this.canClusterIndex(cluster);
      if (canIndex) {
        indexableClusters.push(cluster);
      }
    }

    return indexableClusters;
  }


  private async canClusterIndex(cluster: ESCluster): Promise<boolean> {
    const cached = this.clusterHealthCache.get(cluster.name);
    const now = Date.now();
    
    if (cached && (now - cached.lastCheck) < this.healthCacheTTL) {
      return cached.canIndex;
    }

    try {
      const response = await fetch(`${cluster.host}/_cluster/health`, {
        method: 'GET',
        headers: this.getAuthHeaders(cluster),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.updateHealthCache(cluster.name, false, 'unreachable', false);
        return false;
      }

      const health = await response.json();
      const status = health.status;
      const isHealthy = status === 'green' || status === 'yellow';
      
      let canIndex = isHealthy;
      if (!isHealthy && cluster.acceptRedStatus) {
        canIndex = await this.testIndexingCapability(cluster);
      }

      this.updateHealthCache(cluster.name, isHealthy, status, canIndex);
      return canIndex;

    } catch (error) {
      this.updateHealthCache(cluster.name, false, 'error', false);
      return false;
    }
  }

  private async testIndexingCapability(cluster: ESCluster): Promise<boolean> {
  try {
    // Just check cluster stats
    const response = await fetch(`${cluster.host}/_cluster/stats`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

  private async indexToCluster(eventData: EventESDocument, cluster: ESCluster): Promise<{
    success: boolean;
    errors: string[];
    successfulIndices: string[];
    failedIndices: string[];
  }> {
    const result: {
      success: boolean;
      errors: string[];
      successfulIndices: string[];
      failedIndices: string[];
    } = {
      success: false,
      errors: [],
      successfulIndices: [],
      failedIndices: []
    };

    for (const index of this.indices) {
      try {
        await this.indexToClusterIndex(eventData, cluster, index);
        result.successfulIndices.push(`${cluster.name}/${index}`);
        result.success = true;
        this.logger.debug(`${cluster.name}/${index}`);
      } catch (error) {
        const errorMsg = `${cluster.name}/${index}: ${error.message}`;
        result.errors.push(errorMsg);
        result.failedIndices.push(`${cluster.name}/${index}`);
        this.logger.debug(`${errorMsg}`);
      }
    }

    return result;
  }

  private async indexToClusterIndex(
    eventData: EventESDocument, 
    cluster: ESCluster, 
    index: string
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.performIndexOperation(eventData, cluster, index);
        
        this.markClusterWorking(cluster.name);
        return;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1); 
          this.logger.debug(`Retry ${attempt}/${this.maxRetries} for ${cluster.name}/${index} in ${delay}ms`);
          await this.delay(delay);
        }
      }
    }

    this.markClusterProblematic(cluster.name);
    throw lastError || new Error(`Failed after ${this.maxRetries} attempts`);
  }

  private async performIndexOperation(
    eventData: EventESDocument, 
    cluster: ESCluster, 
    index: string
  ): Promise<void> {
    const eventBody = this.prepareEventDocument(eventData);
    const url = `${cluster.host}/${index}/_doc/${eventData.id}`;
    
    const response = await fetch(url, {
    method: 'PUT',
    headers: this.getAuthHeaders(cluster),
    body: JSON.stringify(eventBody),
    signal: AbortSignal.timeout(this.timeout),
  });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(`ES error: ${JSON.stringify(result.error)}`);
    }
  }

  async healthCheck(): Promise<{ 
    overall: boolean; 
    summary: string;
    clusters: Array<{ 
      name: string; 
      healthy: boolean; 
      canIndex: boolean;
      status: string;
      details?: any; 
      lastChecked?: Date;
      recommendation?: string;
    }> 
  }> {
    await this.refreshHealthCache();
    
    const clusterHealth: Array<{ 
      name: string; 
      healthy: boolean; 
      canIndex: boolean;
      status: string;
      details?: any; 
      lastChecked?: Date;
      recommendation?: string;
    }> = [];
    let anyCanIndex = false;
    let anyHealthy = false;

    for (const cluster of this.clusters) {
      if (!cluster.enabled) {
        clusterHealth.push({ 
          name: cluster.name, 
          healthy: false, 
          canIndex: false,
          status: 'disabled',
          details: 'Cluster disabled in configuration',
          recommendation: 'Enable in environment variables if needed'
        });
        continue;
      }

      const cached = this.clusterHealthCache.get(cluster.name);
      
      if (cached) {
        const isHealthy = cached.healthy;
        const canIndex = cached.canIndex;
        
        clusterHealth.push({
          name: cluster.name,
          healthy: isHealthy,
          canIndex: canIndex,
          status: cached.status,
          lastChecked: new Date(cached.lastCheck),
          recommendation: this.getClusterRecommendation(cached.status, canIndex)
        });
        
        if (isHealthy) anyHealthy = true;
        if (canIndex) anyCanIndex = true;
      } else {
        clusterHealth.push({
          name: cluster.name,
          healthy: false,
          canIndex: false,
          status: 'unknown',
          recommendation: 'Health check pending'
        });
      }
    }

    let summary = '';
    if (anyHealthy) {
      summary = 'Some clusters are healthy';
    } else if (anyCanIndex) {
      summary = 'Clusters can index despite health issues';
    } else {
      summary = 'All clusters have issues';
    }

    return {
      overall: anyCanIndex,
      summary,
      clusters: clusterHealth
    };
  }
  private getClusterRecommendation(status: string, canIndex: boolean): string {
    if (status === 'green') return 'Cluster is healthy';
    if (status === 'yellow') return 'Cluster is functional but has some issues';
    if (status === 'red' && canIndex) return 'Cluster has issues but can still index events';
    if (status === 'red') return 'Cluster has serious issues - check logs and disk space';
    if (status === 'unreachable') return 'Cannot connect to cluster - check network and configuration';
    return 'Unknown status - investigate further';
  }

  private updateHealthCache(clusterName: string, healthy: boolean, status: string, canIndex: boolean): void {
    this.clusterHealthCache.set(clusterName, {
      healthy,
      status,
      canIndex,
      lastCheck: Date.now()
    });
  }

  private markClusterWorking(clusterName: string): void {
    const cached = this.clusterHealthCache.get(clusterName);
    if (cached) {
      cached.canIndex = true;
      cached.lastCheck = Date.now();
    }
  }

  private markClusterProblematic(clusterName: string): void {
    const cached = this.clusterHealthCache.get(clusterName);
    if (cached) {
      cached.canIndex = false;
      cached.healthy = false;
      cached.lastCheck = Date.now();
    }
  }

  private async refreshHealthCache(): Promise<void> {
    for (const cluster of this.clusters.filter(c => c.enabled)) {
      await this.canClusterIndex(cluster);
    }
  }

  private mergeClusterResult(
    mainResult: IndexingResult, 
    clusterResult: { success: boolean; errors: string[]; successfulIndices: string[]; failedIndices: string[] },
    clusterName: string
  ): void {
    if (clusterResult.success) {
      mainResult.success = true;
      mainResult.successfulTargets.push(...clusterResult.successfulIndices);
    }
    
    mainResult.errors.push(...clusterResult.errors);
    mainResult.failedTargets.push(...clusterResult.failedIndices);
  }


  private prepareEventDocument(eventData: EventESDocument): any {
    const document = {
      ...eventData,
      id: Number(eventData.id),
      edition: Number(eventData.edition),
      city: Number(eventData.city),
      company: eventData.company ? Number(eventData.company) : undefined,
      venue: eventData.venue ? Number(eventData.venue) : undefined,
      multi_city: Number(eventData.multi_city),
      online_event: eventData.online_event ? Number(eventData.online_event) : undefined,
      event_audience: Array.isArray(eventData.event_audience) ? eventData.event_audience : [],
      event_type_new: Array.isArray(eventData.event_type_new) ? eventData.event_type_new : [],
      indexed_at: new Date().toISOString(),
      entity: 'event',
    };

    return Object.fromEntries(
      Object.entries(document).filter(([_, value]) => value !== undefined)
    );
  }

  getClusterConfig(): ESCluster[] {
    return this.clusters;
  }

  getHealthStatus(): Array<{ 
  cluster: string; 
  healthy: boolean;
  status: string;
}> {
  return Array.from(this.clusterHealthCache.entries()).map(([cluster, cache]) => ({
    cluster,
    healthy: cache.healthy,
    status: cache.status
  }));
}


  async clearHealthCache(): Promise<void> {
    this.clusterHealthCache.clear();
    await this.refreshHealthCache();
    this.logger.log('Health cache cleared and refreshed');
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}