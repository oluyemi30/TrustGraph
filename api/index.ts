import serverless from 'serverless-http';
import app from '../server/app';

// Prevent background long-polling or other persistent tasks from running on Vercel
// If your `server/app` previously started background jobs on import, guard them
// behind `if (process.env.VERCEL !== '1')` in that module.

export default serverless(app as any);
