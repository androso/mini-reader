
# Project Architecture

## Overview
This is a Next.js-based web application for reading and managing ebooks, with user authentication and file storage capabilities.

## Tech Stack
- **Framework**: Next.js 15.1.0 with TypeScript
- **Authentication**: NextAuth.js
- **Database**: PostgreSQL with Drizzle ORM
- **Storage**: AWS S3 for ebook file storage
- **UI**: React with Tailwind CSS and Radix UI components
- **Ebook Reader**: EPUB.js with custom React wrapper

## Directory Structure

### Core Directories
- `/src/app`: Next.js app router pages and API routes
- `/src/components`: React components including custom reader implementation
- `/src/db`: Database configuration and schema
- `/src/lib`: Utility functions and service configurations
- `/src/actions`: Server actions for database operations
- `/public`: Static assets and uploaded files

### Key Components
- `ReactReader`: Custom EPUB reader implementation
- `FileUpload`: Handles ebook file uploads
- `AuthProvider`: Manages authentication state
- `BookViewer`: Main reading interface

## Main Features

### Authentication
- Google OAuth integration via NextAuth.js
- Session management
- Protected routes

### File Management
- S3-based file storage system
- EPUB file upload support
- File deletion capabilities

### Reading Interface
- EPUB rendering with page navigation
- Progress tracking
- Responsive design
- Touch/swipe support

### Database Schema
- Users table: Stores user information
- Books table: Manages book metadata and file references

## API Structure
- `/api/auth`: Authentication endpoints
- `/api/books`: Book management endpoints
  - GET: List books
  - POST: Upload new book
  - DELETE: Remove book

## State Management
- Server-side state with Next.js
- Client-side state with React hooks
- Authentication state via NextAuth.js context

## Security
- Authenticated API routes
- Secure file storage
- Environment variable protection
- CSRF protection

## Dependencies
- Database: `@neondatabase/serverless`
- ORM: `drizzle-orm`
- UI: `@radix-ui` components
- Reader: `epubjs`
- Storage: `@aws-sdk/client-s3`
