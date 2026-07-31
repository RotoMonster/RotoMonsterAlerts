// RotoMonster Alerts - monitor alert server
// Postgres, runs on server.rotomonster.com behind IIS.

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3005;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'RotoMonsterAlerts',
  max: 10,
  idleTimeoutMillis: 30000
});

const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
  useFcmV1: true
});

// Sport ids match RotoMonsterTwitter: 1 basketball, 2 baseball.
const SPORTS = { 1: 'NBA', 2: 'MLB' };

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS valid_codes (
        code text PRIMARY KEY,
        note text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS devices (
        code text PRIMARY KEY,
        push_token text,
        registration_id text,
        notifications_enabled boolean NOT NULL DEFAULT true,
        last_seen timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        message_id text UNIQUE NOT NULL,
        sport_id integer,
        title text NOT NULL,
        body text,
        url text,
        notified boolean NOT NULL DEFAULT false,
        recipients integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        is_deleted boolean NOT NULL DEFAULT false
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages (created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_messages_sport ON messages (sport_id, created_at DESC)`);

    console.log('Database ready');
  } catch (error) {
    console.error('Database initialization failed:', error);
  }
}

initializeDatabase();

function isValidPushToken(token) {
  return token && (token.startsWith('ExponentPushToken[') || token.startsWith('simulator_token_'));
}

// Send endpoints are key-protected. Read endpoints are not, since the app
// itself has no way to hold a secret - the registration code is the gate there.
function requireApiKey(req, res, next) {
  const configured = process.env.API_KEY;
  if (!configured) {
    console.warn('API_KEY not set - refusing protected request');
    return res.status(503).json({ success: false, error: 'Server not configured' });
  }
  if (req.get('X-API-Key') !== configured) {
    return res.status(401).json({ success: false, error: 'Invalid or missing X-API-Key' });
  }
  next();
}

// ============================================
// HEALTH
// ============================================

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, database: 'connected' });
  } catch (error) {
    res.status(500).json({ success: false, database: 'error', error: error.message });
  }
});

// ============================================
// CODES
// ============================================

app.post('/api/codes', requireApiKey, async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ success: false, error: 'codes must be a non-empty array' });
    }

    let added = 0;
    for (const entry of codes) {
      const code = (typeof entry === 'string' ? entry : entry.code || '').trim().toUpperCase();
      if (!code) continue;
      const note = typeof entry === 'string' ? null : entry.note || null;

      const result = await pool.query(
        `INSERT INTO valid_codes (code, note) VALUES ($1, $2)
         ON CONFLICT (code) DO NOTHING`,
        [code, note]
      );
      added += result.rowCount;
    }

    res.json({ success: true, added });
  } catch (error) {
    console.error('Error adding codes:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/codes', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.code, c.note, c.created_at,
             (d.code IS NOT NULL) AS registered,
             d.last_seen
      FROM valid_codes c
      LEFT JOIN devices d ON d.code = c.code
      ORDER BY c.created_at DESC
    `);
    res.json({ success: true, codes: result.rows });
  } catch (error) {
    console.error('Error listing codes:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/codes/:code', requireApiKey, async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    await pool.query('DELETE FROM devices WHERE code = $1', [code]);
    const result = await pool.query('DELETE FROM valid_codes WHERE code = $1', [code]);
    res.json({ success: true, deleted: result.rowCount > 0 });
  } catch (error) {
    console.error('Error deleting code:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// DEVICES
// ============================================

app.post('/api/register', async (req, res) => {
  try {
    const { code, pushToken } = req.body;
    if (!code || !pushToken) {
      return res.status(400).json({ success: false, error: 'code and pushToken are required' });
    }

    const upperCode = code.trim().toUpperCase();

    const valid = await pool.query('SELECT 1 FROM valid_codes WHERE code = $1', [upperCode]);
    if (valid.rowCount === 0) {
      return res.status(400).json({ success: false, error: 'Invalid code. Contact administrator.' });
    }

    if (!isValidPushToken(pushToken)) {
      return res.status(400).json({ success: false, error: 'Invalid push token format' });
    }

    const registrationId = uuidv4();

    await pool.query(
      `INSERT INTO devices (code, push_token, registration_id, last_seen)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (code) DO UPDATE
         SET push_token = EXCLUDED.push_token,
             registration_id = EXCLUDED.registration_id,
             last_seen = now()`,
      [upperCode, pushToken, registrationId]
    );

    console.log(`Device registered: ${upperCode}`);
    res.json({ success: true, registrationId });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/devices', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT code, notifications_enabled, last_seen FROM devices ORDER BY last_seen DESC'
    );
    res.json({ success: true, devices: result.rows });
  } catch (error) {
    console.error('Error listing devices:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.put('/api/device/:code/notifications', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'enabled must be true or false' });
    }

    const result = await pool.query(
      'UPDATE devices SET notifications_enabled = $1 WHERE code = $2',
      [enabled, code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error updating notification setting:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/device/:code/notifications-status', async (req, res) => {
  try {
    const code = req.params.code.trim().toUpperCase();
    const result = await pool.query(
      'SELECT notifications_enabled FROM devices WHERE code = $1',
      [code]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Device not registered' });
    }

    res.json({ success: true, enabled: result.rows[0].notifications_enabled });
  } catch (error) {
    console.error('Error reading notification setting:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// ============================================
// MESSAGES
// ============================================

// Post a monitoring message. Everyone registered receives it - there is no
// per-message recipient list, unlike the Basketball Monster injury alerts.
app.post('/api/message', requireApiKey, async (req, res) => {
  try {
    const { sportId, title, body, url, notify } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    if (sportId != null && !SPORTS[sportId]) {
      return res.status(400).json({ success: false, error: 'sportId must be 1 (NBA), 2 (MLB) or omitted' });
    }

    const shouldNotify = notify !== false;
    const messageId = uuidv4();

    const inserted = await pool.query(
      `INSERT INTO messages (message_id, sport_id, title, body, url, notified)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, message_id, sport_id, title, body, url, created_at`,
      [messageId, sportId ?? null, title.trim(), body || null, url || null, shouldNotify]
    );

    let sent = 0;

    if (shouldNotify) {
      const devices = await pool.query(
        'SELECT code, push_token FROM devices WHERE notifications_enabled = true'
      );

      const pushMessages = devices.rows
        .filter(d => Expo.isExpoPushToken(d.push_token))
        .map(d => ({
          to: d.push_token,
          sound: 'default',
          title: sportId ? `${SPORTS[sportId]} - ${title.trim()}` : title.trim(),
          body: body || '',
          data: { message_id: messageId, sport_id: sportId ?? null, url: url || null },
          priority: 'high',
          channelId: 'default'
        }));

      if (pushMessages.length > 0) {
        try {
          for (const chunk of expo.chunkPushNotifications(pushMessages)) {
            await expo.sendPushNotificationsAsync(chunk);
          }
          sent = pushMessages.length;
          console.log(`Sent ${sent} notifications`);
        } catch (error) {
          // A push failure must not lose the message - it is already stored.
          console.error('Push send failed:', error);
        }
      }

      await pool.query('UPDATE messages SET recipients = $1 WHERE message_id = $2', [sent, messageId]);
    }

    res.json({ success: true, messageId, notified: shouldNotify, sent, message: inserted.rows[0] });
  } catch (error) {
    console.error('Error posting message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// What the app reads. hours defaults to 12, sportId omitted means all sports.
app.get('/api/messages', async (req, res) => {
  try {
    const hours = Math.min(Math.max(parseInt(req.query.hours || '12', 10) || 12, 1), 720);
    const sportId = req.query.sportId ? parseInt(req.query.sportId, 10) : null;

    const params = [hours];
    let where = `is_deleted = false AND created_at >= now() - ($1 || ' hours')::interval`;

    if (sportId) {
      params.push(sportId);
      where += ` AND sport_id = $${params.length}`;
    }

    const result = await pool.query(
      `SELECT message_id, sport_id, title, body, url, created_at
       FROM messages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 500`,
      params
    );

    res.json({ success: true, hours, sportId, count: result.rowCount, messages: result.rows });
  } catch (error) {
    console.error('Error reading messages:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.delete('/api/messages/:messageId', requireApiKey, async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE messages SET is_deleted = true WHERE message_id = $1',
      [req.params.messageId]
    );
    res.json({ success: true, deleted: result.rowCount > 0 });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

app.get('/api/sports', (req, res) => {
  res.json({
    success: true,
    sports: Object.entries(SPORTS).map(([id, name]) => ({ sportId: parseInt(id, 10), name }))
  });
});

app.listen(PORT, () => {
  console.log(`RotoMonster Alerts listening on ${PORT}`);
});
