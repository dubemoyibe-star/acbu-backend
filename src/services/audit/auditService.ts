import { logger } from "../../config/logger";
import { config } from "../../config/env";
import fs from "fs";
import path from "path";
import { sendEmail } from "../notification";
import { getRabbitMQChannel, QUEUES } from "../../config/rabbitmq";

export interface AuditEntry {
  eventType: string;
  entityType?: string;
  entityId?: string;
  action: string;
  oldValue?: object;
  newValue?: object;
  performedBy?: string;
}

/**
 * logAudit: Publishes audit entry to RabbitMQ for asynchronous processing.
 * Falls back to local file and alerting if RabbitMQ is unavailable.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const channel = getRabbitMQChannel();
    const payload = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    const success = channel.sendToQueue(
      QUEUES.AUDIT_LOGS,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true },
    );

    if (success) {
      logger.debug("Audit entry published to queue", {
        eventType: entry.eventType,
        action: entry.action,
      });
      return;
    }

    // If queue is full or other internal issue, treat as failure
    throw new Error("RabbitMQ sendToQueue returned false");
  } catch (error: any) {
    logger.warn("RabbitMQ audit publish failed, using fallback", {
      error: error.message || error,
      eventType: entry.eventType,
    });
    handleAuditFailure(entry, error);
  }
}

/**
 * handleAuditFailure: Final fallback if RabbitMQ publish fails.
 */
function handleAuditFailure(entry: AuditEntry, error: any): void {
  logger.error("CRITICAL: Audit logging failed (RabbitMQ unavailable)", {
    eventType: entry.eventType,
    error: error.message || error,
    entry,
  });

  try {
    const logDir = path.dirname(config.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const fallbackPath = path.join(logDir, "lost-audits.log");
    const fallbackEntry = {
      timestamp: new Date().toISOString(),
      ...entry,
      error: error instanceof Error ? error.message : String(error),
    };

    fs.appendFileSync(fallbackPath, JSON.stringify(fallbackEntry) + "\n");
    logger.info(`Audit entry saved to fallback file: ${fallbackPath}`);

    // Alert admin
    if (config.notification.alertEmail) {
      const subject = `CRITICAL: Audit Log System Failure - ${entry.eventType}`;
      const body =
        `Audit logging failed to publish to RabbitMQ.\n\n` +
        `Event Type: ${entry.eventType}\n` +
        `Action: ${entry.action}\n` +
        `Error: ${error.message || error}\n\n` +
        `The audit entry has been saved to the fallback file: ${fallbackPath}\n\n` +
        `Entry Data: ${JSON.stringify(entry, null, 2)}`;

      sendEmail(config.notification.alertEmail, subject, body).catch((e) => {
        logger.error("Failed to send audit failure alert email", {
          error: e.message || e,
        });
      });
    }
  } catch (fallbackError: any) {
    logger.error("FATAL: Failed to write to audit fallback file", {
      error: fallbackError.message || fallbackError,
    });
  }
}
