module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url: ['http://localhost/'],
      numberOfRuns: 2,
      settings: {
        preset: 'desktop',
        chromeFlags: '--headless=new --no-sandbox --disable-gpu',
        // La preview è noindex per contratto: l'audit crawlability non è un
        // segnale di qualità applicabile prima del catalogo Gold.
        skipAudits: ['is-crawlable'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.8 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        'first-contentful-paint': ['error', { maxNumericValue: 2_000, aggregationMethod: 'median' }],
        'largest-contentful-paint': ['error', { maxNumericValue: 3_500, aggregationMethod: 'median' }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'median' }],
        'total-blocking-time': ['error', { maxNumericValue: 300, aggregationMethod: 'median' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: process.env.LHCI_OUTPUT_DIR || '/tmp/tre-milano-lhci',
    },
  },
};
