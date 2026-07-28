import express from 'express';
import cookieParser from 'cookie-parser';
import { PORT } from './env.js';
import { errorHandler } from './errors.js';
import { attachUser } from './session.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import ticketRoutes from './routes/tickets.js';

export const app = express();

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Resolves the session cookie into req.user for everything under /api. Routes
// that require a session say so themselves with requireAuth.
app.use('/api', attachUser);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/tickets', ticketRoutes);

// Unknown API paths answer as JSON, not Express's HTML error page, so the
// client's fetch wrapper can always parse the body.
app.use('/api', (req, res) => {
  res.status(404).json({ error: { message: 'Not found.', field: null } });
});

app.use(errorHandler);

// Guarded so tests can import `app` without binding a port.
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}
