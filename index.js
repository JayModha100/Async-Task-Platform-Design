require("dotenv").config();
const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json());

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
        updated_at TIMESTAMP DEFAULT now()
      )
    `);
    console.log("Jobs table is ready");

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

// POST /jobs
app.post("/jobs", async (req, res) => {
  try {
    const query = `
      INSERT INTO jobs (task_type, payload, status)
      VALUES ($1, $2, $3)
      RETURNING id
    `;
    const values = [
      "sleep_test",
      { seconds: 2 }, // JSONB payload
      "PENDING"
    ];

    const result = await pool.query(query, values);
    res.status(201).json({ job_id: result.rows[0].id });
  } catch (err) {
    console.error("Error inserting job:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Async Task Platform API is running"
  });
});

// Listen on all interfaces (important for Docker/Codespaces)
app.listen(3000, "0.0.0.0", () => {
  console.log("API running on port 3000");
});
