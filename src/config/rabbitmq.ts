import amqp, { Channel, ChannelModel } from "amqplib";
import { config } from "./env";
import { logger } from "./logger";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;

export async function connectRabbitMQ(): Promise<Channel> {
  if (channel) {
    return channel;
  }

  try {
    connection = await amqp.connect(config.rabbitmqUrl);
    const ch = await connection.createChannel();
    channel = ch;
    logger.info("RabbitMQ connected successfully");

    await ch.assertExchange(EXCHANGES.DLX, "direct", { durable: true });
    logger.info("Dead letter exchange asserted");

    // Handle connection errors
    connection.on("error", (err: Error) => {
      logger.error("RabbitMQ connection error", err);
    });

    connection.on("close", () => {
      logger.warn("RabbitMQ connection closed");
      connection = null;
      channel = null;
    });

    return ch;
  } catch (error) {
    logger.error("Failed to connect to RabbitMQ", error);
    throw error;
  }
}

export interface QueueOptions extends amqp.Options.AssertQueue {
  deadLetterQueue?: string;
}

export async function assertQueueWithDLQ(
  queueName: string,
  options: QueueOptions = {},
): Promise<amqp.Replies.AssertQueue> {
  const ch = getRabbitMQChannel();
  const dlqName = `${queueName}_dlq`;

  await ch.assertQueue(dlqName, { durable: true });

  await ch.bindQueue(dlqName, EXCHANGES.DLX, queueName);

  const queueOptions: amqp.Options.AssertQueue = {
    ...options,
    durable: true,
    arguments: {
      ...options.arguments,
      deadLetterExchange: EXCHANGES.DLX,
      deadLetterRoutingKey: queueName,
    },
  };

  return ch.assertQueue(queueName, queueOptions);
}

export async function disconnectRabbitMQ(): Promise<void> {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
    logger.info("RabbitMQ disconnected");
  }
}

export function getRabbitMQChannel(): Channel {
  if (!channel) {
    throw new Error("RabbitMQ not connected. Call connectRabbitMQ() first.");
  }
  return channel;
}

// Queue names
export const QUEUES = {
  USDC_CONVERSION: "usdc_conversion",
  WITHDRAWAL_PROCESSING: "withdrawal_processing",
  REBALANCING: "rebalancing",
  NOTIFICATIONS: "notifications",
  OTP_SEND: "otp_send", // OTP delivery (email/SMS) via worker
  WEBHOOKS: "webhooks",
  KYC_PROCESSING: "kyc_processing",
  WALLET_ACTIVATION: "wallet_activation", // send XLM to user wallet when KYC fee paid
  ACBU_SAVINGS_VAULT_EVENTS: "acbu_savings_vault_events",
  ACBU_LENDING_POOL_EVENTS: "acbu_lending_pool_events",
  ACBU_ESCROW_EVENTS: "acbu_escrow_events",
  XLM_TO_ACBU: "xlm_to_acbu", // XLM deposit: sell XLM and mint ACBU to user
  USDC_CONVERT_AND_MINT: "usdc_convert_and_mint", // USDC deposit: convert USDC→XLM (backend), then mint
  AUDIT_LOGS: "audit_logs",
} as const;

// Exchange names
export const EXCHANGES = {
  RESERVE_EVENTS: "reserve_events",
  TRANSACTION_EVENTS: "transaction_events",
  DLX: "dlx", // Dead letter exchange
} as const;
