import { defineConfig } from 'vite'
import adonisjs from '@adonisjs/vite/client'

export default defineConfig({
  plugins: [
    adonisjs({
      /**
       * Entrypoints of your application. Each entrypoint will
       * result in a separate bundle.
       */
      entryPoints: [
        'resources/css/app.css',
        'resources/js/app.js',

        /**
         * The landing page's own styles (plan §22.7), loaded by that page
         * only — so removing the Landing module removes this line and the
         * file, and no other page ever downloaded them.
         */
        'resources/css/landing.css',
      ],

      /**
       * Paths to watch and reload the browser on file change
       */
      reload: ['resources/views/**/*.edge'],
    }),
  ],

  server: {
    watch: {
      ignored: ['**/storage/**', '**/tmp/**'],
    },
  },
})
