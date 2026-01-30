## Async Task Processing Platform
A lightweight async job processing system inspired by Celery / Sidekiq, built to understand core backend fundamentals such as background workers, retries, idempotency, and failure handling.

This project intentionally prioritizes correctness and system design over external queues or managed services.

## Problem Statement
### Synchronous APIs should not block on long-running or unreliable tasks (emails, reports, sleeps, third-party calls).

This system allows clients to submit jobs that are executed asynchronously by background workers.

## High-Level Architecture
Client
  ↓
API Service (Node.js)
  ↓
PostgreSQL (jobs table)
  ↑
Worker Service (Node.js)

- API accepts job requests and persists them

- PostgreSQL acts as a durable job queue

- Workers poll, lock, execute, and update job state

## Job Lifecycle
 PENDING → IN_PROGRESS → COMPLETED
              ↓
           FAILED → RETRY → DEAD


- Jobs start in PENDING

- Workers atomically claim jobs using database locks

- Successful execution → COMPLETED

- Failed execution → retried with backoff

- Exceeded retry limit → DEAD

- Core Guarantees

- At-least-once execution

- Idempotent job submission

- Crash-safe workers

- Safe concurrent workers

- Retry with backoff

This system provides at-least-once delivery; duplicate execution is possible and controlled via idempotency.

 Idempotency
-
- Jobs can include an idempotency_key.

- Enforced via a unique constraint in PostgreSQL

- Duplicate API requests with the same key are safely ignored

- Allows clients to retry requests without creating duplicate work

- Failure Handling

- Worker crashes → job is recovered by another worker

- Execution errors → job marked FAILED and retried

- Max retries exceeded → job moved to DEAD

- Failures are treated as first-class scenarios, not edge cases.

# Tech Stack

- Node.js — API and Worker services

- PostgreSQL — durable queue, locking, and state

- Docker + Docker Compose — local orchestration

- Redis / Kafka are intentionally avoided to demonstrate fundamentals using a relational database.

Running Locally
docker-compose up --build

# Services

- API → http://localhost:3000

- PostgreSQL → localhost:5432

# Health Check
GET /health
→ { "status": "ok" }


## Used for basic service liveness verification.

- Design Decisions

- PostgreSQL chosen for durability, visibility, and row-level locking

- Database-level constraints preferred over application-level checks

- Minimal abstractions to keep system behavior observable

## What This Project Demonstrates

- Async system design

- Job state modeling

- Idempotency via database guarantees

- Worker crash recovery

- Backend trade-off reasoning

- Future Improvements

- Dead-letter queue processing

- Job prioritization

- Metrics and observability

- API authentication

- Resume Description

## Async Task Processing Platform (Node.js, PostgreSQL, Docker)

Designed and implemented an async job processing system with retries, scheduling, and worker crash recovery

Enforced idempotent job submission using database-level constraints

Built fault-tolerant workers with safe concurrent execution

Containerized services using Docker Compose
