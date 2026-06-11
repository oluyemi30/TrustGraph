# 🧠 Trust Graph Engine

A trust graph intelligence system that models reputation using weighted attestations, multi-hop propagation, and AI-based analysis. It combines a Telegram bot interface with a web-based visualization layer to explore how trust flows across entities.

⸻

## 🚀 Overview

Trust Graph Engine is a system that turns user opinions into a structured intelligence network.

Instead of simple ratings, it builds a graph of trust relationships between entities such as people, projects, wallets, or any named identity.

The system then computes:
 • Weighted reputation scores
 • Trust propagation across connections
 • Risk indicators
 • Confidence levels

It also uses AI to explain why an entity is trusted or risky.

⸻

## 🧩 Key Features

### 🕸 Trust Graph System
 • Entities are represented as nodes (people, projects, wallets, etc.)
 • Attestations create relationships between nodes
 • Trust flows across connections in the graph

⸻

### ⚖️ Weighted Reputation Engine
 • User inputs are weighted based on credibility
 • Recent activity is prioritized using time decay
 • Final scores are calculated using weighted consensus, not simple averages

⸻

### 🔁 Multi-Hop Trust Propagation
 • Trust influences spread across connected nodes
 • Indirect relationships (A → B → C) affect reputation scoring
 • Decay applied over distance to reduce inflated influence

⸻

### 🛡 Risk Detection System
 • Detects suspicious voting patterns
 • Identifies clustered or low-diversity inputs
 • Flags anomalies in trust behavior

⸻

### 🧠 AI Explanation Layer
 • Generates natural language explanations of trust scores
 • Summarizes why an entity is trusted or flagged as risky
 • Improves interpretability of graph results

⸻

### 🤖 Telegram Bot Interface
 • `/attest` → submit trust ratings
 • `/trust` → view reputation analysis
 • `/graph` → explore relationships
 • `/entities` → view ranked entities

⸻

### 🌐 Web Visualization Dashboard
 • Interactive graph visualization using node-link structure
 • Real-time updates from Telegram interactions
 • Displays trust flow and relationship strength

⸻

## 🏗 System Architecture

```
Telegram Bot
      ↓
Backend API
      ↓
Trust Graph Engine
      ↓
Database (Entities + Attestations)
      ↓
AI Analysis Layer
      ↓
Web Visualization Dashboard
```

⸻

## 📊 Core Concepts
 • **Entity**: Any subject being evaluated (project, wallet, person, etc.)
 • **Attestation**: A trust signal from a user about an entity
 • **Weight**: Influence score of a user’s input
 • **Propagation**: How trust spreads through connected nodes
 • **Confidence**: How reliable a score is based on data density and diversity

⸻

## 🧪 Status

This project is currently in active development and evolving into a full trust intelligence system.

⸻

## 🌐 Supabase Activation Storage

For Vercel-compatible hosted activation storage, configure Supabase and set these environment variables:

  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

The backend now routes Telegram activation codes and wallet link lookups through Supabase when those variables are present.

Recommended tables:

  activation_codes (wallet_address text unique, code text, created_at timestamptz)
  wallet_links (wallet_address text unique, telegram_user text, telegram_id text, activated_at timestamptz)

Use `npm run migrate:supabase` to migrate any local wallet link or activation code data after setting the Supabase env vars.

⸻

## 💡 Inspiration

This project is inspired by the idea of decentralized knowledge and trust systems, where information is structured as a graph rather than isolated opinions.

⸻

## ⚠️ Disclaimer

This system is experimental and should not be used as a financial, identity, or security authority.

⸻

## 📌 Future Improvements
 • Cross-chain wallet integration
 • On-chain attestation support
 • Advanced Sybil attack detection
 • Real-time distributed graph updates
 • Improved AI reasoning layer
