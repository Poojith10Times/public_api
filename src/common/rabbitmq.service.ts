import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { createHash } from 'crypto';
import { appendFileSync } from 'fs';

export interface RabbitmqMessage {
  event: number;
  edition: number;
  endPoint?: string;
  file?: string;
  payload?: any;
  action?: string;
}

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private isConnecting = false;
  private readonly config = {
    host: process.env.RABBITMQ_HOST,
    port: parseInt(process.env.RABBITMQ_PORT || '5672'),
    username: process.env.RABBITMQ_USER,
    password: process.env.RABBITMQ_PASS,
  };

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    if (this.isConnecting || this.connection) {
      return;
    }

    this.isConnecting = true;
    
    try {
      const connectionUrl = `amqp://${this.config.username}:${this.config.password}@${this.config.host}:${this.config.port}`;
      this.logger.log(`Connecting to RabbitMQ: ${this.config.host}:${this.config.port}`);
      
      this.connection = await amqp.connect(connectionUrl);

      if (!this.connection) {
        throw new Error('Failed to establish RabbitMQ connection');
      }

      this.channel = await this.connection.createChannel();

      if (!this.channel) {
        throw new Error('Failed to create RabbitMQ channel');
      }

      this.logger.log(`Connected to RabbitMQ at ${this.config.host}:${this.config.port}`);

      // Handle connection events
      this.connection.on('error', (err) => {
        this.logger.error('RabbitMQ connection error:', err.message);
        this.handleConnectionLoss();
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.handleConnectionLoss();
      });

      this.channel.on('error', (err) => {
        this.logger.error('RabbitMQ channel error:', err.message);
        this.handleConnectionLoss();
      });

    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error.message);
      this.handleConnectionLoss();
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private handleConnectionLoss(): void {
    this.connection = null;
    this.channel = null;
    this.isConnecting = false;
  }

  private async ensureConnection(): Promise<void> {
    if (!this.channel || !this.connection) {
      this.logger.warn('RabbitMQ connection lost, attempting to reconnect...');
      await this.connect();
    }

    if (!this.channel) {
      throw new Error('RabbitMQ channel is not available after reconnection attempt');
    }
  }

  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }
      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }
      this.logger.log('Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error.message);
      this.handleConnectionLoss();
    }
  }

  async publishMessage(
    exchange: string,
    routingKey: string,
    data: RabbitmqMessage,
    options: amqp.Options.Publish = {}
  ): Promise<boolean> {
    try {
      await this.ensureConnection();

      await this.channel!.assertExchange(exchange, 'direct', {
        durable: false,
        autoDelete: false,
      });

      const message = JSON.stringify(data);
      const messageUid = createHash('md5').update(message).digest('hex');

      // Message properties
      const publishOptions: amqp.Options.Publish = {
        timestamp: Date.now(),
        contentType: 'application/json',
        deliveryMode: 2, 
        messageId: messageUid,
        ...options,
      };

      const published = this.channel!.publish(
        exchange,
        routingKey,
        Buffer.from(message),
        publishOptions
      );

      if (published) {
        this.logger.log(`Message sent to ${exchange}/${routingKey}:`, {
          event: data.event,
          edition: data.edition,
          messageId: messageUid,
        });
        return true;
      } else {
        throw new Error('Failed to publish message to RabbitMQ');
      }

    } catch (error) {
      this.logger.error('Failed to publish RabbitMQ message:', error.message);
      this.logToDebugFile(exchange, routingKey, data, error);
      return false;
    }
  }

  async sendToQueue(
    queueName: string,
    data: RabbitmqMessage,
    options: amqp.Options.Publish = {}
  ): Promise<boolean> {
    try {
      await this.ensureConnection();

      // Declare queue if it doesn't exist
      await this.channel!.assertQueue(queueName, {
        durable: false,
        autoDelete: false,
        exclusive: false,
      });

      const message = JSON.stringify(data);
      const messageUid = createHash('md5').update(message).digest('hex');

      // Message properties
      const sendOptions: amqp.Options.Publish = {
        timestamp: Date.now(),
        contentType: 'application/json',
        deliveryMode: 2, // Persistent delivery
        messageId: messageUid,
        ...options,
      };

      const sent = this.channel!.sendToQueue(
        queueName,
        Buffer.from(message),
        sendOptions
      );

      if (sent) {
        this.logger.log(`Message sent to queue ${queueName}:`, {
          event: data.event,
          edition: data.edition,
          messageId: messageUid,
        });
        return true;
      } else {
        throw new Error('Failed to send message to queue');
      }

    } catch (error) {
      this.logger.error('Failed to send message to queue:', error.message);
      this.logToDebugFile('', queueName, data, error);
      return false;
    }
  }

  // Main method for strength queue
  async sendStrengthMessage(data: RabbitmqMessage): Promise<boolean> {
    return await this.publishMessage('strength_exchange', '', data);
  }

  // Main method for visitor ES queue
  async sendVisitorEsMessage(data: RabbitmqMessage): Promise<boolean> {
    return await this.publishMessage('visitor_es_exchange', '', data);
  }

  async sendMessage(
    exchange: string,
    queue: string,
    data: RabbitmqMessage
  ): Promise<boolean> {
    const exchangeResult = await this.publishMessage(exchange, '', data);
    
    if (!exchangeResult) {
      // Fallback to direct queue send
      return await this.sendToQueue(queue, data);
    }
    
    return exchangeResult;
  }

  // Debug logging method
  private logToDebugFile(
    exchange: string,
    queue: string,
    data: RabbitmqMessage,
    error: Error
  ): void {
    try {
      const now = new Date();
      const debugText = `
        Exchange = ${exchange}
        Queue = ${queue}
        Payload:
        Keys: ${Object.keys(data).join(',')}
        Values: ${Object.values(data).join(',')}
        Error: ${error.message}
        Time: ${now.toISOString()}

        `;

      appendFileSync('/tmp/rabbitmq_debugger.txt', debugText);
      this.logger.debug('Logged RabbitMQ error to debug file');
    } catch (fileError) {
      this.logger.error('Failed to write to debug file:', fileError.message);
    }
  }

  // Health check method
  async isConnected(): Promise<boolean> {
    return this.connection !== null && this.channel !== null;
  }

  // Reconnection method
  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  // Get channel
  getChannel(): amqp.Channel | null {
    return this.channel;
  }

}