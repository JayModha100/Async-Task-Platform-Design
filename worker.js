require("dotenv").config();
const pool = require("./db");

console.log("Worker started");

// Simple sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processJobs() {
  while (true) {
    try {
      // 1️⃣ Fetch one PENDING job
      const { rows } = await pool.query(
        "SELECT * FROM jobs WHERE status = 'PENDING' ORDER BY id LIMIT 1"
      );

      if (rows.length === 0) {
        // No jobs → wait 2 seconds and retry
        await sleep(2000);
        continue;
      }

      const job = rows[0];
      console.log(`Found job ${job.id}: ${job.task_type}`);

      // 2️⃣ Mark it as IN_PROGRESS
      await pool.query(
        "UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2",
        ["IN_PROGRESS", job.id]
      );
      console.log(`Job ${job.id} set to IN_PROGRESS`);

      // 3️⃣ Execute the task (sleep_test)
      const seconds = job.payload.seconds || 1;
      console.log(`Executing sleep_test for ${seconds} seconds...`);
      await sleep(seconds * 1000);

      // 4️⃣ Mark as SUCCEEDED
      await pool.query(
        "UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2",
        ["SUCCEEDED", job.id]
      );
      console.log(`Job ${job.id} completed successfully`);
    } catch (err) {
      console.error("Worker error:", err);
      await sleep(2000); // wait before retrying if error occurs
    }
  }
}

// Start the worker loop
processJobs();
