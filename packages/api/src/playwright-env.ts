if (process.env.NODE_ENV === 'production' && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/ms-playwright';
}
