# MediBook Frontend

React + Vite frontend for the MediBook appointment booking case study.

## Prerequisites

- Backend gateway running at `http://localhost:8080`
- Node.js installed

## Setup

```powershell
npm.cmd install
```

## Run in Development

```powershell
npm.cmd run dev
```

Default frontend URL: `http://localhost:5173`

## Build

```powershell
npm.cmd run build
```

## Environment

Copy `.env.example` to `.env` if you want to override the backend URL.

```env
VITE_API_BASE_URL=http://localhost:8080
```
