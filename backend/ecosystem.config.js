// pm2 process config for the UAT backend.
//
// Mirrors how the app is currently started (pm2 start dist/src/main.js
// --name uat-med-b), but pins NODE_ENV + DEPLOYMENT explicitly so a future
// restart can never silently fall back to the Joi default (DEPLOYMENT='uat'),
// which would disable AI-gateway correction forwarding.
//
// NOTE: env/.env.production already sets these; this is defense-in-depth at
// the process level. Apply with:  pm2 reload ecosystem.config.js --update-env
module.exports = {
  apps: [
    {
      name: 'uat-med-b',
      script: 'dist/src/main.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        DEPLOYMENT: 'production',
      },
    },
  ],
};
