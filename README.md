# MAJUU App (Study • Work • Travel)

MAJUU is a web app designed to make **Study Abroad, Work Abroad, and Travel Abroad** processes more accessible—especially for users who can’t easily reach physical agents. The app guides users through two modes:

- **Self-Help (Free):** users follow guided steps, checklists, and structured flow to organize their process.
- **We-Help (Assisted):** users submit structured requests to the MAJUU team, optionally upload documents when required, and track progress/status updates in the app.

This repository contains the full source code for the MAJUU frontend (Vite + React) and its Firebase-backed data flows.

---

## Table of Contents

- [What MAJUU Does](#what-majuu-does)
- [Key User Flows](#key-user-flows)
  - [Tracks (Study / Work / Travel)](#tracks-study--work--travel)
  - [Self-Help vs We-Help](#self-help-vs-we-help)
  - [Single Services](#single-services)
  - [Full Package](#full-package)
  - [Document Upload + Review](#document-upload--review)
  - [Request Status + Retry](#request-status--retry)
  - [Progress Screen](#progress-screen)
  - [Admin Tools](#admin-tools)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Environment & Configuration](#environment--configuration)
  - [Firebase Setup](#firebase-setup)
  - [Environment Variables (.env)](#environment-variables-env)
  - [Security Notes](#security-notes)
- [Running Locally](#running-locally)
- [Build & Deploy](#build--deploy)
- [Common Tasks](#common-tasks)
  - [Make a Backup (GitHub)](#make-a-backup-github)
  - [Update Your Backup (Commit + Push)](#update-your-backup-commit--push)
- [Development Notes](#development-notes)
  - [Data Model Overview](#data-model-overview)
  - [Attachments + Admin Files Overview](#attachments--admin-files-overview)
  - [Rules & Permissions](#rules--permissions)
- [Status](#status)
- [License / Ownership](#license--ownership)

---

## What MAJUU Does

MAJUU helps users plan and execute study/work/travel abroad journeys by providing:

### ✅ User-Facing Features
- **Account creation and login** (Firebase Auth)
- **Profile management** (name, phone, etc.) to support assisted requests
- **Track selection:** Study, Work, or Travel
- **Country selection** within a track (e.g., Study → Australia)
- **Self-Help flow**: structured steps/checklists without needing to contact agents
- **We-Help flow**: user submits a request to the MAJUU team with relevant details
- **Progress tracking**: all requests appear in the Progress screen with live status
- **Request Status screen**: shows request details, decision notes, and documents
- **Document upload (when required)**: user can upload PDFs for review
- **Retry flow** for rejected requests: “Try again” deep-links into the correct modal

### ✅ Admin-Facing Features
- **Admin request list**: see all We-Help requests
- **Request details screen**: view full request info
- **Admin decision updates**: status changes and notes
- **Admin document sending**: send downloadable files back to the user
- **Request documents screen**: view user submitted docs tied to a request

---

## Key User Flows

### Tracks (Study / Work / Travel)
MAJUU organizes user journeys by track:
- **Study**
- **Work**
- **Travel**

Each track can have:
- a country (optional but usually selected by the user)
- Self-Help flow
- We-Help flow

---

### Self-Help vs We-Help

#### Self-Help (Free)
- Guides users through steps without submitting a request.
- Helps users organize their journey and understand requirements.

#### We-Help (Assisted)
- Users submit requests to the MAJUU team.
- Requests are tracked and updated in real-time.
- Some services enable document uploads (PDFs), which admins can review.

---

### Single Services
Single services are individual requests under a track and country, e.g.:
- Passport Application
- Visa Application
- IELTS Training
- SOP / Motivation Letter
- CV / Resume
- Document Review (often needs attachments)

Users open a **RequestModal** to submit the service request.

---

### Full Package
“Full Package” is a multi-step assisted process. Instead of a single quick request, it can require users to:
- complete profile prerequisites
- check missing item lists
- submit structured package steps
- upload documents when required

Full package uses a “missing items” screen/flow so the team can guide the user step-by-step.

---

### Document Upload & Review

MAJUU supports two document directions:

#### 1) User → Admin (Submitted Documents)
- User selects PDFs in the request flow (when attachments are enabled).
- Files create records (often Firestore subcollection entries).
- Admin sees them in admin document screens.
- User sees submitted documents on their Request Status screen.

#### 2) Admin → User (Documents from MAJUU)
- Admin can upload/send documents back to the user (templates, SOPs, forms).
- User sees these under “Documents from MAJUU” with Open/Download buttons.

---

### Request Status & Retry

A request can move through statuses like:
- `new` → Submitted
- `contacted` → In progress / received
- `closed` → Completed/succeeded
- `rejected` → Needs correction

If a request is rejected:
- The Request Status screen shows the admin’s note
- A **Try again** button appears
- Try again deep-links to the correct place:
  - **Full package** → opens the Full Package missing/request modal for that track+country
  - **Single service** → opens the correct We-Help screen and auto-opens the RequestModal for that service

This prevents the user from having to “search around” to re-submit properly.

---

### Progress Screen
The Progress screen acts as the user’s “dashboard for activity”:
- shows **Current Process** (if the user is in an active flow)
- lists **all We-Help requests**
- each request has:
  - status badge
  - View button
  - Try again button (if rejected)
  - Delete button (when allowed)

---

### Admin Tools
Admin-only screens allow:
- viewing all requests
- opening request details
- reviewing user-submitted docs
- sending documents back to users
- updating status and leaving notes

Admin access is typically protected by:
- checking the authenticated user’s email
- Firestore rules enforcing admin-only writes

---

## Tech Stack

- **Frontend:** React + Vite
- **Styling:** Tailwind CSS
- **Backend Services:** Firebase
  - **Auth** (login/signup)
  - **Firestore** (requests, user profiles, request subcollections)
  - **Storage** (uploaded PDFs, admin files)
- **Realtime updates:** Firestore `onSnapshot`
- **Version control:** Git + GitHub

---

## Project Structure

> Exact structure may evolve, but generally:

### Typical folder responsibilities

#### `src/screens`
- Full page experiences:
  - ProgressScreen
  - RequestStatusScreen
  - We-Help screens (StudyWeHelp, WorkWeHelp, TravelWeHelp)
  - FullPackageMissingScreen / full package flow screens
  - AdminRequestsScreen, AdminRequestDetailScreen, AdminRequestDocumentsScreen

#### `src/components`
- Reusable building blocks:
  - RequestModal
  - FullPackageDiagnosticModal
  - Buttons, cards, UI utilities

#### `src/services`
- Firebase business logic:
  - `requestservice.js` (create/update service requests)
  - `userservice.js` (profile/user state, active process state)
  - `attachmentservice.js` (create attachment entries, track upload status)
  - `adminfileservice.js` (admin-sent docs to user)
  - `progressservice.js` (load applications/progress items)

#### `src/utils`
- Pure helpers:
  - parsing note/missing items fallbacks
  - profile guard checks
  - formatting functions

---

## Environment & Configuration

### Firebase Setup
This project requires Firebase configuration:
- Firebase project
- Firestore database
- Storage bucket (for PDFs / admin files)
- Firebase Auth enabled

You will typically configure Firebase in:
- `src/firebase.js`

> ⚠️ If you are using environment variables for config, do not commit them.

---

### Environment Variables (.env)

This repo intentionally ignores `.env` files for security.

Typical values (example only):
- `VITE_FIREBASE_API_KEY=...`
- `VITE_FIREBASE_AUTH_DOMAIN=...`
- `VITE_FIREBASE_PROJECT_ID=...`
- `VITE_FIREBASE_STORAGE_BUCKET=...`
- `VITE_FIREBASE_MESSAGING_SENDER_ID=...`
- `VITE_FIREBASE_APP_ID=...`

Create a local `.env` in the project root:

Then restart the dev server after editing `.env`.

---

### Security Notes
- ✅ `.env` is excluded from GitHub
- ✅ `node_modules` is excluded
- ✅ Keep admin logic enforced in Firestore rules, not just UI checks
- ✅ Never commit service account credentials or private API keys

---

## Running Locally

### 1) Install dependencies
```bash
npm install

All rights reserved unless explicitly stated otherwise.

# React + Vite