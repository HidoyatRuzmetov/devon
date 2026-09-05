-- Expand-only (I-15). Idempotent via `if not exists`.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists citext;
create extension if not exists vector;

create schema if not exists app;
create schema if not exists audit;
