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
  console.error = (...args: any[]) => {
    // Check if this is a chrome extension error
    const errorString = args.join(' ')

    // Suppress common browser extension errors
    if (
      errorString.includes('chrome-extension://') ||
      errorString.includes('runtime.lastError') ||
      errorString.includes('Receiving end does not exist') ||
      errorString.includes('Could not establish connection')
    ) {
      // Silently ignore these external extension errors
      return
    }

    // Let other errors through
    originalError.apply(console, args)
  }

  // Handle unhandled promise rejections from extensions
  window.addEventListener('unhandledrejection', (event) => {
    const errorString = event.reason?.toString() || ''

    if (
      errorString.includes('chrome-extension://') ||
      errorString.includes('runtime.lastError')
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
        resourceUrl.includes('chrome-extension://')
      ) {
        event.preventDefault()
        return
      }
    }
  }, true)
}
