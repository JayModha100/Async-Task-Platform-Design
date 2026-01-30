# Async-Task-Platform-Design
Async Task Processing Platform

A lightweight async job processing system inspired by Celery / Sidekiq, built to understand backend fundamentals like background workers, retries, idempotency, and failure handling.

This project focuses on correctness and system design, not external queues or managed services.

Problem Statement

Synchronous APIs should not block on long-running or unreliable tasks (emails, reports, sleeps, integrations). This system allows clients to submit jobs that are processed asynchronously by background workers.

High-Level Architecture
Client
  ↓
API Service (Node.js)
  ↓
PostgreSQL (jobs table)
  ↑
Worker Service (Node.js)

API accepts job requests and persists them

PostgreSQL acts as the durable job queue

Workers poll, lock, execute, and update job state

Job Lifecycle
PENDING → IN_PROGRESS → COMPLETED
              ↓
           FAILED → RETRY → DEAD

Jobs start in PENDING

Workers atomically claim jobs using DB locks

On success → COMPLETED

On failure → retry with backoff

After max retries → DEAD

Core Guarantees

At-least-once execution

Idempotent job submission (no duplicates)

Crash-safe workers

Safe concurrent workers

Retry with backoff

Idempotency

Jobs can include an idempotency_key.

Enforced via a unique constraint in PostgreSQL

Duplicate API requests with the same key are safely ignored

Ensures clients can retry requests without creating duplicate work

Failure Handling

Worker crashes → job is recovered by another worker

Execution errors → job marked FAILED and retried

Exceeded retry limit → job moved to DEAD

Failures are treated as first-class scenarios, not edge cases.

Tech Stack

Node.js (API + Worker)

PostgreSQL (durable queue, locking, state)

Docker + Docker Compose (local orchestration)

No Redis / Kafka used intentionally to demonstrate fundamentals.

Running Locally
docker-compose up --build

Services:

API → localhost:3000

PostgreSQL → localhost:5432

Health Check
GET /health
→ { "status": "ok" }

Used for basic service liveness verification.

Design Decisions

PostgreSQL chosen for durability, visibility, and locking

DB-level constraints used instead of app-level checks

Minimal abstractions to keep behavior observable

What This Project Demonstrates

Async system design

Job state modeling

Idempotency via database guarantees

Worker crash recovery

Backend trade-off reasoning

Future Improvements

Dead-letter queue processing

Job prioritization

Metrics and observability

API authentication

Resume Description

Async Task Processing Platform (Node.js, PostgreSQL, Docker)

Designed and implemented an async job processing system with retries, scheduling, and crash recovery

Enforced idempotent job submission using database-level constraints

Built fault-tolerant workers with safe concurrent execution

Containerized services using Docker Compose
