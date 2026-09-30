# Expense Backend v5 — API Documentation

## Overview

**Base URL:** `http://<host>:8080` (through the frontend/LB: `http://<host>/api`)
**Default Port:** `8080` (override with `APP_PORT` environment variable)
**Content-Type:** `application/json`
**Node.js:** `>= 24`

The Expense Backend is a Node.js/Express REST API that manages expense transactions stored in MySQL. It supports creating, reading, updating and deleting transactions, and it has a few extra endpoints for demonstrating HTTP status codes.

---

## Database Schema

```sql
CREATE TABLE transactions (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    amount      INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    category    VARCHAR(50) NOT NULL
);
```

### Transaction Object

| Field       | Type    | Description                          |
|-------------|---------|--------------------------------------|
| id          | integer | Auto-generated unique identifier     |
| amount      | integer | Transaction amount (positive integer, max 1,000,000) |
| description | string  | Short description (max 255 characters) |
| category    | string  | One of the valid categories (see below) |

### Valid Categories

`Food` | `Travel` | `Entertainment` | `Shopping` | `Health` | `Utilities` | `Other`

---

## Environment Variables

| Variable                | Default        | Description                                   |
|-------------------------|----------------|-----------------------------------------------|
| `APP_PORT`              | `8080`         | Port the server listens on                    |
| `DB_HOST`               | *(empty)*      | MySQL host address                            |
| `DB_USER`               | `expense`      | MySQL username                                |
| `DB_PWD`                | `ExpenseApp@1` | MySQL password                                |
| `DB_DATABASE`           | `transactions` | MySQL database name                           |
| `ADMIN_TOKEN`           | `admin123`     | Token required by `DELETE /transaction`       |
| `RATE_LIMIT_MAX`        | `10`           | Write requests allowed per client per window  |
| `RATE_LIMIT_WINDOW_SEC` | `60`           | Rate-limit window in seconds                  |

---

## Common Error Responses

These can come back from any endpoint that touches the database or takes a body.

| Status | When | Body |
|--------|------|------|
| `400` | Body is not valid JSON, or `:id` is not a positive integer | `{ "message": "malformed JSON body" }` / `{ "message": "invalid id" }` |
| `404` | Unknown route | `{ "message": "route GET /xyz not found" }` |
| `413` | Body larger than 10 KB | `{ "message": "request body too large (limit 10kb)" }` |
| `415` | `POST`/`PUT` without `Content-Type: application/json` | `{ "message": "Content-Type must be application/json" }` |
| `429` | More than `RATE_LIMIT_MAX` write requests (`POST`, `PUT`, `DELETE`) in the window. Has a `Retry-After` header. | `{ "message": "too many requests, try again in 42s" }` |
| `500` | Database returned an error (e.g. table missing), or unhandled exception | `{ "message": "...", "error": "<detail>" }` |
| `503` | Database is unreachable (connection refused / timed out). Has `Retry-After: 30`. | `{ "message": "database unavailable", "error": "<detail>" }` |

Write requests also return `RateLimit-Limit` and `RateLimit-Remaining` headers.

---

## Endpoints

### Health Check

#### `GET /health`

Checks that the service is up **and** can reach MySQL.

**Response `200 OK`**
```json
{ "status": "ok", "db": "up" }
```

**Response `503 Service Unavailable`**
```json
{ "status": "degraded", "db": "down", "error": "connect ECONNREFUSED 10.0.1.5:3306" }
```

---

### Transactions

#### `GET /transaction`

Retrieves all transactions, newest first.

**Response `200 OK`**
```json
{
  "result": [
    { "id": 3, "amount": 500,  "description": "Groceries",     "category": "Food" },
    { "id": 2, "amount": 1200, "description": "Flight ticket", "category": "Travel" }
  ]
}
```

The response has an `ETag` header. Send it back as `If-None-Match` and, if nothing changed, you get **`304 Not Modified`** with no body.

---

#### `GET /transaction/:id`

Retrieves a single transaction.

| Response | When |
|----------|------|
| `200 OK` | Found — body is the transaction object |
| `304 Not Modified` | `If-None-Match` matches the current `ETag` |
| `400 Bad Request` | `id` is not a positive integer |
| `404 Not Found` | `{ "message": "transaction <id> not found" }` |

---

#### `POST /transaction`

Creates a new transaction.

**Request Body**

```json
{
  "amount": 750,
  "description": "Monthly electricity bill",
  "category": "Utilities"
}
```

| Field         | Type    | Required | Constraints                          |
|---------------|---------|----------|--------------------------------------|
| `amount`      | integer | Yes      | Positive integer, max 1,000,000      |
| `description` | string  | Yes      | Non-empty string, max 255 characters |
| `category`    | string  | Yes      | One of the valid categories          |

**Response `201 Created`** — with header `Location: transaction/<id>`
```json
{ "message": "transaction added successfully", "id": 7 }
```

**Response `422 Unprocessable Content`** — JSON is fine but the values break the rules
```json
{
  "message": "validation failed",
  "errors": [
    "amount must be a positive integer",
    "category must be one of: Food, Travel, Entertainment, Shopping, Health, Utilities, Other"
  ]
}
```

Also: `400`, `413`, `415`, `429` (see Common Error Responses).

---

#### `PUT /transaction/:id`

Updates an existing transaction. Send **all three fields**, same body and rules as `POST`.

**Response `200 OK`**
```json
{
  "message": "transaction updated successfully",
  "transaction": { "id": 7, "amount": 800, "description": "Electricity bill", "category": "Utilities" }
}
```

| Other responses | When |
|-----------------|------|
| `400 Bad Request` | `id` is not a positive integer, or malformed JSON |
| `404 Not Found` | No transaction with that `id` |
| `422 Unprocessable Content` | Validation failed |

---

#### `DELETE /transaction/:id`

Deletes a single transaction.

| Response | When |
|----------|------|
| `204 No Content` | Deleted — no body |
| `400 Bad Request` | `id` is not a positive integer |
| `404 Not Found` | No transaction with that `id` |

---

#### `DELETE /transaction`

Deletes **all** transactions. Needs the admin token:

```
Authorization: Bearer <ADMIN_TOKEN>
```

| Response | When |
|----------|------|
| `200 OK` | `{ "message": "all transactions deleted", "deleted": 5 }` |
| `401 Unauthorized` | No token sent. Has `WWW-Authenticate: Bearer realm="expense"` |
| `403 Forbidden` | Token sent but wrong |

---

#### Other methods

Any other method on `/transaction` or `/transaction/:id` (e.g. `PATCH`) returns **`405 Method Not Allowed`** with an `Allow` header listing the methods that do work.

---

### Redirects

Redirect targets are relative (`transaction`, not `/transaction`) so they work both on port 8080 and behind nginx under `/api/`.

| Method & Path | Status | Redirects to | Why |
|---------------|--------|--------------|-----|
| `GET /transactions` | `301 Moved Permanently` | `transaction` | Old plural URL, moved for good |
| `POST /transactions` (any non-GET) | `308 Permanent Redirect` | `transaction` | Same, but the client must keep the method and body |
| `GET /latest` | `302 Found` | `transaction/<newest id>` | Temporary — target changes as data changes. `404` if there are no transactions |

---

### Demo Endpoints

| Method & Path | Status | What it does |
|---------------|--------|--------------|
| `GET /error` | `500 Internal Server Error` | Throws an exception in the route |
| `GET /maintenance` | `503 Service Unavailable` | Pretends to be in maintenance. `Retry-After: 60` |
| `GET /slow?seconds=N` | `200 OK` after N seconds | Default 40, max 120. Behind nginx this becomes `504` when N is larger than `proxy_read_timeout` |

---

## Validation Rules

| Field         | Rule                                                                 |
|---------------|----------------------------------------------------------------------|
| `amount`      | Required; must be a positive integer; cannot exceed 1,000,000       |
| `description` | Required; cannot be blank; max 255 characters                        |
| `category`    | Required; must exactly match one of the seven valid category values  |

---

## Quick Reference

| Method   | Path               | Success | Description                    |
|----------|--------------------|---------|--------------------------------|
| GET      | `/health`          | 200     | Service + DB health            |
| GET      | `/transaction`     | 200     | List all transactions          |
| POST     | `/transaction`     | 201     | Create a transaction           |
| DELETE   | `/transaction`     | 200     | Delete all (admin token)       |
| GET      | `/transaction/:id` | 200     | Get a transaction by ID        |
| PUT      | `/transaction/:id` | 200     | Update a transaction by ID     |
| DELETE   | `/transaction/:id` | 204     | Delete a transaction by ID     |
| GET      | `/transactions`    | 301     | Old URL → `/transaction`       |
| POST     | `/transactions`    | 308     | Old URL → `/transaction`       |
| GET      | `/latest`          | 302     | Newest transaction             |
| GET      | `/error`           | 500     | Demo                           |
| GET      | `/maintenance`     | 503     | Demo                           |
| GET      | `/slow`            | 200     | Demo (504 behind nginx)        |

---

## Dependencies

| Package       | Version   | Purpose                        |
|---------------|-----------|--------------------------------|
| express       | ^4.18.2   | HTTP server framework          |
| body-parser   | ^1.20.2   | JSON request body parsing      |
| cors          | ^2.8.5    | Cross-origin resource sharing  |
| mysql2        | ^3.6.0    | MySQL database driver (pooled) |
