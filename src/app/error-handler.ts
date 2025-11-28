// src/app/error-handler.ts
// Global error handler to suppress external browser extension errors

'use client'

/**
 * Initializes global error handlers to suppress common browser extension errors
 * that are beyond the application's control
 */
export function initializeErrorHandlers() {
  if (typeof window === 'undefined') return

  // Suppress chrome extension runtime errors
  const originalError = console.error
  const originalWarn = console.warn

  console.error = (...args: any[]) => {
    // Check if this is a chrome extension error
    const errorString = args.join(' ')

    // Suppress common browser extension errors
    if (
      errorString.includes('chrome-extension://') ||
      errorString.includes('runtime.lastError') ||
      errorString.includes('Receiving end does not exist') ||
      errorString.includes('Could not establish connection') ||
      errorString.includes('Extension context invalidated') ||
      errorString.includes('message port closed')
    ) {
      // Silently ignore these external extension errors
      return
    }

    // Let other errors through
    originalError.apply(console, args)
  }

  console.warn = (...args: any[]) => {
    const warnString = args.join(' ')

    // Suppress browser extension and external resource warnings
    if (
      warnString.includes('chrome-extension://') ||
      warnString.includes('typekit.net') ||
      warnString.includes('preloaded using link preload but not used') ||
      warnString.includes('preload') && warnString.includes('not used within a few seconds')
    ) {
      // Silently ignore these warnings
      return
    }

    // Let other warnings through
    originalWarn.apply(console, args)
  }

  // Handle unhandled promise rejections from extensions
  window.addEventListener('unhandledrejection', (event) => {
    const errorString = event.reason?.toString() || ''
    const messageString = event.reason?.message || ''

    if (
      errorString.includes('chrome-extension://') ||
      errorString.includes('runtime.lastError') ||
      messageString.includes('Extension context invalidated')
    ) {
      // Suppress extension-related promise rejections
      event.preventDefault()
      return
    }
  })

  // Suppress resource loading errors for external sources we don't control
  window.addEventListener('error', (event) => {
    const target = event.target as any

    // Check if this is a resource loading error
    if (target?.src || target?.href) {
      const resourceUrl = target.src || target.href

      // Suppress TypeKit font loading warnings and chrome extension errors
      if (
        resourceUrl.includes('typekit.net') ||
        resourceUrl.includes('chrome-extension://') ||
        resourceUrl.includes('favicon.ico')
      ) {
        event.preventDefault()
        return
      }
    }

    // Suppress extension-related errors in error messages
    if (event.message) {
      if (
        event.message.includes('chrome-extension://') ||
        event.message.includes('Extension context')
      ) {
        event.preventDefault()
        return
      }
    }
  }, true)
}

// Initialize immediately if in browser
if (typeof window !== 'undefined') {
  initializeErrorHandlers()
}
