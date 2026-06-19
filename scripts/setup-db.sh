#!/bin/bash
set -e

echo "=== PayrollSync Database Setup ==="

# Check if PostgreSQL is running
if ! pg_isready -q 2>/dev/null; then
  echo "Starting PostgreSQL..."
  service postgresql start 2>/dev/null || true
fi

# Create user and database
psql -U postgres << 'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'payroll') THEN
    CREATE ROLE payroll WITH LOGIN PASSWORD 'payroll';
  END IF;
END $$;
CREATE DATABASE payroll_db OWNER payroll;
GRANT ALL PRIVILEGES ON DATABASE payroll_db TO payroll;
SQL

echo "Database created."

# Run Prisma migrations
cd "$(dirname "$0")/.."
npx prisma generate
npx prisma db push

echo "=== Setup Complete ==="
echo "Run: npm run dev"
