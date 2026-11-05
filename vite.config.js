import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { featuresPlugin } from './build/features-plugin.js';

export default defineConfig({
  // Relative URLs so the site works at https://<user>.github.io/<repo>/, on a custom domain, or locally.
  base: './',
  // Each feature folder is copied verbatim into dist/<FeatureFolder>/ (diagram.svg, tracker.json, feature.json).
  publicDir: 'features',
  // Unknown paths 404 instead of falling back to the landing page — same as GitHub Pages.
  appType: 'mpa',
  plugins: [react(), featuresPlugin({ dir: 'features' })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        index: 'index.html', // landing page
        feature: 'feature.html', // per-feature canvas shell (copied to dist/<FeatureFolder>/index.html)
      },
    },
  },
});
