# PayrollSync — Enterprise Payroll Reconciliation System

A production-grade payroll reconciliation platform for multi-company hotel groups using German payroll (Lohnabrechnung) and Sparkasse bank export files.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Windows Machine (D:\)                              │
│  ┌─────────────────┐                                │
│  │  Local Ingestion │  ──── POST /api/files/upload ─┤
│  │  Agent (Node.js) │                               │
│  └─────────────────┘                                │
└─────────────────────────────────────────────────────┘
                                                       │
┌─────────────────────────────────────────────────────▼
│  Next.js Web Application (TypeScript + Tailwind)    │
│  ┌──────────────┐  ┌───────────────┐               │
│  │  Dashboard UI │  │  REST API     │               │
│  │  (React)      │  │  (/api/*)     │               │
│  └──────────────┘  └───────────────┘               │
│                           │                         │
│  ┌────────────────────────▼────────────────────┐   │
│  │  Core Engines                               │   │
│  │  • Schema Detector (column auto-mapping)    │   │
│  │  • File Parser (German CSV/number/date)     │   │
│  │  • Fuzzy Matcher (name + IBAN matching)     │   │
│  │  • Temporal Inference (salary month)        │   │
│  │  • Reconciliation Engine (payroll vs bank)  │   │
│  └────────────────────────────────────────────┘   │
│                           │                         │
│  ┌────────────────────────▼──────────────┐         │
│  │  PostgreSQL + Prisma ORM              │         │
│  └───────────────────────────────────────┘         │
└─────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Database Setup

```bash
# Install PostgreSQL, then:
bash scripts/setup-db.sh
```

Or manually:
```sql
CREATE ROLE payroll WITH LOGIN PASSWORD 'payroll';
CREATE DATABASE payroll_db OWNER payroll;
```

Then run migrations:
```bash
npx prisma db push
npx prisma generate
```

### 2. Web Application

```bash
npm install
npm run dev        # Development
npm run build      # Production build
npm start          # Production server
```

Open http://localhost:3000

### 3. Local File Ingestion Agent (Windows)

The agent runs on your Windows machine and watches `D:\` for new payroll/bank CSV files.

```bash
cd agent
npm install
cp .env.example .env
# Edit .env: set API_URL=http://your-server:3000
npm start
```

The agent will:
- Scan `D:\` recursively every 5 minutes
- Classify files as PAYROLL or BANK_TRANSACTION
- Skip already-uploaded files (SHA256 hash deduplication)
- Push new files to the web app automatically

## File Formats Supported

### Payroll (Lohnabrechnung)
Sparkasse/DATEV-format CSV with German headers:
- `Pers.-Nr.` → Employee ID
- `Name` → Employee Name
- `Gesamt-Brutto` → Gross Salary
- `Auszahlungsbetrag` → Net Pay
- `Lohnsteuer`, `KV-Beitrag AN/AG`, `RV-Beitrag AN/AG`, etc.

### Bank Transactions (Kontoauszug)
Sparkasse export CSV (semicolon-delimited):
- `Auftragskonto` → Account IBAN
- `Buchungstag` → Booking Date
- `Verwendungszweck` → Payment Reference
- `Betrag` → Amount
- `Beguenstigter/Zahlungspflichtiger` → Counterparty

## Reconciliation Logic

Matching uses a weighted scoring system (0–100):

| Signal | Weight |
|--------|--------|
| IBAN match | 90 pts |
| Fuzzy name match | up to 50 pts |
| Amount within 1% | 30 pts |
| Date proximity (≤45 days) | up to 20 pts |

Status outcomes:
- **PAID** — confidence ≥70 + amount within 1%
- **PARTIAL** — matched but underpaid
- **OVERPAID** — paid >101% of expected
- **UNPAID** — no match found
- **NEEDS_REVIEW** — match found but low confidence

## Environment Variables

```env
DATABASE_URL="postgresql://payroll:payroll@localhost:5432/payroll_db"
AGENT_API_KEY="your-secret-key"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

## Project Structure

```
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Executive Dashboard
│   │   ├── companies/          # Company management
│   │   ├── employees/          # Employee views
│   │   ├── reconciliation/     # Reconciliation UI
│   │   ├── upload/             # File upload UI
│   │   └── api/                # REST API routes
│   ├── components/
│   │   ├── layout/Sidebar.tsx
│   │   └── ui/                 # KpiCard, StatusBadge
│   └── lib/
│       ├── prisma.ts           # DB client
│       ├── file-parser.ts      # CSV/number/date parsing
│       ├── schema-detector.ts  # Column auto-mapping
│       ├── fuzzy-matcher.ts    # Name/IBAN matching
│       ├── temporal-inference.ts  # Month detection
│       ├── reconciliation-engine.ts  # Core matching
│       └── file-processor.ts   # Payroll/bank processor
├── agent/                      # Local ingestion agent
│   └── src/
│       ├── index.js            # Main entry + watcher
│       ├── scanner.js          # Directory scanner
│       ├── classifier.js       # File type detection
│       ├── uploader.js         # API uploader
│       └── state.js            # Hash deduplication state
├── prisma/
│   └── schema.prisma           # Database schema
└── scripts/
    ├── setup-db.sh             # DB initialization
    └── seed.ts                 # Sample data seed
```
