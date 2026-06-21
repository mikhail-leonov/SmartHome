-- ─────────────────────────────────────────────────────────────
-- SmartHome schema
--
-- Run with:  npm run db:init
-- (or pipe this file into the mysql CLI). Creates the database if it
-- does not exist and all tables idempotently.
-- ─────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS smarthome
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE smarthome;

-- Current value of every variable, one row per topic.
CREATE TABLE IF NOT EXISTS variables (
  topic       VARCHAR(255) NOT NULL PRIMARY KEY,
  room        VARCHAR(64)  NULL,
  device      VARCHAR(64)  NULL,
  variable    VARCHAR(64)  NULL,
  value       TEXT         NULL,
  unit        VARCHAR(32)  NULL,
  updated_at  DATETIME     NOT NULL,
  INDEX idx_variables_room (room),
  INDEX idx_variables_updated (updated_at)
) ENGINE=InnoDB;

-- Append-only log of every state change.
CREATE TABLE IF NOT EXISTS variable_history (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  topic       VARCHAR(255) NOT NULL,
  value       TEXT         NULL,
  unit        VARCHAR(32)  NULL,
  recorded_at DATETIME     NOT NULL,
  INDEX idx_history_topic (topic),
  INDEX idx_history_recorded (recorded_at)
) ENGINE=InnoDB;

-- Audit trail of internal bus events.
CREATE TABLE IF NOT EXISTS events (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(64)  NOT NULL,
  payload     TEXT         NULL,
  created_at  DATETIME     NOT NULL,
  INDEX idx_events_name (name),
  INDEX idx_events_created (created_at)
) ENGINE=InnoDB;

-- Every actor execution: which rule fired it, with what params, and the result.
CREATE TABLE IF NOT EXISTS actor_runs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_id    VARCHAR(64)  NOT NULL,
  params      TEXT         NULL,
  rule_id     VARCHAR(64)  NULL,
  status      ENUM('ok','error') NOT NULL DEFAULT 'ok',
  error       TEXT         NULL,
  created_at  DATETIME     NOT NULL,
  INDEX idx_actor_runs_actor (actor_id),
  INDEX idx_actor_runs_created (created_at)
) ENGINE=InnoDB;

-- Registry of discovered plugins.
CREATE TABLE IF NOT EXISTS plugins (
  id            VARCHAR(64) NOT NULL PRIMARY KEY,
  kind          ENUM('sensor','actor') NOT NULL,
  enabled       TINYINT(1)  NOT NULL DEFAULT 1,
  discovered_at DATETIME    NOT NULL
) ENGINE=InnoDB;
