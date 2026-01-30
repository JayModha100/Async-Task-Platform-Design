require("dotenv").config();
const pool = require("./db");

console.log(`[${new Date().toISOString()}] Worker started`);

// Simple sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ----- ERROR CLASSES -----
class RetryableError extends Error {}
class NonRetryableError extends Error {}

// ----- METRICS -----
let metrics = {
  jobs_processed: 0,
  jobs_succeeded: 0,
  jobs_failed: 0
};

// ----- MAIN WORKER LOOP -----
async function processJobs() {
  while (true) {
    try {
      // 🔁 Recover stuck jobs (older than 5 minutes)
      await pool.query(`
        UPDATE jobs
        SET status = 'PENDING',
            started_at = NULL,
            updated_at = now()
        WHERE status = 'IN_PROGRESS'
          AND started_at < now() - INTERVAL '5 minutes'
      `);

      const client = await pool.connect();

      try {
        await client.query("BEGIN");

        // 1️⃣ Fetch and LOCK one eligible PENDING job
        const { rows } = await client.query(`
          SELECT * FROM jobs
          WHERE status = 'PENDING' AND run_at <= now()
          ORDER BY id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `);

        if (rows.length === 0) {
          await client.query("COMMIT");
          client.release();
          await sleep(2000);
          continue;
        }

        const job = rows[0];
        console.log(`[${new Date().toISOString()}] [INFO] Found job ${job.id}: ${job.task_type} (attempt ${job.attempt_count})`);

        // 2️⃣ Mark it as IN_PROGRESS + started_at
        await client.query(
          `UPDATE jobs
           SET status = $1,
               started_at = now(),
               updated_at = now()
           WHERE id = $2`,
          ["IN_PROGRESS", job.id]
        );

        await client.query("COMMIT");
        client.release();
        console.log(`[${new Date().toISOString()}] [INFO] Job ${job.id} set to IN_PROGRESS`);

        // 3️⃣ Execute the task with retry/failure handling
        try {
          // ---- Simulated failure for testing ----
          if (job.payload.fail) {
            throw new RetryableError("Simulated failure");
          }

          const seconds = job.payload.seconds || 1;
          console.log(`[${new Date().toISOString()}] [INFO] Executing sleep_test for ${seconds} seconds...`);
          await sleep(seconds * 1000);

          // ---- SUCCESS ----
          await pool.query(
            `UPDATE jobs
             SET status = $1,
                 updated_at = now()
             WHERE id = $2`,
            ["SUCCEEDED", job.id]
          );
          console.log(`[${new Date().toISOString()}] [SUCCESS] Job ${job.id} completed successfully`);
          metrics.jobs_processed += 1;
          metrics.jobs_succeeded += 1;

        } catch (err) {
          console.error(`[${new Date().toISOString()}] [ERROR] Job ${job.id} failed: ${err.message}`);
          metrics.jobs_processed += 1;
          metrics.jobs_failed += 1;

          if (err instanceof NonRetryableError || job.attempt_count + 1 >= job.max_attempts) {
            // Permanent failure
            await pool.query(
              `UPDATE jobs
               SET status=$1,
                   attempt_count = attempt_count + 1,
                   error_message=$2,
                   failed_at=now(),
                   updated_at=now()
               WHERE id=$3`,
              ["FAILED_PERMANENT", err.message, job.id]
            );
            console.log(`[${new Date().toISOString()}] [PERMANENT FAILURE] Job ${job.id}`);
          } else {
            // Retryable failure with exponential backoff
            const delay = Math.pow(2, job.attempt_count + 1); // seconds
            const runAt = new Date(Date.now() + delay * 1000);

            await pool.query(
              `UPDATE jobs
               SET status=$1,
                   attempt_count = attempt_count + 1,
                   error_message=$2,
                   run_at=$3,
                   updated_at=now()
               WHERE id=$4`,
              ["PENDING", err.message, runAt, job.id]
            );
            console.log(`[${new Date().toISOString()}] [RETRY] Job ${job.id} will retry at ${runAt.toISOString()} (attempt ${job.attempt_count + 1}, delay ${delay}s)`);
          }
        }

      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
        throw err;
      }
    } catch (err) {
      console.error(`[${new Date().toISOString()}] [WORKER ERROR]`, err);
      await sleep(2000);
    }
  }
}

// Start the worker loop
processJobs();

// Export metrics for external monitoring if needed
module.exports = { metrics };
