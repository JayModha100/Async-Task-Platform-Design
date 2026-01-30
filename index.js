require("dotenv").config();
const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

// In-memory metrics (minimal)
let metrics = {
  jobs_processed: 0,
  jobs_succeeded: 0,
  jobs_failed: 0
};

// Wait until Postgres is ready
async function waitForPostgres(retries = 10, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("Postgres is ready");
      return;
    } catch (err) {
      console.log(`Postgres not ready, retrying... (${i + 1}/${retries})`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw new Error("Postgres connection failed after retries");
}

// Initialize DB safely
async function initDB() {
  try {
    // Create jobs table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        task_type TEXT NOT NULL,
        payload JSONB,
        status TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        idempotency_key TEXT
      )
    `);

    // Create unique index for idempotency
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency
      ON jobs (idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `);

    console.log("Jobs table and idempotency index are ready");

    // Create trigger to auto-update updated_at
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trigger_jobs_updated_at'
        ) THEN
          CREATE TRIGGER trigger_jobs_updated_at
          BEFORE UPDATE ON jobs
          FOR EACH ROW
          EXECUTE FUNCTION set_updated_at();
        END IF;
      END
      $$;
    `);
    console.log("Trigger for updated_at is ready");
  } catch (err) {
    console.error("Error initializing database:", err);
  }
}

// Full initialization: wait for Postgres then init DB
async function init() {
  try {
    await waitForPostgres();
    await initDB();
  } catch (err) {
    console.error("Failed to initialize DB:", err);
  }
}

// Start initialization
init();

// POST /jobs — create new job with idempotency support
app.post("/jobs", async (req, res) => {
  try {
    const { task_type = "sleep_test", payload = {}, idempotency_key } = req.body;
    let result;

    if (idempotency_key) {
      // Attempt to insert job, skip if idempotency_key exists
      result = await pool.query(
        `INSERT INTO jobs (task_type, payload, status, idempotency_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [task_type, payload, "PENDING", idempotency_key]
      );

      if (result.rows.length > 0) {
        // Successfully inserted new job
        return res.status(201).json({ job_id: result.rows[0].id });
      }

      // Otherwise, fetch existing job by idempotency_key
      const existing = await pool.query(
        "SELECT id FROM jobs WHERE idempotency_key = $1",
        [idempotency_key]
      );

      return res.status(200).json({
        job_id: existing.rows[0].id,
        message: "Existing job returned"
      });
    } else {
      // No idempotency key — normal insert
      result = await pool.query(
        `INSERT INTO jobs (task_type, payload, status)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [task_type, payload, "PENDING"]
      );

      return res.status(201).json({ job_id: result.rows[0].id });
    }
  } catch (err) {
    // Handle unique constraint violation (race condition)
    if (err.code === "23505" && req.body.idempotency_key) {
      const existing = await pool.query(
        "SELECT id FROM jobs WHERE idempotency_key = $1",
        [req.body.idempotency_key]
      );
      return res.status(200).json({
        job_id: existing.rows[0].id,
        message: "Existing job returned due to race condition"
      });
    }

    console.error("Error inserting job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET / — simple health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Async Task Platform API is running"
  });
});

// GET /jobs/:id — observability: get full job info
app.get("/jobs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error fetching job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /metrics — optional minimal metrics
app.get("/metrics", (req, res) => {
  res.json(metrics);
});

// Listen on all interfaces (important for Docker/Codespaces)
app.listen(3000, "0.0.0.0", () => {
  console.log("API running on port 3000");
});
